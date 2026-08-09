"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@koeki/database";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { requireWriteAccess } from "@/lib/session";

const canReviewReports = (roles: readonly string[]) => roles.some((role) => role === "SUPER_ADMIN" || role === "KOEKI_MANAGER");

const reportSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  summary: z.string().trim().min(10, "Un résumé d’au moins 10 caractères est requis").max(4000),
  incidents: z.string().trim().max(4000).optional().transform((value) => value || null),
  stockIssues: z.string().trim().max(4000).optional().transform((value) => value || null),
  followUps: z.string().trim().max(4000).optional().transform((value) => value || null),
  intent: z.enum(["draft", "submit"])
});

export async function createReport(formData: FormData) {
  const session = await requireWriteAccess("reports:write");
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/reports/new?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const data = parsed.data!;
  if (data.periodEnd <= data.periodStart) back("La fin de période doit suivre le début");
  const end = new Date(data.periodEnd); end.setHours(23, 59, 59, 999);
  const [payments, transactions, corrections] = await Promise.all([
    prisma.taxPayment.findMany({ where: { recordedById: session.userId, status: "VALIDATED", createdAt: { gte: data.periodStart, lte: end } }, select: { amount: true } }),
    prisma.resourceTransaction.findMany({ where: { agentId: session.userId, status: "VALIDATED", createdAt: { gte: data.periodStart, lte: end } }, select: { type: true, totalAmount: true } }),
    prisma.taxAdjustment.count({ where: { createdById: session.userId, createdAt: { gte: data.periodStart, lte: end } } })
  ]);
  try {
    await prisma.$transaction(async (tx) => {
      const report = await tx.agentReport.create({ data: {
        authorId: session.userId, periodStart: data.periodStart, periodEnd: end, summary: data.summary, incidents: data.incidents, stockIssues: data.stockIssues, followUps: data.followUps,
        status: data.intent === "submit" ? "SUBMITTED" : "DRAFT",
        paymentCount: payments.length, collectedAmount: payments.reduce((total, payment) => total + payment.amount, 0n),
        donationCount: transactions.filter((transaction) => transaction.type === "DONATION").length,
        buybackCount: transactions.filter((transaction) => transaction.type === "BUYBACK").length,
        processedValue: transactions.reduce((total, transaction) => total + transaction.totalAmount, 0n),
        correctionCount: corrections
      } });
      await writeAudit(tx, { actorId: session.userId, action: data.intent === "submit" ? "REPORT_SUBMITTED" : "REPORT_DRAFTED", entityType: "AgentReport", entityId: report.id, reason: `Période ${data.periodStart.toISOString().slice(0, 10)} → ${data.periodEnd.toISOString().slice(0, 10)}` });
    });
  } catch (error) {
    if (isUniqueViolation(error)) back("Un rapport existe déjà pour cette période");
    throw error;
  }
  redirect("/reports");
}

const reviewSchema = z.object({ reportId: z.string().min(1), intent: z.enum(["approve", "return"]) });

export async function reviewReport(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  if (!canReviewReports(session.roles)) redirect("/reports?erreur=Examen%20r%C3%A9serv%C3%A9%20aux%20responsables");
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/reports");
  const { reportId, intent } = parsed.data!;
  try {
    await prisma.$transaction(async (tx) => {
      const report = await tx.agentReport.findUnique({ where: { id: reportId } });
      if (!report || report.status !== "SUBMITTED") throw new Error("VALIDATION:Rapport déjà traité");
      if (report.authorId === session.userId) throw new Error("VALIDATION:Vous ne pouvez pas examiner votre propre rapport");
      const reviewed = await tx.agentReport.updateMany({
        where: { id: reportId, status: "SUBMITTED" },
        data: { status: intent === "approve" ? "APPROVED" : "RETURNED", reviewerId: session.userId }
      });
      if (reviewed.count !== 1) throw new Error("VALIDATION:Rapport déjà traité");
      await writeAudit(tx, { actorId: session.userId, action: intent === "approve" ? "REPORT_APPROVED" : "REPORT_RETURNED", entityType: "AgentReport", entityId: reportId });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) redirect(`/reports?erreur=${encodeURIComponent(error.message.slice("VALIDATION:".length))}`);
    throw error;
  }
  redirect("/reports");
}
