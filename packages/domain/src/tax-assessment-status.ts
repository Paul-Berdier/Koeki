export type DerivedTaxAssessmentStatus =
  | "DRAFT" | "UPCOMING" | "DUE" | "PARTIALLY_PAID" | "PAID" | "OVERDUE"
  | "EXEMPT" | "WAIVED" | "SUSPENDED" | "CANCELLED";

const FROZEN: DerivedTaxAssessmentStatus[] = ["DRAFT", "EXEMPT", "WAIVED", "SUSPENDED", "CANCELLED"];

/** Dérive l'état depuis le grand livre. Le passage de l'échéance ne peut jamais
 * solder une taxe : tant qu'un reste existe, elle devient simplement en retard. */
export function deriveTaxAssessmentStatus(input: {
  storedStatus: DerivedTaxAssessmentStatus;
  remaining: bigint;
  settled: bigint;
  preserveLegacyOverdue: boolean;
  dueAt: Date;
  now: Date;
  assessmentRpYear: number;
  currentRpYear: number;
}): DerivedTaxAssessmentStatus {
  if (FROZEN.includes(input.storedStatus)) return input.storedStatus;
  if (input.remaining <= 0n) return input.preserveLegacyOverdue ? "OVERDUE" : "PAID";
  if (input.dueAt < input.now) return "OVERDUE";
  if (input.settled > 0n) return "PARTIALLY_PAID";
  return input.assessmentRpYear > input.currentRpYear ? "UPCOMING" : "DUE";
}
