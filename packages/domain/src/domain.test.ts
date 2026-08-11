import { describe, expect, it } from "vitest";
import { allocatePayment } from "./payments";
import { calculateNextPenalty, INITIAL_GRADE_RATES } from "./taxes";
import { createRpTimeService } from "./rp-time";
import { calculatePoints } from "./points";
import { simulateCraft } from "./crafting";
import { percentOf, ryo } from "./money";
import { can } from "./permissions";

describe("report permissions", () => {
  it("keeps reading, writing and reviewing as separate capabilities", () => {
    expect(can("SUPER_ADMIN", "reports:read")).toBe(true);
    expect(can("SUPER_ADMIN", "reports:read-all")).toBe(true);
    expect(can("SUPER_ADMIN", "reports:write")).toBe(true);
    expect(can("SUPER_ADMIN", "reports:review")).toBe(true);
    expect(can("KOEKI_MANAGER", "reports:review")).toBe(true);

    expect(can("ECONOMIC_AGENT", "reports:read")).toBe(true);
    expect(can("ECONOMIC_AGENT", "reports:read-all")).toBe(false);
    expect(can("ECONOMIC_AGENT", "reports:write")).toBe(true);
    expect(can("ECONOMIC_AGENT", "reports:review")).toBe(false);

    expect(can("AUDITOR", "reports:read")).toBe(true);
    expect(can("AUDITOR", "reports:read-all")).toBe(true);
    expect(can("AUDITOR", "reports:write")).toBe(false);
    expect(can("AUDITOR", "reports:review")).toBe(false);

    expect(can("NINJA", "reports:read")).toBe(false);
  });
});

describe("initial tax policy", () => {
  it("uses the exact configured grade rates", () => {
    expect(INITIAL_GRADE_RATES.GENIN_CONFIRMED).toBe(10_000n);
    expect(INITIAL_GRADE_RATES.CHUNIN).toBe(15_000n);
    expect(INITIAL_GRADE_RATES.KONIN).toBe(20_000n);
    expect(INITIAL_GRADE_RATES.JONIN).toBe(25_000n);
    expect(INITIAL_GRADE_RATES.KAGE).toBe(0n);
    expect(INITIAL_GRADE_RATES.SANIN).toBe(0n);
  });
  it("never uses floating point money", () => { expect(() => ryo(2.4)).toThrow(); expect(percentOf(ryo(10_000), 1_000)).toBe(1_000n); });
});

describe("RP time", () => {
  const service = createRpTimeService({ realAnchorAt: new Date("2026-01-01T00:00:00Z"), rpAnchorYear: 40, realMillisecondsPerRpYear: 604_800_000, timezone: "Europe/Paris", fiscalYearStartOffsetMs: 0, dueDelayMs: 259_200_000 });
  it("moves one RP year per real week", () => { expect(service.currentRpYear(new Date("2026-01-08T00:00:00Z"))).toBe(41); });
  it("calculates complete late years", () => { expect(service.completeLateYears(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-15T00:00:00Z"))).toBe(2); });
});

describe("late penalties", () => {
  const assessment = { originalTax: ryo(25_000), remainingPrincipal: ryo(25_000), currentDebt: ryo(25_000), appliedPenaltyIndexes: [], completeLateYears: 1 };
  const config = { latePenaltyPercentBps: 1_000, latePenaltyBasis: "ORIGINAL_TAX" as const, latePenaltyFrequencyRpYears: 1, maxPenaltyApplications: 4, maxAssessmentDebt: ryo(32_000), isPenaltyAutomationEnabled: true, isRateValidated: true };
  it("does not apply when rate is missing or unvalidated", () => { expect(calculateNextPenalty(assessment, { ...config, latePenaltyPercentBps: null })).toBeNull(); expect(calculateNextPenalty(assessment, { ...config, isRateValidated: false })).toBeNull(); });
  it("applies only after a complete late RP year", () => { expect(calculateNextPenalty({ ...assessment, completeLateYears: 0 }, config)).toBeNull(); expect(calculateNextPenalty(assessment, config)?.amount).toBe(2_500n); });
  it("respects the debt cap", () => { expect(calculateNextPenalty({ ...assessment, currentDebt: ryo(31_000) }, config)?.amount).toBe(1_000n); });
});

describe("payments", () => {
  it("allocates oldest debt, penalties before principal", () => {
    const result = allocatePayment(ryo(12_000), [
      { id: "principal-42", assessmentId: "42", rpYear: 42, kind: "PRINCIPAL", remaining: ryo(8_000) },
      { id: "penalty-42", assessmentId: "42", rpYear: 42, kind: "PENALTY", remaining: ryo(1_000) },
      { id: "principal-43", assessmentId: "43", rpYear: 43, kind: "PRINCIPAL", remaining: ryo(10_000) }
    ]);
    expect(result.allocations.map((item) => [item.debtLineId, item.amount])).toEqual([["penalty-42", 1_000n], ["principal-42", 8_000n], ["principal-43", 3_000n]]);
  });
});

describe("points and crafting", () => {
  it("caps point rules", () => { expect(calculatePoints({ mode: "PER_AMOUNT", amount: 50_000n, amountStep: 1_000n, pointsPerStep: 4, max: 150 })).toBe(150); });
  it("simulates without mutating stock", () => { const stocks = [{ resourceId: "wood", quantity: 10 }, { resourceId: "iron", quantity: 5 }]; const result = simulateCraft([{ resourceId: "wood", quantity: 3 }, { resourceId: "iron", quantity: 2 }], stocks); expect(result.maximum).toBe(2); expect(stocks[0]?.quantity).toBe(10); });
});
