import { prisma } from "@koeki/database";
import { demoMode, hasPermission, type SessionInfo } from "./session";
import { resolveTeamPeriod, type AnalyticsFilters } from "./team-analytics";

/** Activity history, NOT an assignment or an access restriction. */
export async function getHandledNinjas(session: SessionInfo, userId: string, filters: AnalyticsFilters = {}) {
  if (!hasPermission(session, "team:read")) throw new Error("FORBIDDEN");
  if (demoMode) return [];
  const period = resolveTeamPeriod(filters);
  const where = { recordedById: userId, validatedAt: { gte: period.startsAt, lt: period.endsAtExclusive }, operationOrigin: { in: ["BUSINESS", "SELF_DECLARED"] } };
  const [payments, transactions] = await Promise.all([
    prisma.taxPayment.findMany({ where: { ...where, status: "VALIDATED" }, select: { ninjaId: true }, distinct: ["ninjaId"] }),
    prisma.resourceTransaction.findMany({ where: { ...where, status: "VALIDATED", movements: { none: { reversal: { isNot: null } } } }, select: { ninjaId: true }, distinct: ["ninjaId"] }),
  ]);
  const ids = [...new Set([...payments, ...transactions].map(({ ninjaId }) => ninjaId))];
  return prisma.ninjaProfile.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, status: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }] });
}
