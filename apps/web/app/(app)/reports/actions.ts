"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, type Prisma } from "@koeki/database";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { isReportPeriodComplete, normalizeReportPeriod } from "@/lib/report-period";
import { requireWriteAccess } from "@/lib/session";
import { assertReportReview } from "@koeki/domain";
import { assertTeamActor, notifyInternal } from "@/lib/team-service";

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
const updateReportSchema = reportSchema.extend({ reportId: z.string().min(1), version: z.coerce.number().int().positive() });

async function activitySnapshot(tx: Prisma.TransactionClient, authorId: string, start: Date, end: Date) {
  const cutoff = new Date();
  const upperBound = end < cutoff ? end : cutoff;
  const [payments, transactions, corrections] = await Promise.all([
    tx.taxPayment.findMany({ where: { recordedById: authorId, status: "VALIDATED", createdAt: { gte: start, lte: upperBound } }, select: { amount: true } }),
    tx.resourceTransaction.findMany({ where: { OR: [{ recordedById: authorId }, { recordedById: null, agentId: authorId }], status: "VALIDATED", createdAt: { gte: start, lte: upperBound } }, select: { type: true, totalAmount: true } }),
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
  const back = (message: string) => ({ error: message });
  if (!parsed.success) return back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const data = parsed.data!;
  const period = (() => {
    try { return normalizeReportPeriod(data.periodStart, data.periodEnd); }
    catch (error) { return back(error instanceof Error ? error.message : "Période invalide"); }
  })();
  if ("error" in period) return period;
  if (data.intent === "submit" && !isReportPeriodComplete(period.end)) return back("La période doit être entièrement terminée avant sa soumission");

  try {
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "reports:write");
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
      await assertNoOverlap(tx, session.userId, period.start, period.end);
      const snapshot = await activitySnapshot(tx, session.userId, period.start, period.end);
      const report = await tx.agentReport.create({ data: {
        authorId: session.userId, periodStart: period.start, periodEnd: period.end,
        summary: data.summary, incidents: data.incidents, stockIssues: data.stockIssues, followUps: data.followUps,
        status: data.intent === "submit" ? "SUBMITTED" : "DRAFT", submittedAt: data.intent === "submit" ? new Date() : null, snapshotAt: new Date(), ...snapshot
      } });
      await writeAudit(tx, { actorId: session.userId, action: data.intent === "submit" ? "REPORT_SUBMITTED" : "REPORT_DRAFTED", entityType: "AgentReport", entityId: report.id, reason: `Période ${data.periodStart} → ${data.periodEnd}` });
    });
  } catch (error) {
    const message = validationMessage(error);
    if (message) return back(message);
    if (isUniqueViolation(error)) return back("Un rapport existe déjà pour cette période");
    throw error;
  }
  redirect("/reports");
}

export async function updateReport(formData: FormData) {
  const session = await requireWriteAccess("reports:write");
  const back = (message: string) => ({ error: message });
  const parsed = updateReportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const data = parsed.data!;
  const period = (() => {
    try { return normalizeReportPeriod(data.periodStart, data.periodEnd); }
    catch (error) { return back(error instanceof Error ? error.message : "Période invalide"); }
  })();
  if ("error" in period) return period;
  if (data.intent === "submit" && !isReportPeriodComplete(period.end)) return back("La période doit être entièrement terminée avant sa soumission");

  try {
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "reports:write");
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
      const report = await tx.agentReport.findUnique({ where: { id: data.reportId } });
      if (!report || report.authorId !== session.userId) throw new Error("VALIDATION:Rapport introuvable");
      if (report.status !== "DRAFT" && report.status !== "RETURNED") throw new Error("VALIDATION:Ce rapport ne peut plus être modifié");
      await assertNoOverlap(tx, session.userId, period.start, period.end, report.id);
      const snapshot = await activitySnapshot(tx, session.userId, period.start, period.end);
      const updated = await tx.agentReport.updateMany({
        where: { id: report.id, authorId: session.userId, version: data.version, status: { in: ["DRAFT", "RETURNED"] } },
        data: {
          periodStart: period.start, periodEnd: period.end, summary: data.summary, incidents: data.incidents, stockIssues: data.stockIssues, followUps: data.followUps,
          status: data.intent === "submit" ? "SUBMITTED" : report.status,
          version: { increment: 1 }, snapshotAt: new Date(),
          ...(data.intent === "submit" ? { reviewerId: null, submittedAt: new Date(), decidedAt: null } : {}), ...snapshot
        }
      });
      if (updated.count !== 1) throw new Error("VALIDATION:Ce rapport a été modifié entre-temps");
      const auditAction = data.intent === "submit" ? (report.status === "RETURNED" ? "REPORT_RESUBMITTED" : "REPORT_SUBMITTED") : "REPORT_UPDATED";
      await writeAudit(tx, { actorId: session.userId, action: auditAction, entityType: "AgentReport", entityId: report.id, reason: `Période ${data.periodStart} → ${data.periodEnd}` });
    });
  } catch (error) {
    const message = validationMessage(error);
    if (message) return back(message);
    if (isUniqueViolation(error)) return back("Un rapport existe déjà pour cette période");
    throw error;
  }
  redirect("/reports");
}

const reviewSchema = z.object({ reportId: z.string().min(1), version: z.coerce.number().int().positive(), comment: z.string().trim().max(4000).default(""), intent: z.enum(["approve", "return"]) });

export async function reviewReport(formData: FormData) {
  const session = await requireWriteAccess("reports:review");
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Vérifiez le contenu de votre avis et rechargez le rapport si sa version a changé." };
  const { reportId, intent, version, comment } = parsed.data!;
  try {
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "reports:review");
      const report = await tx.agentReport.findUnique({ where: { id: reportId } });
      if (!report) throw new Error("VALIDATION:Rapport introuvable");
      const decision = intent === "approve" ? "APPROVED" : "RETURNED";
      assertReportReview({ authorId: report.authorId, actorId: session.userId, status: report.status, version: report.version, expectedVersion: version, decision, comment });
      const reviewed = await tx.agentReport.updateMany({
        where: { id: reportId, version, status: "SUBMITTED", authorId: { not: session.userId } },
        data: { status: decision, reviewerId: session.userId, decidedAt: new Date(), version: { increment: 1 } }
      });
      if (reviewed.count !== 1) throw new Error("VALIDATION:Rapport déjà traité");
      await tx.reportReview.create({ data: { reportId, reportVersion: version, reviewerId: session.userId, reviewedStatus: report.status, decision, comment: comment || null, contentSnapshot: { summary: report.summary, incidents: report.incidents, stockIssues: report.stockIssues, followUps: report.followUps, paymentCount: report.paymentCount, collectedAmount: report.collectedAmount.toString(), donationCount: report.donationCount, buybackCount: report.buybackCount, processedValue: report.processedValue.toString(), periodStart: report.periodStart.toISOString(), periodEnd: report.periodEnd.toISOString() } } });
      await notifyInternal(tx, { userId: report.authorId, title: intent === "approve" ? "Rapport approuvé" : "Correction demandée", body: "Consultez la décision du responsable dans votre rapport.", href: `/reports/${reportId}`, dedupeKey: `report:${reportId}:${version}:${decision}` });
      await writeAudit(tx, { actorId: session.userId, action: intent === "approve" ? "REPORT_APPROVED" : "REPORT_RETURNED", entityType: "AgentReport", entityId: reportId, reason: comment });
    });
  } catch (error) {
    const message = validationMessage(error);
    if (message) return { error: message };
    throw error;
  }
  redirect("/reports");
}

export async function configureReportExpectation(formData: FormData) {
  const session = await requireWriteAccess("reports:review");
  const parsed = z.object({ effectiveFrom: dateOnly, population: z.enum(["ECONOMIC_AGENT", "PARTICIPANTS"]), dueAfterDays: z.coerce.number().int().min(0).max(30) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Précisez une règle valide." };
  const data = parsed.data!;
  const effectiveFrom = normalizeReportPeriod(data.effectiveFrom, data.effectiveFrom).start;
  if (effectiveFrom < new Date()) return { error: "La date d’effet doit être future." };
  await prisma.$transaction(async (tx) => {
    await assertTeamActor(tx, session.userId, "reports:review");
    const rule = await tx.reportExpectation.create({ data: { ...data, effectiveFrom, createdById: session.userId, reminders: formData.get("reminders") === "on" } });
    await writeAudit(tx, { actorId: session.userId, action: "REPORT_EXPECTATION_CONFIGURED", entityType: "ReportExpectation", entityId: rule.id, reason: "Application aux nouvelles périodes uniquement" });
  });
  redirect("/reports");
}
