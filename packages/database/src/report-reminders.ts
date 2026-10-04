import { adjacentRankingWeek, isReportExpected, rankingWeekAt } from "@koeki/domain";
import type { PrismaClient } from "@prisma/client";

function dueAfterLocalDays(endExclusive: Date, days: number) {
  // Calendar-day addition in Paris: preserve the local wall clock across DST.
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(formatter.formatToParts(endExclusive).map((part) => [part.type, part.value]));
  const target = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days));
  const timeParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let instant = target.getTime();
  for (let i = 0; i < 4; i++) {
    const local = Object.fromEntries(timeParts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second));
    const offset = target.getTime() - represented;
    instant += offset;
    if (!offset) break;
  }
  return new Date(instant);
}

/** Internal only. Bounded twelve-week horizon, deduped independently of read status. */
export async function sendReportReminders(database: PrismaClient, now = new Date()) {
  let sent = 0;
  const candidates = await database.user.findMany({ where: { revokedAt: null, participations: { some: {} }, roles: { some: { role: { code: { in: ["ECONOMIC_AGENT", "KOEKI_MANAGER", "SUPER_ADMIN"] } } } } }, select: { id: true } });
  for (const candidate of candidates) {
    sent += await database.$transaction(async (tx) => {
      // Matches account, participation, absence, expectation and report mutation ordering.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714424)`;
      const user = await tx.user.findUnique({ where: { id: candidate.id }, select: { revokedAt: true, roles: { select: { role: { select: { code: true } } } }, participations: true, absences: { select: { startsAt: true, endsAt: true } } } });
      if (!user || user.revokedAt || !user.roles.some(({ role }) => ["ECONOMIC_AGENT", "KOEKI_MANAGER", "SUPER_ADMIN"].includes(role.code))) return 0;
      const rules = await tx.reportExpectation.findMany({ where: { effectiveFrom: { lte: now } }, orderBy: { effectiveFrom: "desc" } });
      if (!rules.length) return 0;
      const since = new Date(now.getTime() - 92 * 86400000);
      const reports = await tx.agentReport.findMany({ where: { authorId: candidate.id, status: { not: "DRAFT" }, periodEnd: { gte: since } }, select: { periodStart: true, periodEnd: true } });
      let count = 0;
      let week = adjacentRankingWeek(rankingWeekAt(now), -1);
      for (let index = 0; index < 12; index++, week = adjacentRankingWeek(week, -1)) {
        const rule = rules.find((entry) => entry.effectiveFrom <= week.startsAt);
        if (!rule?.reminders) continue;
        if (dueAfterLocalDays(week.endsAt, rule.dueAfterDays) > now) continue;
        if (!user.participations.some((part) => (rule.population !== "ECONOMIC_AGENT" || part.serviceRole === "ECONOMIC_AGENT") && isReportExpected({ periodStart: week.startsAt, periodEnd: new Date(week.endsAt.getTime() - 1), effectiveFrom: rule.effectiveFrom, participationStart: part.startsAt ?? part.observedAt, participationEnd: part.endsAt, absences: user.absences }))) continue;
        if (reports.some((report) => report.periodStart < week.endsAt && report.periodEnd >= week.startsAt)) continue;
        const dedupeKey = `report-due:${candidate.id}:${week.key}:${rule.id}`;
        const existing = await tx.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
        if (existing) continue;
        await tx.notification.create({ data: { userId: candidate.id, title: "Rapport attendu", body: `Le rapport de la semaine ${week.key} attend votre soumission.`, href: "/reports", dedupeKey } });
        count++;
      }
      return count;
    });
  }
  return sent;
}
