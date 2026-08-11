"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, type Prisma } from "@koeki/database";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { isReportPeriodComplete, normalizeReportPeriod } from "@/lib/report-period";
import { requireWriteAccess } from "@/lib/session";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");
const reportSchema = z.object({
  periodStart: dateOnly,
  periodEnd: dateOnly,
  summary: z.string().trim().min(10, "Un résumé d’au moins 10 caractères est requis").max(4000),
  incidents: z.string().trim().max(4000).optional().transform((value) => value || null),
  stockIssues: z.string().trim().max(4000).optional().transform((value) => value || null),
  followUps: z.string().trim().max(4000).optional().transform((value) => value || null),
  intent: z.enum(["draft", "submit"])
});
const updateReportSchema = reportSchema.extend({ reportId: z.string().min(1) });

async function activitySnapshot(tx: Prisma.TransactionClient, authorId: string, start: Date, end: Date) {
  const cutoff = new Date();
  const upperBound = end < cutoff ? end : cutoff;
  const [payments, transactions, corrections] = await Promise.all([
    tx.taxPayment.findMany({ where: { recordedById: authorId, status: "VALIDATED", createdAt: { gte: start, lte: upperBound } }, select: { amount: true } }),
    tx.resourceTransaction.findMany({ where: { agentId: authorId, status: "VALIDATED", createdAt: { gte: start, lte: upperBound } }, select: { type: true, totalAmount: true } }),
    tx.taxAdjustment.count({ where: { createdById: authorId, createdAt: { gte: start, lte: upperBound } } })
  ]);
  return {
    paymentCount: payments.length,
    collectedAmount: payments.reduce((total, payment) => total + payment.amount, 0n),
    donationCount: transactions.filter((transaction) => transaction.type === "DONATION").length,
    buybackCount: transactions.filter((transaction) => transaction.type === "BUYBACK").length,
    processedValue: transactions.reduce((total, transaction) => total + transaction.totalAmount, 0n),
    correctionCount: corrections
  };
}

async function assertNoOverlap(tx: Prisma.TransactionClient, authorId: string, start: Date, end: Date, excludedId?: string) {
  const overlap = await tx.agentReport.findFirst({
    where: { authorId, ...(excludedId ? { id: { not: excludedId } } : {}), periodStart: { lte: end }, periodEnd: { gte: start } },
    select: { id: true }
  });
  if (overlap) throw new Error("VALIDATION:Un autre rapport couvre déjà tout ou partie de cette période");
}

function validationMessage(error: unknown) {
  return error instanceof Error && error.message.startsWith("VALIDATION:") ? error.message.slice("VALIDATION:".length) : null;
}

export async function createReport(formData: FormData) {
  const session = await requireWriteAccess("reports:write");
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/reports/new?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const data = parsed.data!;
  const period = (() => {
    try { return normalizeReportPeriod(data.periodStart, data.periodEnd); }
    catch (error) { return back(error instanceof Error ? error.message : "Période invalide"); }
  })();
  if (data.intent === "submit" && !isReportPeriodComplete(period.end)) back("La période doit être entièrement terminée avant sa soumission");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
      await assertNoOverlap(tx, session.userId, period.start, period.end);
      const snapshot = await activitySnapshot(tx, session.userId, period.start, period.end);
      const report = await tx.agentReport.create({ data: {
        authorId: session.userId, periodStart: period.start, periodEnd: period.end,
        summary: data.summary, incidents: data.incidents, stockIssues: data.stockIssues, followUps: data.followUps,
        status: data.intent === "submit" ? "SUBMITTED" : "DRAFT", ...snapshot
      } });
      await writeAudit(tx, { actorId: session.userId, action: data.intent === "submit" ? "REPORT_SUBMITTED" : "REPORT_DRAFTED", entityType: "AgentReport", entityId: report.id, reason: `Période ${data.periodStart} → ${data.periodEnd}` });
    });
  } catch (error) {
    const message = validationMessage(error);
    if (message) back(message);
    if (isUniqueViolation(error)) back("Un rapport existe déjà pour cette période");
    throw error;
  }
  redirect("/reports");
}

export async function updateReport(formData: FormData) {
  const session = await requireWriteAccess("reports:write");
  const rawReportId = formData.get("reportId");
  const reportId = typeof rawReportId === "string" ? rawReportId : "";
  const back = (message: string): never => redirect(`/reports/${encodeURIComponent(reportId)}/modifier?erreur=${encodeURIComponent(message)}`);
  const parsed = updateReportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const data = parsed.data!;
  const period = (() => {
    try { return normalizeReportPeriod(data.periodStart, data.periodEnd); }
    catch (error) { return back(error instanceof Error ? error.message : "Période invalide"); }
  })();
  if (data.intent === "submit" && !isReportPeriodComplete(period.end)) back("La période doit être entièrement terminée avant sa soumission");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
      const report = await tx.agentReport.findUnique({ where: { id: data.reportId } });
      if (!report || report.authorId !== session.userId) throw new Error("VALIDATION:Rapport introuvable");
      if (report.status !== "DRAFT" && report.status !== "RETURNED") throw new Error("VALIDATION:Ce rapport ne peut plus être modifié");
      await assertNoOverlap(tx, session.userId, period.start, period.end, report.id);
      const snapshot = await activitySnapshot(tx, session.userId, period.start, period.end);
      const updated = await tx.agentReport.updateMany({
        where: { id: report.id, authorId: session.userId, status: { in: ["DRAFT", "RETURNED"] } },
        data: {
          periodStart: period.start, periodEnd: period.end, summary: data.summary, incidents: data.incidents, stockIssues: data.stockIssues, followUps: data.followUps,
          status: data.intent === "submit" ? "SUBMITTED" : report.status,
          ...(data.intent === "submit" ? { reviewerId: null } : {}), ...snapshot
        }
      });
      if (updated.count !== 1) throw new Error("VALIDATION:Ce rapport a été modifié entre-temps");
      const auditAction = data.intent === "submit" ? (report.status === "RETURNED" ? "REPORT_RESUBMITTED" : "REPORT_SUBMITTED") : "REPORT_UPDATED";
      await writeAudit(tx, { actorId: session.userId, action: auditAction, entityType: "AgentReport", entityId: report.id, reason: `Période ${data.periodStart} → ${data.periodEnd}` });
    });
  } catch (error) {
    const message = validationMessage(error);
    if (message) back(message);
    if (isUniqueViolation(error)) back("Un rapport existe déjà pour cette période");
    throw error;
  }
  redirect("/reports");
}

const reviewSchema = z.object({ reportId: z.string().min(1), intent: z.enum(["approve", "return"]) });

export async function reviewReport(formData: FormData) {
  const session = await requireWriteAccess("reports:review");
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/reports");
  const { reportId, intent } = parsed.data!;
  try {
    await prisma.$transaction(async (tx) => {
      const report = await tx.agentReport.findUnique({ where: { id: reportId } });
      if (!report || report.status !== "SUBMITTED") throw new Error("VALIDATION:Rapport déjà traité");
      if (report.authorId === session.userId) throw new Error("VALIDATION:Vous ne pouvez pas examiner votre propre rapport");
      const reviewed = await tx.agentReport.updateMany({
        where: { id: reportId, status: "SUBMITTED", authorId: { not: session.userId } },
        data: { status: intent === "approve" ? "APPROVED" : "RETURNED", reviewerId: session.userId }
      });
      if (reviewed.count !== 1) throw new Error("VALIDATION:Rapport déjà traité");
      await writeAudit(tx, { actorId: session.userId, action: intent === "approve" ? "REPORT_APPROVED" : "REPORT_RETURNED", entityType: "AgentReport", entityId: reportId });
    });
  } catch (error) {
    const message = validationMessage(error);
    if (message) redirect(`/reports?erreur=${encodeURIComponent(message)}`);
    throw error;
  }
  redirect("/reports");
}
