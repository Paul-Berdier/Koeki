import { describe, expect, it } from "vitest";
import { planLegacySettlement } from "./legacy-settlement";

describe("legacy settlement planner", () => {
  it("uses only Ryō at zero percent", () => {
    const plan = planLegacySettlement({ weeks: 3, ryo: 6n, availableCredit: 100n, coverageBps: 0 });
    expect(plan?.lines).toEqual([
      { ryo: 2n, credit: 0n, debt: 2n },
      { ryo: 2n, credit: 0n, debt: 2n },
      { ryo: 2n, credit: 0n, debt: 2n }
    ]);
    expect(plan?.unusedCredit).toBe(100n);
  });

  it("keeps credit made unusable by per-line rounding in the wallet", () => {
    const plan = planLegacySettlement({ weeks: 3, ryo: 6n, availableCredit: 2n, coverageBps: 2_500 });
    expect(plan?.lines.every((line) => line.ryo === 2n && line.credit === 0n)).toBe(true);
    expect(plan?.unusedCredit).toBe(2n);
  });

  it("applies partial credit only within each created debt ceiling", () => {
    const plan = planLegacySettlement({ weeks: 3, ryo: 9n, availableCredit: 3n, coverageBps: 2_500 });
    expect(plan?.lines).toEqual([
      { ryo: 3n, credit: 1n, debt: 4n },
      { ryo: 3n, credit: 1n, debt: 4n },
      { ryo: 3n, credit: 1n, debt: 4n }
    ]);
    for (const line of plan?.lines ?? []) expect(line.credit).toBeLessThanOrEqual((line.debt * 2_500n) / 10_000n);
  });

  it("allows credit-only settlement at one hundred percent", () => {
    expect(planLegacySettlement({ weeks: 3, ryo: 0n, availableCredit: 3n, coverageBps: 10_000 })?.lines)
      .toEqual(Array.from({ length: 3 }, () => ({ ryo: 0n, credit: 1n, debt: 1n })));
  });

  it("rejects plans that cannot touch every selected week", () => {
    expect(planLegacySettlement({ weeks: 5, ryo: 3n, availableCredit: 9n, coverageBps: 7_500 })).toBeNull();
  });
});
