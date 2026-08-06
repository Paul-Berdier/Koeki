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

/** Multiplies a decimal quantity (4-digit precision) by an integer bigint rate, flooring the result. */
export const scaledTimes = (quantity: number, rate: bigint) => (BigInt(Math.round(quantity * 10_000)) * rate) / 10_000n;

export async function activePrice(tx: Tx, resourceId: string) {
  const price = await tx.resourcePriceHistory.findFirst({ where: { resourceId, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: "desc" } });
  return price?.pricePerUnit ?? null;
}

/** Applies the side effects of a VALIDATED resource transaction: stock movements, points
 *  (per-unit scale plus any active rule for donations, rules only for buybacks) and
 *  tax-exemption credit. Shared by agent-recorded flows and ninja self-declarations. */
export async function applyValidatedTransaction(tx: Tx, transaction: { id: string; type: "DONATION" | "BUYBACK"; ninjaId: string; receiptNumber: string; totalAmount: bigint; idempotencyKey: string }, items: Array<{ resourceId: string; quantity: number; unitPrice: bigint; exemptionPerUnit: bigint; pointsPerUnit: number }>, actorId: string) {
  for (const item of items) await tx.inventoryMovement.create({ data: {
    resourceId: item.resourceId, type: transaction.type === "BUYBACK" ? "BUYBACK_IN" : "DONATION_IN", quantity: new Prisma.Decimal(item.quantity),
    unitCost: item.unitPrice, transactionId: transaction.id, agentId: actorId, justification: `Reçu ${transaction.receiptNumber}`, idempotencyKey: `${transaction.idempotencyKey}:${item.resourceId}`
  } });
  // Old-register scale: a donation earns each resource's own points per donated unit.
  const basePoints = transaction.type === "DONATION" ? items.reduce((total, item) => total + Number(scaledTimes(item.quantity, BigInt(item.pointsPerUnit))), 0) : 0;
  const points = await awardPoints(tx, { ninjaId: transaction.ninjaId, eventType: transaction.type === "BUYBACK" ? "RESOURCE_SALE" : "DONATION", amount: transaction.totalAmount, sourceType: "ResourceTransaction", sourceId: transaction.id, basePoints });
  if (points > 0) await tx.resourceTransaction.update({ where: { id: transaction.id }, data: { totalPoints: points } });
  // Old-register economy: giving resources earns tax-exemption credit, never direct Ryo.
  // Donations use each resource's per-unit exemption rate; buybacks credit the buyback price.
  const exemption = transaction.type === "BUYBACK" ? transaction.totalAmount : items.reduce((total, item) => total + scaledTimes(item.quantity, item.exemptionPerUnit), 0n);
  await grantExemption(tx, { ninjaId: transaction.ninjaId, amount: exemption, sourceType: "ResourceTransaction", sourceId: transaction.id, reason: `${transaction.type === "BUYBACK" ? "Rachat" : "Don"} ${transaction.receiptNumber}` });
}

/** Aggregates the per-unit base points and every active matching rule into a single ledger entry per (source, eventType) — the unique constraint makes double grants impossible. */
export async function awardPoints(tx: Tx, input: { ninjaId: string; eventType: PointEventType; amount: bigint; sourceType: string; sourceId: string; basePoints?: number | undefined }) {
  const now = new Date();
  const rules = await tx.pointRule.findMany({ where: { eventType: input.eventType, isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
  let total = input.basePoints ?? 0;
  for (const rule of rules) total += calculatePoints({
    mode: rule.mode, fixedPoints: rule.fixedPoints ?? undefined, amount: input.amount, amountStep: rule.amountStep ?? undefined, pointsPerStep: rule.pointsPerStep ?? undefined,
    percentageBps: rule.mode === "PERCENTAGE" ? rule.multiplierBps ?? 0 : undefined, multiplier: rule.mode === "MULTIPLIER" ? (rule.multiplierBps ?? 10_000) / 10_000 : undefined,
    min: rule.minimum ?? undefined, max: rule.maximum ?? undefined
  });
  if (total === 0) return 0;
  const existing = await tx.pointLedgerEntry.findUnique({ where: { sourceType_sourceId_eventType: { sourceType: input.sourceType, sourceId: input.sourceId, eventType: input.eventType } } });
  if (existing) return 0;
  await tx.pointLedgerEntry.create({ data: { ninjaId: input.ninjaId, ruleId: rules[0]?.id ?? null, eventType: input.eventType, points: total, sourceType: input.sourceType, sourceId: input.sourceId } });
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
