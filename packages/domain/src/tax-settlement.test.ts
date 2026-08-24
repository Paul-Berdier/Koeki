import { describe, expect, it } from "vitest";
import { assessmentSettlementBreakdown } from "./tax-settlement";

describe("assessment settlement breakdown", () => {
  it("settles penalties with Ryō before reducing principal", () => {
    expect(assessmentSettlementBreakdown({ original: 10_000n, penalties: 2_000n, adjustments: 0n, exemptions: 0n, paid: 2_000n })).toEqual({
      grossAfterExemptions: 12_000n,
      currentDebt: 10_000n,
      remainingPenalty: 0n,
      remainingPrincipal: 10_000n
    });
  });

  it("lets exemptions reduce the non-penalty block before overflowing onto penalties", () => {
    expect(assessmentSettlementBreakdown({ original: 10_000n, penalties: 5_000n, adjustments: 0n, exemptions: 12_000n, paid: 0n })).toEqual({
      grossAfterExemptions: 3_000n,
      currentDebt: 3_000n,
      remainingPenalty: 3_000n,
      remainingPrincipal: 0n
    });
  });

  it("clamps an over-settled ledger to zero debt", () => {
    expect(assessmentSettlementBreakdown({ original: 10_000n, penalties: 0n, adjustments: -1_000n, exemptions: 5_000n, paid: 5_000n }).currentDebt).toBe(0n);
  });
});
