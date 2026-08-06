import { describe, expect, it } from "vitest";
import {
  buildAgentScores, buildAmountBars, buildNinjaLeaderboard, buildTopResources,
  initialsOf, rateBps, rateDeltaBps, summarizeExemptionFlow, summarizeWeekCompliance
} from "./statistics";

describe("collection rate", () => {
  it("computes basis points with floor rounding", () => {
    expect(rateBps(286_500n, 401_000n)).toBe(7_144);
    expect(rateBps(1n, 3n)).toBe(3_333);
  });
  it("never divides by zero", () => {
    expect(rateBps(500n, 0n)).toBe(0);
    expect(rateBps(0n, 0n)).toBe(0);
  });
  it("caps naturally at 10 000 for full collection and can exceed it on overpayment", () => {
    expect(rateBps(10_000n, 10_000n)).toBe(10_000);
    expect(rateBps(12_000n, 10_000n)).toBe(12_000);
  });
});

describe("cycle-over-cycle delta", () => {
  it("is the difference of the two rates", () => {
    expect(rateDeltaBps({ expected: 100n, collected: 80n }, { expected: 100n, collected: 60n })).toBe(2_000);
    expect(rateDeltaBps({ expected: 100n, collected: 50n }, { expected: 100n, collected: 75n })).toBe(-2_500);
  });
  it("is null when either cycle expected nothing", () => {
    expect(rateDeltaBps({ expected: 0n, collected: 0n }, { expected: 100n, collected: 50n })).toBeNull();
    expect(rateDeltaBps({ expected: 100n, collected: 50n }, { expected: 0n, collected: 0n })).toBeNull();
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initialsOf("Sonemi Hakumei")).toBe("SH");
    expect(initialsOf("Kagemoto")).toBe("K");
    expect(initialsOf("  jean  du désert profond ")).toBe("JD");
  });
});

describe("amount bars", () => {
  it("sorts by amount and scales percents against the maximum", () => {
    const bars = buildAmountBars([
      { label: "Chunin", amount: 35_000n }, { label: "Jonin", amount: 56_000n }, { label: "Konin", amount: 14_000n }
    ]);
    expect(bars.map((bar) => bar.label)).toEqual(["Jonin", "Chunin", "Konin"]);
    expect(bars[0]?.percent).toBe(100);
    expect(bars[1]?.percent).toBe(62);
    expect(bars[2]?.percent).toBe(25);
  });
  it("breaks amount ties alphabetically and survives an empty input", () => {
    expect(buildAmountBars([{ label: "B", amount: 10n }, { label: "A", amount: 10n }]).map((bar) => bar.label)).toEqual(["A", "B"]);
    expect(buildAmountBars([])).toEqual([]);
  });
  it("yields zero percents when every amount is zero", () => {
    expect(buildAmountBars([{ label: "A", amount: 0n }])[0]?.percent).toBe(0);
  });
});

describe("agent scores", () => {
  it("weighs volume 60 % and amounts 40 %, relative to the busiest agent", () => {
    const rows = buildAgentScores([
      { name: "Sonemi Hakumei", payments: 10, collected: 100_000n, donations: 6, buybacks: 4 },
      { name: "Kaemon Tori", payments: 5, collected: 50_000n, donations: 3, buybacks: 2 }
    ]);
    expect(rows[0]?.name).toBe("Sonemi Hakumei");
    expect(rows[0]?.score).toBe(100);
    expect(rows[0]?.transactions).toBe(10);
    expect(rows[1]?.score).toBe(50);
  });
  it("keeps scores bounded and stable when nobody worked", () => {
    const rows = buildAgentScores([{ name: "Agent Kōeki", payments: 0, collected: 0n, donations: 0, buybacks: 0 }]);
    expect(rows[0]?.score).toBe(0);
    expect(rows[0]?.initials).toBe("AK");
  });
  it("never rewards money alone with a perfect score", () => {
    const rows = buildAgentScores([
      { name: "Gros Montants", payments: 1, collected: 1_000_000n, donations: 0, buybacks: 0 },
      { name: "Grosse Activité", payments: 10, collected: 1_000n, donations: 5, buybacks: 5 }
    ]);
    expect(rows.find((row) => row.name === "Gros Montants")?.score).toBe(43);
    expect(rows.find((row) => row.name === "Grosse Activité")?.score).toBe(60);
  });
});

describe("top resources", () => {
  it("aggregates by resource and flow direction, then keeps the busiest", () => {
    const rows = buildTopResources([
      { resourceId: "bois", type: "DONATION", name: "Bois", quantity: 10 },
      { resourceId: "bois", type: "DONATION", name: "Bois", quantity: 15 },
      { resourceId: "bois", type: "BUYBACK", name: "Bois", quantity: 4 },
      { resourceId: "fer", type: "DONATION", name: "Fer", quantity: 12 }
    ], 2);
    expect(rows).toEqual([
      { name: "Bois", type: "DONATION", quantity: 25 },
      { name: "Fer", type: "DONATION", quantity: 12 }
    ]);
  });
});

describe("ninja leaderboard", () => {
  it("keeps positive earners, best first, ties by name", () => {
    const rows = buildNinjaLeaderboard([
      { name: "Toshiro Makaze", code: "NIN-000001", points: 40 },
      { name: "Medo Nimto", code: "NIN-000002", points: 625 },
      { name: "Aoki Hoki", code: "NIN-000003", points: 40 },
      { name: "Sans Points", code: "NIN-000004", points: 0 },
      { name: "Correction", code: "NIN-000005", points: -20 }
    ], 3);
    expect(rows.map((row) => row.name)).toEqual(["Medo Nimto", "Aoki Hoki", "Toshiro Makaze"]);
  });
});

describe("week compliance", () => {
  it("splits settled, pending and overdue lines and computes the settled rate", () => {
    const summary = summarizeWeekCompliance(["PAID", "PAID", "EXEMPT", "UPCOMING", "DUE", "PARTIALLY_PAID", "OVERDUE"]);
    expect(summary).toEqual({ settled: 3, pending: 3, overdue: 1, total: 7, settledRateBps: 4_285 });
  });
  it("ignores statuses that are out of the cycle economy and survives emptiness", () => {
    expect(summarizeWeekCompliance(["WAIVED", "CANCELLED", "SUSPENDED", "DRAFT"]).total).toBe(0);
    expect(summarizeWeekCompliance([]).settledRateBps).toBe(0);
  });
});

describe("exemption flow", () => {
  const day = (iso: string) => new Date(iso);
  it("separates cycle inflow and outflow while the outstanding balance stays all-time", () => {
    const flow = summarizeExemptionFlow([
      { amount: 5_000n, createdAt: day("2026-07-01T00:00:00Z") },
      { amount: 3_000n, createdAt: day("2026-08-03T00:00:00Z") },
      { amount: -2_000n, createdAt: day("2026-08-04T00:00:00Z") },
      { amount: -500n, createdAt: day("2026-06-01T00:00:00Z") }
    ], day("2026-08-02T00:00:00Z"));
    expect(flow.granted).toBe(3_000n);
    expect(flow.spent).toBe(2_000n);
    expect(flow.outstanding).toBe(5_500n);
  });
  it("returns zeros on an empty ledger", () => {
    expect(summarizeExemptionFlow([], day("2026-08-02T00:00:00Z"))).toEqual({ granted: 0n, spent: 0n, outstanding: 0n });
  });
});
