export type PointMode = "FIXED" | "PER_AMOUNT" | "PERCENTAGE" | "MULTIPLIER" | "MANUAL";
export interface PointRuleInput { mode: PointMode; fixedPoints?: number | undefined; amount?: bigint | undefined; amountStep?: bigint | undefined; pointsPerStep?: number | undefined; percentageBps?: number | undefined; multiplier?: number | undefined; manualPoints?: number | undefined; min?: number | undefined; max?: number | undefined; }
export function calculatePoints(rule: PointRuleInput): number {
  let points = 0;
  if (rule.mode === "FIXED") points = rule.fixedPoints ?? 0;
  if (rule.mode === "PER_AMOUNT") points = Number((rule.amount ?? 0n) / (rule.amountStep ?? 1n)) * (rule.pointsPerStep ?? 0);
  if (rule.mode === "PERCENTAGE") points = Math.floor(Number(rule.amount ?? 0n) * (rule.percentageBps ?? 0) / 10_000);
  if (rule.mode === "MULTIPLIER") points = Math.floor((rule.fixedPoints ?? 0) * (rule.multiplier ?? 1));
  if (rule.mode === "MANUAL") points = rule.manualPoints ?? 0;
  return Math.max(rule.min ?? Number.MIN_SAFE_INTEGER, Math.min(rule.max ?? Number.MAX_SAFE_INTEGER, points));
}
