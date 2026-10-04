import "server-only";
import { notFound } from "next/navigation";
import { calculateRanking, prisma, rankingFingerprint } from "@koeki/database";
import { adjacentRankingWeek, rankingComparison, rankingWeekAt, rankingWeekFromKey, type RankingSnapshot } from "@koeki/domain";
import { demoMode, hasPermission, requirePermission } from "./session";

/** Explicit projection: other agents' sources, participation and review reasons
 * are never serialized into the collective ranking. */
export async function getWeeklyRanking(key?: string, version?: number) {
  const session = await requirePermission("ranking:read");
  const now = new Date(), current = rankingWeekAt(now);
  let week = current;
  if (key) { try { week = rankingWeekFromKey(key); } catch { notFound(); } }
  if (week.startsAt > now) week = current;
  const manager = hasPermission(session, "ranking:manage"), previousWeek = adjacentRankingWeek(week, -1);
  if (demoMode) return { week, currentKey: current.key, previousKey: previousWeek.key, nextKey: adjacentRankingWeek(week, 1).key, closed: false, manager, demo: true, rows: [], own: null, sources: [], versions: [], version: null, latestVersion: null, correctionNeeded: false, coverageComplete: false, excludedUnknown: 0, calculatedAt: now };
  const [live, period, previous] = await Promise.all([
    prisma.$transaction((tx) => calculateRanking(tx, week)),
    prisma.rankingPeriod.findUnique({ where: { weekKey: week.key }, include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, snapshot: true, fingerprint: true, reason: true, createdAt: true } } } }),
    prisma.rankingPeriod.findUnique({ where: { weekKey: previousWeek.key }, include: { versions: { orderBy: { version: "desc" }, take: 1, select: { snapshot: true } } } })
  ]);
  const latest = period?.versions[0], selected = (version ? period?.versions.find((v) => v.version === version) : null) ?? latest;
  const snapshot = selected ? selected.snapshot as unknown as RankingSnapshot : live;
  const prior = previous?.versions[0]?.snapshot as unknown as RankingSnapshot | undefined;
  const closed = Boolean(selected), correctionNeeded = Boolean(latest && (period?.correctionNeeded || latest.fingerprint !== rankingFingerprint(live)));
  const rows = snapshot.rows.map((row) => ({ ...row, comparison: correctionNeeded || previous?.correctionNeeded || selected?.id !== latest?.id ? null : rankingComparison(snapshot, prior ?? null, row.userId, closed) }));
  return {
    week, currentKey: current.key, previousKey: previousWeek.key, nextKey: adjacentRankingWeek(week, 1).key, closed, manager, demo: false,
    rows, own: rows.find((row) => row.userId === session.userId) ?? null,
    sources: snapshot.contributions.filter((source) => manager || source.authorId === session.userId),
    versions: (period?.versions ?? []).map((v) => ({ version: v.version, createdAt: v.createdAt, ...(manager ? { reason: v.reason } : {}) })),
    version: selected?.version ?? null, latestVersion: latest?.version ?? null, correctionNeeded, coverageComplete: snapshot.coverageComplete, excludedUnknown: snapshot.excludedUnknown, calculatedAt: selected?.createdAt ?? now
  };
}

export async function getRankingContribution(kind: string, id: string) {
  const session = await requirePermission("ranking:read");
  if (demoMode || !["PAYMENT", "DONATION", "BUYBACK"].includes(kind)) notFound();
  const manager = hasPermission(session, "ranking:manage");
  const payment = kind === "PAYMENT" ? await prisma.taxPayment.findFirst({ where: { id, ...(manager ? {} : { recordedById: session.userId }) }, select: { id: true, receiptNumber: true, recordedById: true, ninjaId: true, amount: true, status: true, firstValidatedAt: true, validationEvidence: true, operationOrigin: true } }) : null;
  const transaction = kind !== "PAYMENT" ? await prisma.resourceTransaction.findFirst({ where: { id, type: kind as "DONATION" | "BUYBACK", ...(manager ? {} : { recordedById: session.userId }) }, select: { id: true, receiptNumber: true, recordedById: true, ninjaId: true, totalAmount: true, status: true, firstValidatedAt: true, validationEvidence: true, operationOrigin: true } }) : null;
  if (!payment && !transaction) notFound();
  return { ...(payment ?? transaction!), kind, amount: payment?.amount ?? transaction!.totalAmount, canReadNinja: hasPermission(session, "business:read") };
}
