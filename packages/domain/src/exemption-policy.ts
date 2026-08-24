import { z } from "zod";

export const EXEMPTION_POLICY_SETTING_KEY = "exemptionPolicy";

/** Part maximale d'une taxe hebdomadaire que le crédit d'exonération peut couvrir.
 * Le crédit gagné reste intégralement historisé dans le registre, même à 0 %. */
export const exemptionPolicySchema = z.object({
  weeklyTaxCoverageBps: z.number().int().min(0).max(10_000)
});

export type ExemptionPolicy = z.infer<typeof exemptionPolicySchema>;

export const defaultExemptionPolicy: ExemptionPolicy = {
  weeklyTaxCoverageBps: 0
};

export function parseExemptionPolicy(value: unknown): ExemptionPolicy {
  const parsed = exemptionPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : defaultExemptionPolicy;
}

export function exemptionAllowance(input: {
  gross: bigint;
  alreadyExempted: bigint;
  coverageBps: number;
}): bigint {
  const gross = input.gross > 0n ? input.gross : 0n;
  const alreadyExempted = input.alreadyExempted > 0n ? input.alreadyExempted : 0n;
  const coverageBps = Math.max(0, Math.min(10_000, Math.trunc(input.coverageBps)));
  const ceiling = (gross * BigInt(coverageBps)) / 10_000n;
  return ceiling > alreadyExempted ? ceiling - alreadyExempted : 0n;
}

export function exemptionUse(input: {
  availableCredit: bigint;
  remainingDebt: bigint;
  gross: bigint;
  alreadyExempted: bigint;
  coverageBps: number;
}): bigint {
  if (input.availableCredit <= 0n || input.remainingDebt <= 0n || input.coverageBps <= 0) return 0n;
  const allowance = exemptionAllowance(input);
  return [input.availableCredit, input.remainingDebt, allowance].reduce((lowest, value) => value < lowest ? value : lowest);
}
