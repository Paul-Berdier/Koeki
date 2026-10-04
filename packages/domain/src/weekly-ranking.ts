/** Activity calendar, deliberately independent from the fiscal RP clock. */
export const RANKING_FORMULA_VERSION = "distinct-validated-operations-v1";
export const RANKING_TIME_ZONE = "Europe/Paris";
const dayMs = 86_400_000;
const paris = new Intl.DateTimeFormat("en-CA", { timeZone: RANKING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function localParts(date: Date) {
  const parts = Object.fromEntries(paris.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
function parisMidnight(civil: Date): Date {
  const target = Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate());
  let instant = target;
  for (let index = 0; index < 3; index++) {
    const p = localParts(new Date(instant));
    instant += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return new Date(instant);
}
export interface RankingWeek { key: string; startsAt: Date; endsAt: Date }
export function rankingWeekAt(instant: Date): RankingWeek {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid ranking date");
  const p = localParts(instant);
  const civil = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const monday = new Date(civil.getTime() - ((civil.getUTCDay() + 6) % 7) * dayMs);
  const thursday = new Date(monday.getTime() + 3 * dayMs);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / dayMs + 1) / 7);
  return { key: `${year}-W${String(week).padStart(2, "0")}`, startsAt: parisMidnight(monday), endsAt: parisMidnight(new Date(monday.getTime() + 7 * dayMs)) };
}
export function rankingWeekFromKey(key: string): RankingWeek {
  const match = /^(20\d{2})-W(\d{2})$/.exec(key);
  if (!match) throw new Error("Semaine ISO invalide");
  const year = Number(match[1]), week = Number(match[2]);
  const fourth = new Date(Date.UTC(year, 0, 4, 12));
  const monday = new Date(fourth.getTime() - ((fourth.getUTCDay() + 6) % 7) * dayMs + (week - 1) * 7 * dayMs);
  const result = rankingWeekAt(monday);
  if (result.key !== key) throw new Error("Semaine ISO invalide");
  return result;
}
export function adjacentRankingWeek(week: RankingWeek, direction: -1 | 1) {
  return rankingWeekAt(new Date(direction === -1 ? week.startsAt.getTime() - 1 : week.endsAt.getTime()));
}
export interface RankingParticipation { id: string; userId: string; name: string; startsAt: Date | null; observedAt: Date; endsAt: Date | null; rankingEligible: boolean }
export interface RankingOperation { id: string; kind: "PAYMENT" | "DONATION" | "BUYBACK"; authorId: string | null; amount: bigint; status: string; firstValidatedAt: Date | null; validationEvidence: string | null; operationOrigin: string }
export interface RankingContribution { id: string; kind: RankingOperation["kind"]; authorId: string; amount: string; validatedAt: string }
export interface RankingRow { userId: string; name: string; rank: number; operations: number; payments: number; donations: number; buybacks: number; collected: string; donated: string; bought: string; fullWeek: boolean }
export interface RankingSnapshot { formulaVersion: string; weekKey: string; startsAt: string; endsAt: string; coverageComplete: boolean; excludedUnknown: number; population: Array<{ id: string; userId: string; startsAt: string; endsAt: string | null }>; rows: RankingRow[]; contributions: RankingContribution[] }
export function buildWeeklyRanking(week: RankingWeek, participants: RankingParticipation[], operations: RankingOperation[], coverageFrom: Date | null): RankingSnapshot {
  const eligible = participants.filter((p) => p.rankingEligible && (p.startsAt ?? p.observedAt) < week.endsAt && (!p.endsAt || p.endsAt > week.startsAt));
  const rows = new Map<string, RankingRow>();
  const coveredUntil = new Map<string, number>();
  // A role change may split uninterrupted eligible service into adjacent periods.
  // Extend coverage in date order; any real gap keeps the week incomplete.
  for (const p of [...eligible].sort((a, b) => (a.startsAt ?? a.observedAt).getTime() - (b.startsAt ?? b.observedAt).getTime())) {
    const cursor = coveredUntil.get(p.userId) ?? week.startsAt.getTime();
    const end = p.endsAt?.getTime() ?? week.endsAt.getTime();
    const covered = (p.startsAt ?? p.observedAt).getTime() <= cursor ? Math.max(cursor, end) : cursor;
    coveredUntil.set(p.userId, covered);
    const fullWeek = covered >= week.endsAt.getTime();
    const existing = rows.get(p.userId);
    if (existing) existing.fullWeek = fullWeek;
    else rows.set(p.userId, { userId: p.userId, name: p.name, rank: 0, operations: 0, payments: 0, donations: 0, buybacks: 0, collected: "0", donated: "0", bought: "0", fullWeek });
  }
  const contributions: RankingContribution[] = [], seen = new Set<string>();
  let excludedUnknown = 0;
  for (const op of operations) {
    if (op.status !== "VALIDATED") continue;
    if (op.operationOrigin !== "BUSINESS" && op.operationOrigin !== "SELF_DECLARED") continue;
    if (!op.firstValidatedAt || !["SERVER", "AUDIT_BACKFILL"].includes(op.validationEvidence ?? "") || !op.authorId) { excludedUnknown++; continue; }
    if (op.firstValidatedAt < week.startsAt || op.firstValidatedAt >= week.endsAt) continue;
    const row = rows.get(op.authorId);
    if (!row || !eligible.some((p) => p.userId === op.authorId && (p.startsAt ?? p.observedAt) <= op.firstValidatedAt! && (!p.endsAt || p.endsAt > op.firstValidatedAt!))) continue;
    const identity = `${op.kind}:${op.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    row.operations++;
    if (op.kind === "PAYMENT") { row.payments++; row.collected = String(BigInt(row.collected) + op.amount); }
    else if (op.kind === "DONATION") { row.donations++; row.donated = String(BigInt(row.donated) + op.amount); }
    else { row.buybacks++; row.bought = String(BigInt(row.bought) + op.amount); }
    contributions.push({ id: op.id, kind: op.kind, authorId: op.authorId, amount: String(op.amount), validatedAt: op.firstValidatedAt.toISOString() });
  }
  const sorted = [...rows.values()].sort((a, b) => b.operations - a.operations || a.userId.localeCompare(b.userId));
  sorted.forEach((row, index) => { row.rank = index > 0 && sorted[index - 1]!.operations === row.operations ? sorted[index - 1]!.rank : index + 1; });
  return { formulaVersion: RANKING_FORMULA_VERSION, weekKey: week.key, startsAt: week.startsAt.toISOString(), endsAt: week.endsAt.toISOString(), coverageComplete: coverageFrom !== null && coverageFrom <= week.startsAt && excludedUnknown === 0, excludedUnknown, population: eligible.map((p) => ({ id: p.id, userId: p.userId, startsAt: (p.startsAt ?? p.observedAt).toISOString(), endsAt: p.endsAt?.toISOString() ?? null })).sort((a, b) => a.id.localeCompare(b.id)), rows: sorted, contributions: contributions.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)) };
}
export function rankingComparison(current: RankingSnapshot, previous: RankingSnapshot | null, userId: string, closed: boolean): number | null {
  const row = current.rows.find((r) => r.userId === userId), prior = previous?.rows.find((r) => r.userId === userId);
  if (!closed || !previous || !current.coverageComplete || !previous.coverageComplete || current.formulaVersion !== previous.formulaVersion || !row?.fullWeek || !prior?.fullWeek) return null;
  if (current.rows.map((r) => r.userId).sort().join("|") !== previous.rows.map((r) => r.userId).sort().join("|")) return null;
  return prior.rank - row.rank;
}
