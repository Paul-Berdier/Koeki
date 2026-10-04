import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { Prisma, prisma } from "@koeki/database";
import { applyValidatedTransaction, autoCoverOpenTaxes, awardPoints, businessOperationEvidence, exemptionBalance, grantExemption, lockActiveNinja, refreshAssessmentStatus, scaledTimes, writeAudit } from "./finance";
import { ledgerStock, reverseMovement } from "./inventory-ledger";
import { createTestNinja, createTestResource, createTestUser, ensureReferential } from "./test-fixtures";

type Tx = Prisma.TransactionClient;

/** Real PostgreSQL/finance-helper tests, not authorization or browser tests.
 * Scenario-specific rate fixtures are transaction-local and rolled back, so no
 * existing configuration, financial ledger or test fixture is deleted/reset. */
async function isolatedScenario(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error("ROLLBACK_FINANCE_V2_FIXTURE");
  try {
    await prisma.$transaction(async (tx) => { await run(tx); throw rollback; }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function rates(tx: Tx, coverageBps: number) {
  await tx.appSetting.upsert({ where: { key: "exemptionPolicy" }, create: { key: "exemptionPolicy", value: { weeklyTaxCoverageBps: coverageBps } }, update: { value: { weeklyTaxCoverageBps: coverageBps } } });
  // These updates never commit; unrelated point events are not touched.
  await tx.pointRule.updateMany({ where: { eventType: { in: ["TAX_PAYMENT", "DONATION", "RESOURCE_SALE", "REVERSAL"] }, isActive: true }, data: { isActive: false } });
  await tx.pointRule.createMany({ data: [
    { name: `Finance V2 paiement ${randomUUID()}`, eventType: "TAX_PAYMENT", mode: "FIXED", fixedPoints: 3, startsAt: new Date("2000-01-01") },
    { name: `Finance V2 don ${randomUUID()}`, eventType: "DONATION", mode: "FIXED", fixedPoints: 7, startsAt: new Date("2000-01-01") },
    { name: `Finance V2 rachat ${randomUUID()}`, eventType: "RESOURCE_SALE", mode: "FIXED", fixedPoints: 5, startsAt: new Date("2000-01-01") }
  ] });
}

describe.skipIf(!inject("dbReady"))("financial invariants after V2 migrations (PostgreSQL)", () => {
  let refs: Awaited<ReturnType<typeof ensureReferential>>;
  let agent: { id: string }, approver: { id: string };
  beforeAll(async () => {
    refs = await ensureReferential();
    [agent, approver] = await Promise.all([createTestUser("Finance V2 Auteur"), createTestUser("Finance V2 Approbateur")]);
  });

  async function assessment(tx: Tx, ninjaId: string, amount: bigint) {
    const rpYear = ((await tx.taxYear.aggregate({ _max: { rpYear: true } }))._max.rpYear ?? 1000) + 1;
    const policy = await tx.taxPolicy.create({ data: { name: `Finance V2 ${randomUUID()}`, version: 1, effectiveFromRpYear: rpYear } });
    const dueAt = new Date(Date.now() + 7 * 86_400_000);
    const year = await tx.taxYear.create({ data: { rpYear, taxPolicyId: policy.id, startsAt: new Date(), endsAt: dueAt, dueAt } });
    return tx.taxAssessment.create({ data: { ninjaId, taxPolicyId: policy.id, taxYearId: year.id, gradeCodeSnapshot: refs.grade.code, gradeLabelSnapshot: refs.grade.label, originalAmount: amount, dueAt, status: "DUE" }, include: { taxYear: true } });
  }

  async function resourceTransaction(tx: Tx, ninjaId: string, resourceId: string, type: "DONATION" | "BUYBACK", quantity: number, unitPrice: bigint, status: "VALIDATED" | "PENDING_APPROVAL" = "VALIDATED") {
    const key = randomUUID();
    const transaction = await tx.resourceTransaction.create({ data: { ...businessOperationEvidence, receiptNumber: `FIN-${type}-${key}`, type, status, ninjaId, agentId: agent.id, recordedById: agent.id, totalAmount: scaledTimes(quantity, unitPrice), idempotencyKey: key, validatedAt: status === "VALIDATED" ? new Date() : null } });
    await tx.resourceTransactionItem.create({ data: { transactionId: transaction.id, resourceId, quantity: new Prisma.Decimal(quantity), unitPriceSnapshot: unitPrice, lineTotal: transaction.totalAmount } });
    return transaction;
  }

  it("settles two tax assessments with exact BigInt allocations and credits payment points once", async () => {
    const ninja = await createTestNinja(refs.grade.id, "Montants", "Exacts");
    const amount = 9_007_199_254_740_993n;
    await isolatedScenario(async (tx) => {
      await rates(tx, 0);
      expect(await lockActiveNinja(tx, ninja.id)).toBe(true);
      const older = await assessment(tx, ninja.id, amount - 1000n), newer = await assessment(tx, ninja.id, 1000n);
      const payment = await tx.taxPayment.create({ data: { ...businessOperationEvidence, receiptNumber: `FIN-PAY-${randomUUID()}`, ninjaId: ninja.id, recordedById: agent.id, amount, method: "RYO", status: "VALIDATED", balanceBefore: amount, balanceAfter: 0n, idempotencyKey: randomUUID(), validatedAt: new Date() } });
      await tx.taxPaymentAllocation.createMany({ data: [
        { paymentId: payment.id, assessmentId: older.id, amount: amount - 1000n, allocationOrder: 1 },
        { paymentId: payment.id, assessmentId: newer.id, amount: 1000n, allocationOrder: 2 }
      ] });
      expect(await awardPoints(tx, { ninjaId: ninja.id, eventType: "TAX_PAYMENT", amount, sourceType: "TaxPayment", sourceId: payment.id })).toBe(3);
      expect(await awardPoints(tx, { ninjaId: ninja.id, eventType: "TAX_PAYMENT", amount, sourceType: "TaxPayment", sourceId: payment.id })).toBe(0);
      expect(await refreshAssessmentStatus(tx, older.id, newer.taxYear.rpYear)).toBe("PAID");
      expect(await refreshAssessmentStatus(tx, newer.id, newer.taxYear.rpYear)).toBe("PAID");
      const allocations = await tx.taxPaymentAllocation.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true }, _count: true });
      expect(allocations._sum.amount).toBe(amount);
      expect(allocations._count).toBe(2);
      expect((await tx.pointLedgerEntry.aggregate({ where: { ninjaId: ninja.id }, _sum: { points: true } }))._sum.points).toBe(3);
      expect(payment).toMatchObject({ recordedById: agent.id, amount, balanceBefore: amount, balanceAfter: 0n, operationOrigin: "BUSINESS", validationEvidence: "SERVER" });
      expect(payment.firstValidatedAt).toBeInstanceOf(Date);
      expect(await exemptionBalance(tx, ninja.id)).toBe(0n);
    });
  });

  it("commits a single payment when two SQL transactions reuse one idempotency key", async () => {
    const ninja = await createTestNinja(refs.grade.id, "Paiement", "Concurrent");
    const key = randomUUID(), amount = 9_007_199_254_740_993n;
    const write = () => prisma.$transaction(async (tx) => {
      if (!await lockActiveNinja(tx, ninja.id)) throw new Error("Inactive fixture");
      return tx.taxPayment.create({ data: { ...businessOperationEvidence, receiptNumber: `FIN-REPLAY-${randomUUID()}`, ninjaId: ninja.id, recordedById: agent.id, amount, method: "RYO", status: "VALIDATED", balanceBefore: amount, balanceAfter: 0n, idempotencyKey: key, validatedAt: new Date() } });
    });
    const results = await Promise.allSettled([write(), write()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "P2002" });
    const payments = await prisma.taxPayment.findMany({ where: { idempotencyKey: key } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount, recordedById: agent.id, validationEvidence: "SERVER" });
  });

  it("keeps donation decimals, exact points and unused credit while enforcing the tax coverage ceiling", async () => {
    const ninja = await createTestNinja(refs.grade.id, "Don", "Plafonné");
    const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.kg.id });
    await isolatedScenario(async (tx) => {
      await rates(tx, 2500);
      const tax = await assessment(tx, ninja.id, 1000n);
      const donation = await resourceTransaction(tx, ninja.id, resource.id, "DONATION", 2.5, 250n);
      const result = await applyValidatedTransaction(tx, donation, [{ resourceId: resource.id, quantity: 2.5, unitPrice: 250n, exemptionPerUnit: 101n, pointsPerUnit: 4 }], agent.id);
      expect(result).toEqual({ points: 17, exemption: 252n, covered: 250n });
      expect(await exemptionBalance(tx, ninja.id)).toBe(2n);
      expect((await tx.taxExemption.aggregate({ where: { assessmentId: tax.id }, _sum: { amount: true } }))._sum.amount).toBe(250n);
      expect((await tx.taxAssessment.findUniqueOrThrow({ where: { id: tax.id } })).status).toBe("PARTIALLY_PAID");
      expect(await autoCoverOpenTaxes(tx, ninja.id, agent.id, randomUUID())).toBe(0n);
      expect(await exemptionBalance(tx, ninja.id)).toBe(2n);
      expect((await ledgerStock(tx, resource.id)).toString()).toBe("2.5");
      expect((await tx.resource.findUniqueOrThrow({ where: { id: resource.id } })).currentQuantity.toString()).toBe("2.5");
      expect((await tx.pointLedgerEntry.findMany({ where: { ninjaId: ninja.id } })).map((entry) => entry.points)).toEqual([17]);
      expect((await tx.resourceTransaction.findUniqueOrThrow({ where: { id: donation.id } })).totalPoints).toBe(17);
    });
  });

  it("validates a buyback without changing its author and keeps credit above Number safe integer limits", async () => {
    const ninja = await createTestNinja(refs.grade.id, "Rachat", "Exact");
    const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.kg.id });
    await isolatedScenario(async (tx) => {
      await rates(tx, 0);
      const pending = await resourceTransaction(tx, ninja.id, resource.id, "BUYBACK", 1.25, 9_007_199_254_740_993n, "PENDING_APPROVAL");
      expect(pending.firstValidatedAt).toBeNull();
      const beforeApproval = Date.now();
      const validated = await tx.resourceTransaction.update({ where: { id: pending.id }, data: { status: "VALIDATED", validatedAt: new Date() } });
      const result = await applyValidatedTransaction(tx, validated, [{ resourceId: resource.id, quantity: 1.25, unitPrice: 9_007_199_254_740_993n, exemptionPerUnit: 0n, pointsPerUnit: 999 }], agent.id);
      await writeAudit(tx, { actorId: approver.id, action: "BUYBACK_APPROVED", entityType: "ResourceTransaction", entityId: pending.id, reason: "Validation de fixture économique" });
      expect(validated.recordedById).toBe(agent.id);
      expect(validated.validationEvidence).toBe("SERVER");
      expect(validated.firstValidatedAt!.getTime()).toBeGreaterThanOrEqual(beforeApproval - 1000);
      expect(validated.totalAmount).toBe(11_258_999_068_426_241n);
      expect(result).toEqual({ points: 5, exemption: 11_258_999_068_426_241n, covered: 0n });
      expect(await exemptionBalance(tx, ninja.id)).toBe(11_258_999_068_426_241n);
      expect((await ledgerStock(tx, resource.id)).toString()).toBe("1.25");
      expect((await tx.inventoryMovement.findFirstOrThrow({ where: { transactionId: pending.id } })).unitCost).toBe(9_007_199_254_740_993n);
      expect(await tx.taxExemption.count({ where: { assessment: { ninjaId: ninja.id } } })).toBe(0);
    });
  });

  it("reconciles an explicit correction through counterentries while retaining original financial and stock facts", async () => {
    const ninja = await createTestNinja(refs.grade.id, "Contre", "Écriture");
    const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.kg.id });
    await isolatedScenario(async (tx) => {
      await rates(tx, 0);
      const donation = await resourceTransaction(tx, ninja.id, resource.id, "DONATION", 2, 100n);
      const result = await applyValidatedTransaction(tx, donation, [{ resourceId: resource.id, quantity: 2, unitPrice: 100n, exemptionPerUnit: 101n, pointsPerUnit: 4 }], agent.id);
      const original = await tx.inventoryMovement.findFirstOrThrow({ where: { transactionId: donation.id } });
      const correctionKey = randomUUID();
      await reverseMovement(tx, { movementId: original.id, agentId: approver.id, reason: "Correction explicite de fixture", idempotencyKey: correctionKey });
      await grantExemption(tx, { ninjaId: ninja.id, amount: -result.exemption, sourceType: "ResourceCorrection", sourceId: donation.id, reason: "Contre-écriture explicite du crédit" });
      expect(await awardPoints(tx, { ninjaId: ninja.id, eventType: "REVERSAL", amount: 0n, basePoints: -result.points, sourceType: "ResourceCorrection", sourceId: donation.id })).toBe(-15);
      await tx.resourceTransaction.update({ where: { id: donation.id }, data: { status: "REVERSED" } });
      // Replayed counterentries are recognized by the existing finance helpers.
      await grantExemption(tx, { ninjaId: ninja.id, amount: -result.exemption, sourceType: "ResourceCorrection", sourceId: donation.id });
      expect(await awardPoints(tx, { ninjaId: ninja.id, eventType: "REVERSAL", amount: 0n, basePoints: -result.points, sourceType: "ResourceCorrection", sourceId: donation.id })).toBe(0);
      expect(await exemptionBalance(tx, ninja.id)).toBe(0n);
      expect((await tx.pointLedgerEntry.aggregate({ where: { ninjaId: ninja.id }, _sum: { points: true } }))._sum.points).toBe(0);
      expect((await ledgerStock(tx, resource.id)).toString()).toBe("0");
      expect(await tx.inventoryMovement.count({ where: { resourceId: resource.id } })).toBe(2);
      expect(await tx.pointLedgerEntry.count({ where: { ninjaId: ninja.id } })).toBe(2);
      expect(await tx.exemptionLedgerEntry.count({ where: { ninjaId: ninja.id } })).toBe(2);
      expect((await tx.inventoryMovement.findUniqueOrThrow({ where: { id: original.id } })).quantity.toString()).toBe("2");
      expect(await tx.resourceTransaction.findUniqueOrThrow({ where: { id: donation.id } })).toMatchObject({ totalAmount: 200n, totalPoints: 15, recordedById: agent.id, firstValidatedAt: donation.firstValidatedAt });
    });
  });

  it("rolls back the transaction, first stock line and cached quantity when a later item fails validation", async () => {
    const ninja = await createTestNinja(refs.grade.id, "Rollback", "Atomique");
    const first = await createTestResource({ categoryId: refs.category.id, unitId: refs.kg.id });
    const second = await createTestResource({ categoryId: refs.category.id, unitId: refs.unite.id });
    const key = randomUUID();
    await expect(prisma.$transaction(async (tx) => {
      const transaction = await tx.resourceTransaction.create({ data: { ...businessOperationEvidence, receiptNumber: `FIN-ROLLBACK-${key}`, type: "DONATION", status: "VALIDATED", ninjaId: ninja.id, agentId: agent.id, recordedById: agent.id, totalAmount: 10n, idempotencyKey: key } });
      await applyValidatedTransaction(tx, transaction, [
        { resourceId: first.id, quantity: 1, unitPrice: 5n, exemptionPerUnit: 5n, pointsPerUnit: 1 },
        { resourceId: second.id, quantity: 1.5, unitPrice: 5n, exemptionPerUnit: 5n, pointsPerUnit: 1 }
      ], agent.id);
    })).rejects.toThrow(/entières/);
    expect(await prisma.resourceTransaction.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { resourceId: { in: [first.id, second.id] } } })).toBe(0);
    expect((await prisma.resource.findUniqueOrThrow({ where: { id: first.id } })).currentQuantity.toString()).toBe("0");
    expect(await prisma.pointLedgerEntry.count({ where: { ninjaId: ninja.id } })).toBe(0);
    expect(await prisma.exemptionLedgerEntry.count({ where: { ninjaId: ninja.id } })).toBe(0);
  });
});
