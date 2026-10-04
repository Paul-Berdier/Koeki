import { describe, expect, it } from "vitest";
import { adjacentRankingWeek, buildWeeklyRanking, rankingComparison, rankingWeekAt, rankingWeekFromKey, type RankingOperation, type RankingParticipation } from "./weekly-ranking";

describe("Paris civil activity weeks", () => {
  it("uses inclusive Monday and exclusive following Monday", () => {
    const week = rankingWeekAt(new Date("2026-10-04T22:00:00Z"));
    expect(week.key).toBe("2026-W41");
    expect(rankingWeekAt(new Date(week.endsAt.getTime() - 1)).key).toBe(week.key);
    expect(rankingWeekAt(week.endsAt).key).toBe("2026-W42");
  });
  it("handles both daylight-saving transitions without 168h arithmetic", () => {
    const spring = rankingWeekFromKey("2026-W13"), autumn = rankingWeekFromKey("2026-W43");
    expect((spring.endsAt.getTime() - spring.startsAt.getTime()) / 3_600_000).toBe(167);
    expect((autumn.endsAt.getTime() - autumn.startsAt.getTime()) / 3_600_000).toBe(169);
    expect(adjacentRankingWeek(spring, 1).startsAt).toEqual(spring.endsAt);
  });
  it("honors ISO year boundaries and rejects invalid week 53", () => {
    expect(rankingWeekAt(new Date("2021-01-01T12:00Z")).key).toBe("2020-W53");
    expect(adjacentRankingWeek(rankingWeekFromKey("2020-W53"), 1).key).toBe("2021-W01");
    expect(() => rankingWeekFromKey("2021-W53")).toThrow();
  });
});
const week = rankingWeekFromKey("2026-W41");
const participant = (userId: string, extra: Partial<RankingParticipation> = {}): RankingParticipation => ({ id: `p-${userId}`, userId, name: userId, startsAt: new Date("2026-01-01"), observedAt: new Date("2026-01-01"), endsAt: null, rankingEligible: true, ...extra });
const operation = (id: string, extra: Partial<RankingOperation> = {}): RankingOperation => ({ id, authorId: "a", amount: 9007199254740993n, kind: "PAYMENT", status: "VALIDATED", firstValidatedAt: week.startsAt, validationEvidence: "SERVER", operationOrigin: "BUSINESS", ...extra });
const coverage = new Date("2026-01-01");
describe("distinct validated business activity", () => {
  it("includes zero agents and stable shared competition ranks without rewarding extra stock lines", () => {
    const a = operation("p1"), b = operation("p2", { authorId: "b" });
    const snapshot = buildWeeklyRanking(week, [participant("z"), participant("b"), participant("a")], [b, a, a], coverage);
    expect(snapshot.rows.map((r) => [r.userId, r.rank, r.operations])).toEqual([["a", 1, 1], ["b", 1, 1], ["z", 3, 0]]);
    expect(snapshot.rows[0]!.collected).toBe("9007199254740993");
  });
  it("counts distinct payments, donations and buybacks once and excludes all ineligible states", () => {
    const ops = [operation("p"), operation("d", { kind: "DONATION" }), operation("b", { kind: "BUYBACK" }), ...["PENDING", "CANCELLED", "REVERSED", "DRAFT"].map((status) => operation(status, { status })), operation("import", { operationOrigin: "IMPORT" }), operation("tech", { operationOrigin: "TECHNICAL" }), operation("end", { firstValidatedAt: week.endsAt }), operation("admin", { authorId: "technical-admin" })];
    const snapshot = buildWeeklyRanking(week, [participant("a")], ops, coverage);
    expect(snapshot.rows[0]).toMatchObject({ operations: 3, payments: 1, donations: 1, buybacks: 1 });
  });
  it("retains past participation after an exit and excludes dates before observed entry", () => {
    const snapshot = buildWeeklyRanking(week, [participant("a", { endsAt: new Date("2026-10-09") }), participant("b", { startsAt: null, observedAt: new Date("2026-10-07") }), participant("c", { rankingEligible: false })], [operation("a"), operation("b", { authorId: "b" })], coverage);
    expect(snapshot.rows.map((r) => [r.userId, r.operations])).toEqual([["a", 1], ["b", 0]]);
  });
  it("does not turn unknown validation dates or an incomplete historical period into official results", () => {
    const snapshot = buildWeeklyRanking(week, [participant("a")], [operation("unknown", { firstValidatedAt: null })], coverage);
    expect(snapshot.excludedUnknown).toBe(1);
    expect(snapshot.coverageComplete).toBe(false);
    expect(buildWeeklyRanking(week, [], [], week.endsAt).coverageComplete).toBe(false);
    expect(buildWeeklyRanking(week, [participant("a")], [operation("pending", { status: "PENDING", firstValidatedAt: null })], coverage).coverageComplete).toBe(true);
  });
  it("preserves full-week comparison across contiguous eligible role periods but rejects gaps", () => {
    const split = new Date("2026-10-07T10:00:00Z");
    const before = participant("a", { id: "before", endsAt: split });
    const after = participant("a", { id: "after", startsAt: split });
    const boundaryOperation = operation("boundary", { firstValidatedAt: split });
    const previous = buildWeeklyRanking(week, [participant("a")], [boundaryOperation], coverage);
    const contiguous = buildWeeklyRanking(week, [after, before], [boundaryOperation, boundaryOperation], coverage);
    expect(contiguous.rows).toHaveLength(1);
    expect(contiguous.rows[0]).toMatchObject({ fullWeek: true, operations: 1 });
    expect(rankingComparison(contiguous, previous, "a", true)).toBe(0);

    const gap = buildWeeklyRanking(week, [before, { ...after, startsAt: new Date(split.getTime() + 1) }], [boundaryOperation], coverage);
    expect(gap.rows[0]).toMatchObject({ fullWeek: false, operations: 0 });
    expect(rankingComparison(gap, previous, "a", true)).toBeNull();
    const ineligibleEnd = buildWeeklyRanking(week, [before, { ...after, rankingEligible: false }], [], coverage);
    expect(ineligibleEnd.rows[0]!.fullWeek).toBe(false);
  });
  it("does not invent progression across incomplete, ongoing, new or changed populations", () => {
    const current = buildWeeklyRanking(week, [participant("a")], [operation("a")], coverage);
    expect(rankingComparison(current, current, "a", false)).toBeNull();
    expect(rankingComparison(current, null, "a", true)).toBeNull();
    expect(rankingComparison(current, { ...current, coverageComplete: false }, "a", true)).toBeNull();
    expect(rankingComparison(current, { ...current, rows: [] }, "a", true)).toBeNull();
    expect(rankingComparison(current, current, "a", true)).toBe(0);
  });
});
