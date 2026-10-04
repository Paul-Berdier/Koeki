import { prisma } from "@koeki/database";
import { isReportExpected } from "@koeki/domain";
import { demoMode, hasPermission, type SessionInfo } from "./session";
import { agentName } from "./team-service";
import { formatReportDate, reportDayBoundary, shiftReportDate } from "./report-period";

export async function getReportReviewData(session: SessionInfo, reportId: string) {
  if (!hasPermission(session, "reports:read")) throw new Error("FORBIDDEN");
  if (demoMode) return null;
  const report = await prisma.agentReport.findFirst({ where: { id: reportId, OR: [{ authorId: session.userId }, ...(hasPermission(session, "reports:read-all") ? [{ status: { not: "DRAFT" as const } }] : [])] }, include: { author: { select: { name: true, ninjaProfile: { select: { firstName: true, lastName: true } } } }, reviews: { orderBy: { createdAt: "desc" } } } });
  if (!report) return null;
  // Snapshot values are never rewritten after approval. Show subsequent source corrections.
  const cutoff = report.snapshotAt ?? report.createdAt;
  const corrections = await prisma.taxAdjustment.count({ where: { createdAt: { gt: cutoff }, payment: { recordedById: report.authorId, createdAt: { gte: report.periodStart, lte: report.periodEnd } } } });
  const reversedPayments = await prisma.taxPayment.count({ where: { recordedById: report.authorId, status: "REVERSED", createdAt: { gte: report.periodStart, lte: report.periodEnd } } });
  const reversedTransactions = await prisma.resourceTransaction.count({ where: { AND: [{ OR: [{ recordedById: report.authorId }, { recordedById: null, agentId: report.authorId }] }, { OR: [{ status: "REVERSED" }, { movements: { some: { reversal: { isNot: null } } } }] }], createdAt: { gte: report.periodStart, lte: report.periodEnd } } });
  const reviewers = await prisma.user.findMany({ where: { id: { in: [...new Set(report.reviews.map((review) => review.reviewerId))] } }, select: { id: true, name: true, ninjaProfile: { select: { firstName: true, lastName: true } } } });
  const names = new Map(reviewers.map((reviewer) => [reviewer.id, agentName(reviewer)]));
  return { ...report, reviews: report.reviews.map((review) => ({ ...review, reviewerName: names.get(review.reviewerId) ?? "Responsable historique" })), correctedSources: corrections + reversedPayments + reversedTransactions };
}

export async function getReportExpectations(session: SessionInfo, userId = session.userId) {
  if (!hasPermission(session, "reports:read") || (userId !== session.userId && !hasPermission(session, "team:read"))) throw new Error("FORBIDDEN");
  if (demoMode) return { configured: false, rule: null, periods: [] };
  const now = new Date();
  const rules = await prisma.reportExpectation.findMany({ orderBy: { effectiveFrom: "desc" } });
  const rule = rules[0] ?? null;
  if (!rule) return { configured: false, rule: null, periods: [] };
  const [user, reports] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { roles: { select: { role: { select: { code: true } } } }, participations: true, absences: { select: { startsAt: true, endsAt: true } } } }),
    prisma.agentReport.findMany({ where: { authorId: userId, status: { not: "DRAFT" } }, select: { id: true, periodStart: true, periodEnd: true, status: true } })
  ]);
  if (!user) return { configured: true, rule, periods: [] };
  const localDay = formatReportDate(now), weekday = new Date(`${localDay}T12:00:00Z`).getUTCDay();
  const monday = shiftReportDate(localDay, -((weekday + 6) % 7));
  const periods: { start: string; end: string; dueAt: Date; state: string; reportId: string | null }[] = [];
  for (let week = 0; week < 12; week += 1) {
    const start = shiftReportDate(monday, -7 * week), end = shiftReportDate(start, 6), periodStart = reportDayBoundary(start), periodEnd = reportDayBoundary(end, true);
    const applicable = rules.find((entry) => entry.effectiveFrom <= periodStart);
    if (!applicable) continue;
    const expected = user.participations.some((part) => (applicable.population !== "ECONOMIC_AGENT" || part.serviceRole === "ECONOMIC_AGENT") && isReportExpected({ periodStart, periodEnd, effectiveFrom: applicable.effectiveFrom, participationStart: part.startsAt ?? part.observedAt, participationEnd: part.endsAt, absences: user.absences }));
    if (!expected) continue;
    // Any overlapping preserved legacy period is explicitly recognized; never generate a duplicate.
    const report = reports.find((entry) => entry.periodStart <= periodEnd && entry.periodEnd >= periodStart);
    const dueAt = reportDayBoundary(shiftReportDate(end, applicable.dueAfterDays), true);
    periods.push({ start, end, dueAt, state: report ? report.status === "RETURNED" ? "À corriger" : "Reçu" : dueAt < now ? "Échéance dépassée" : "Attendu", reportId: report?.id ?? null });
  }
  return { configured: true, rule, periods };
}
