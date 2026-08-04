import type { Ryo } from "./money";
import { addRyo, percentOf, ryo } from "./money";

export const INITIAL_GRADE_RATES = {
  GENIN_APPRENTICE: ryo(0), GENIN: ryo(0), GENIN_CONFIRMED: ryo(10_000), CHUNIN: ryo(15_000),
  KONIN: ryo(20_000), TOKUBETSU_JONIN: ryo(25_000), JONIN: ryo(25_000), JONIN_COMMANDER: ryo(25_000), KAGE: ryo(0), SANIN: ryo(0)
} as const;

export type PenaltyBasis = "ORIGINAL_TAX" | "REMAINING_PRINCIPAL" | "CURRENT_DEBT";
export interface PenaltyConfig {
  latePenaltyPercentBps: number | null;
  latePenaltyBasis: PenaltyBasis;
  latePenaltyFrequencyRpYears: number;
  maxPenaltyApplications: number;
  maxAssessmentDebt: Ryo;
  isPenaltyAutomationEnabled: boolean;
  isRateValidated: boolean;
}
export interface AssessmentForPenalty { originalTax: Ryo; remainingPrincipal: Ryo; currentDebt: Ryo; appliedPenaltyIndexes: number[]; completeLateYears: number; }
export interface PenaltyDecision { index: number; amount: Ryo; capped: boolean; }

export function calculateNextPenalty(assessment: AssessmentForPenalty, config: PenaltyConfig): PenaltyDecision | null {
  if (!config.isPenaltyAutomationEnabled || !config.isRateValidated || config.latePenaltyPercentBps === null) return null;
  if (!Number.isInteger(config.latePenaltyPercentBps) || config.latePenaltyPercentBps <= 0) return null;
  const eligibleApplications = Math.min(config.maxPenaltyApplications, Math.floor(assessment.completeLateYears / config.latePenaltyFrequencyRpYears));
  const nextIndex = assessment.appliedPenaltyIndexes.length + 1;
  if (nextIndex > eligibleApplications || assessment.appliedPenaltyIndexes.includes(nextIndex) || assessment.currentDebt >= config.maxAssessmentDebt) return null;
  const base = config.latePenaltyBasis === "ORIGINAL_TAX" ? assessment.originalTax : config.latePenaltyBasis === "REMAINING_PRINCIPAL" ? assessment.remainingPrincipal : assessment.currentDebt;
  const raw = percentOf(base, config.latePenaltyPercentBps);
  const available = (config.maxAssessmentDebt - assessment.currentDebt) as Ryo;
  return { index: nextIndex, amount: raw > available ? available : raw, capped: raw > available };
}

export function assessmentDebt(principal: Ryo, penalties: Ryo[], adjustments: Ryo[], payments: Ryo[]) {
  const gross = addRyo(principal, ...penalties, ...adjustments);
  const paid = addRyo(...payments);
  return paid >= gross ? ryo(0) : ((gross - paid) as Ryo);
}
