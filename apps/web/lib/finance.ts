import { Prisma, type PointEventType, type TaxAssessmentStatus } from "@koeki/database";
import { calculatePoints } from "@koeki/domain";

export type Tx = Prisma.TransactionClient;

export async function writeAudit(tx: Tx, entry: { actorId: string | null; action: string; entityType: string; entityId: string; reason?: string | undefined; previousValues?: Prisma.InputJsonValue | undefined; newValues?: Prisma.InputJsonValue | undefined }) {
  await tx.auditLog.create({ data: {
    actorId: entry.actorId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId, requestId: crypto.randomUUID(),
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
    ...(entry.previousValues !== undefined ? { previousValues: entry.previousValues } : {}),
    ...(entry.newValues !== undefined ? { newValues: entry.newValues } : {})
  } });
}

export async function nextPaymentReceipt(tx: Tx) {
  const year = new Date().getFullYear();
  const count = await tx.taxPayment.count({ where: { receiptNumber: { startsWith: `PAY-${year}-` } } });
  return `PAY-${year}-${String(count + 1).padStart(6, "0")}`;
}

export async function nextTransactionReceipt(tx: Tx, type: "DONATION" | "BUYBACK") {
  const prefix = type === "BUYBACK" ? "BUY" : "DON";
  const year = new Date().getFullYear();
  const count = await tx.resourceTransaction.count({ where: { receiptNumber: { startsWith: `${prefix}-${year}-` } } });
  return `${prefix}-${year}-${String(count + 1).padStart(6, "0")}`;
}

/** Aggregates every active matching rule into a single ledger entry per (source, eventType) — the unique constraint makes double grants impossible. */
export async function awardPoints(tx: Tx, input: { ninjaId: string; eventType: PointEventType; amount: bigint; sourceType: string; sourceId: string }) {
  const now = new Date();
  const rules = await tx.pointRule.findMany({ where: { eventType: input.eventType, isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
  let total = 0;
  for (const rule of rules) total += calculatePoints({
    mode: rule.mode, fixedPoints: rule.fixedPoints ?? undefined, amount: input.amount, amountStep: rule.amountStep ?? undefined, pointsPerStep: rule.pointsPerStep ?? undefined,
    percentageBps: rule.mode === "PERCENTAGE" ? rule.multiplierBps ?? 0 : undefined, multiplier: rule.mode === "MULTIPLIER" ? (rule.multiplierBps ?? 10_000) / 10_000 : undefined,
    min: rule.minimum ?? undefined, max: rule.maximum ?? undefined
  });
  const firstRule = rules[0];
  if (total === 0 || !firstRule) return 0;
  const existing = await tx.pointLedgerEntry.findUnique({ where: { sourceType_sourceId_eventType: { sourceType: input.sourceType, sourceId: input.sourceId, eventType: input.eventType } } });
  if (existing) return 0;
  await tx.pointLedgerEntry.create({ data: { ninjaId: input.ninjaId, ruleId: firstRule.id, eventType: input.eventType, points: total, sourceType: input.sourceType, sourceId: input.sourceId } });
  return total;
}

/** Grants (or debits, with a negative amount) tax-exemption credit; unique per source. */
export async function grantExemption(tx: Tx, input: { ninjaId: string; amount: bigint; sourceType: string; sourceId: string; reason?: string | undefined }) {
  if (input.amount === 0n) return;
  const existing = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } } });
  if (existing) return;
  await tx.exemptionLedgerEntry.create({ data: { ninjaId: input.ninjaId, amount: input.amount, sourceType: input.sourceType, sourceId: input.sourceId, ...(input.reason !== undefined ? { reason: input.reason } : {}) } });
}

export async function exemptionBalance(tx: Tx, ninjaId: string): Promise<bigint> {
  const aggregate = await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId }, _sum: { amount: true } });
  return aggregate._sum.amount ?? 0n;
}

/** Recomputes an assessment's stored status from its immutable ledger lines. */
export async function refreshAssessmentStatus(tx: Tx, assessmentId: string, currentRpYear: number) {
  const assessment = await tx.taxAssessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: { penalties: { select: { amount: true } }, adjustments: { select: { amount: true } }, exemptions: { select: { amount: true } }, allocations: { select: { amount: true, payment: { select: { status: true } } } }, taxYear: { select: { rpYear: true } } }
  });
  const frozen: TaxAssessmentStatus[] = ["EXEMPT", "WAIVED", "SUSPENDED", "CANCELLED", "DRAFT"];
  if (frozen.includes(assessment.status)) return assessment.status;
  const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);
  const paid = sum(assessment.allocations.filter((entry) => entry.payment.status === "VALIDATED").map((entry) => entry.amount));
  const gross = assessment.originalAmount + sum(assessment.penalties.map((entry) => entry.amount)) + sum(assessment.adjustments.map((entry) => entry.amount)) - sum(assessment.exemptions.map((entry) => entry.amount));
  const remaining = gross - paid > 0n ? gross - paid : 0n;
  const now = new Date();
  const status: TaxAssessmentStatus = remaining === 0n ? "PAID" : assessment.dueAt < now ? "OVERDUE" : paid > 0n ? "PARTIALLY_PAID" : assessment.taxYear.rpYear > currentRpYear ? "UPCOMING" : "DUE";
  if (status !== assessment.status) await tx.taxAssessment.update({ where: { id: assessmentId }, data: { status, version: { increment: 1 } } });
  return status;
}

export function isUniqueViolation(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"; }

/** Names of the columns that violated a unique constraint — distinguishes a receipt-number collision (retryable) from an idempotency replay (duplicate). */
export function uniqueViolationTarget(error: unknown): string {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return "";
  const target = (error.meta as { target?: string[] | string } | undefined)?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

/** Retries a transaction when two concurrent writes computed the same receipt number. */
export async function withReceiptRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await run(); }
    catch (error) { if (uniqueViolationTarget(error).includes("receiptNumber")) { lastError = error; continue; } throw error; }
  }
  throw lastError;
}
