import { describe, expect, it } from "vitest";
import { exemptionAllowance, exemptionUse, parseExemptionPolicy } from "./exemption-policy";

describe("exemption policy", () => {
  it("defaults to zero when the setting is absent or invalid", () => {
    expect(parseExemptionPolicy(undefined).weeklyTaxCoverageBps).toBe(0);
    expect(parseExemptionPolicy({ weeklyTaxCoverageBps: 20_000 }).weeklyTaxCoverageBps).toBe(0);
  });

  it("keeps all credit unused at zero percent", () => {
    expect(exemptionUse({ availableCredit: 50_000n, remainingDebt: 10_000n, gross: 10_000n, alreadyExempted: 0n, coverageBps: 0 })).toBe(0n);
  });

  it("caps coverage to the configured share of the gross weekly charge", () => {
    expect(exemptionAllowance({ gross: 20_000n, alreadyExempted: 2_000n, coverageBps: 2_500 })).toBe(3_000n);
    expect(exemptionUse({ availableCredit: 50_000n, remainingDebt: 18_000n, gross: 20_000n, alreadyExempted: 2_000n, coverageBps: 2_500 })).toBe(3_000n);
  });

  it("never reverses an exemption already above a newly lowered ceiling", () => {
    expect(exemptionAllowance({ gross: 10_000n, alreadyExempted: 8_000n, coverageBps: 5_000 })).toBe(0n);
  });
});
