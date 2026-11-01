import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import type { Permission, Role } from "@koeki/domain";
import { createTestNinja, createTestResource, createTestUser, ensureReferential } from "./test-fixtures";

const actor = { userId: "", roles: ["KOEKI_MANAGER"] as Role[] };
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/session", async () => {
  const { canAny } = await import("@koeki/domain");
  return {
    requireWriteAccess: async (permission: Permission) => {
      if (!canAny(actor.roles, permission)) throw new Error("FORBIDDEN");
      return { ...actor, roles: [...actor.roles], name: "Idempotency fixture" };
    },
    hasPermission: (session: typeof actor, permission: Permission) => canAny(session.roles, permission)
  };
});

const { recordResourceTransaction } = await import("@/app/(app)/resources/actions");
async function submit(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  try { await recordResourceTransaction(data); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT:")) return error.message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("Expected action redirect");
}

describe.skipIf(!inject("dbReady"))("resource transaction submission retries (PostgreSQL)", () => {
  let refs: Awaited<ReturnType<typeof ensureReferential>>;
  let manager: { id: string }, other: { id: string };
  beforeAll(async () => {
    refs = await ensureReferential();
    manager = await createTestUser("Idempotency manager");
    other = await createTestUser("Idempotency other actor");
  });

  async function fixture(type: "DONATION" | "BUYBACK" = "DONATION") {
    actor.userId = manager.id;
    actor.roles = ["KOEKI_MANAGER"];
    const ninja = await createTestNinja(refs.grade.id, "Idempotence", randomUUID());
    const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.kg.id });
    await prisma.resource.update({ where: { id: resource.id }, data: { exemptionPerUnit: 100n, pointsPerUnit: 4 } });
    const price = await prisma.resourcePriceHistory.create({ data: { resourceId: resource.id, pricePerUnit: 200n, effectiveFrom: new Date("2000-01-01"), createdById: manager.id } });
    const fields = { type, ninjaId: ninja.id, idempotencyKey: randomUUID(), resourceId_1: resource.id, quantity_1: "1.25" };
    return { ninja, resource, price, fields };
  }

  async function effects(transactionId: string) {
    return {
      items: await prisma.resourceTransactionItem.count({ where: { transactionId } }),
      movements: await prisma.inventoryMovement.count({ where: { transactionId } }),
      points: await prisma.pointLedgerEntry.count({ where: { sourceType: "ResourceTransaction", sourceId: transactionId } }),
      exemptions: await prisma.exemptionLedgerEntry.count({ where: { sourceType: "ResourceTransaction", sourceId: transactionId } }),
      audits: await prisma.auditLog.count({ where: { entityType: "ResourceTransaction", entityId: transactionId } })
    };
  }

  it("returns the same receipt for concurrent submissions and applies stock, points and credit once", async () => {
    const { resource, fields } = await fixture();
    const extra = await createTestResource({ categoryId: refs.category.id, unitId: refs.kg.id });
    const input = { ...fields, resourceId_2: extra.id, quantity_2: "2" };
    const responses = await Promise.all([submit(input), submit(input)]);
    const transactions = await prisma.resourceTransaction.findMany({ where: { idempotencyKey: fields.idempotencyKey } });
    expect(transactions).toHaveLength(1);
    const transaction = transactions[0]!;
    expect(responses).toEqual([`/resources?recu=${transaction.receiptNumber}`, `/resources?recu=${transaction.receiptNumber}`]);
    expect(await submit({ ...input, resourceId_1: extra.id, quantity_1: "2", resourceId_2: resource.id, quantity_2: "1,2500" })).toBe(responses[0]);
    expect(await effects(transaction.id)).toEqual({ items: 2, movements: 2, points: 1, exemptions: 1, audits: 1 });
    expect((await prisma.resource.findUniqueOrThrow({ where: { id: resource.id } })).currentQuantity.toString()).toBe("1.25");
    expect((await prisma.exemptionLedgerEntry.findFirstOrThrow({ where: { sourceType: "ResourceTransaction", sourceId: transaction.id } })).amount).toBe(125n);
  });

  it("reuses the recorded result after catalog changes and rejects changed input or another actor", async () => {
    const { resource, price, fields } = await fixture("BUYBACK");
    const response = await submit(fields);
    const transaction = await prisma.resourceTransaction.findUniqueOrThrow({ where: { idempotencyKey: fields.idempotencyKey } });
    const before = await effects(transaction.id);
    await prisma.resource.update({ where: { id: resource.id }, data: { isActive: false } });
    await prisma.resourcePriceHistory.update({ where: { id: price.id }, data: { pricePerUnit: 500n } });
    expect(await submit({ ...fields, quantity_1: "1,2500" })).toBe(response);
    const secondNinja = await createTestNinja(refs.grade.id, "Autre", randomUUID());
    for (const change of [{ quantity_1: "2" }, { unitPrice_1: "200" }, { type: "DONATION" }, { ninjaId: secondNinja.id }, { resourceId_1: "another-resource" }]) {
      const rejected = await submit({ ...fields, ...change });
      expect(decodeURIComponent(rejected)).toContain("Ce formulaire a déjà été utilisé");
      expect(rejected).not.toContain(transaction.receiptNumber);
    }
    actor.userId = other.id;
    expect(decodeURIComponent(await submit(fields))).toContain("Ce formulaire a déjà été utilisé");
    expect(await effects(transaction.id)).toEqual(before);
    expect((await prisma.resourceTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).totalAmount).toBe(250n);
    actor.userId = manager.id;
    await prisma.resourceTransaction.update({ where: { id: transaction.id }, data: { status: "REVERSED" } });
    expect(decodeURIComponent(await submit(fields))).toContain("Ce formulaire a déjà été utilisé");
  });

  it("recognizes a pending buyback retry without validating it or creating ledger entries", async () => {
    const { fields } = await fixture("BUYBACK");
    actor.roles = ["ECONOMIC_AGENT"];
    const previous = await prisma.appSetting.findUnique({ where: { key: "approvalThreshold" } });
    try {
      await prisma.appSetting.upsert({ where: { key: "approvalThreshold" }, create: { key: "approvalThreshold", value: { amount: "1", isValidated: true } }, update: { value: { amount: "1", isValidated: true } } });
      const input = { ...fields, unitPrice_1: "150" };
      const first = await submit(input);
      expect(await submit(input)).toBe(first);
      const transaction = await prisma.resourceTransaction.findUniqueOrThrow({ where: { idempotencyKey: fields.idempotencyKey } });
      expect(transaction.status).toBe("PENDING_APPROVAL");
      expect(await effects(transaction.id)).toEqual({ items: 1, movements: 0, points: 0, exemptions: 0, audits: 1 });
    } finally {
      if (previous) await prisma.appSetting.update({ where: { key: "approvalThreshold" }, data: { value: previous.value! } });
      else await prisma.appSetting.delete({ where: { key: "approvalThreshold" } });
    }
  });

  it("does not treat a historical transaction without request evidence as a successful replay", async () => {
    const { fields } = await fixture();
    const transaction = await prisma.resourceTransaction.create({ data: { receiptNumber: `OLD-${randomUUID()}`, type: "DONATION", status: "VALIDATED", ninjaId: fields.ninjaId, agentId: manager.id, recordedById: manager.id, totalAmount: 250n, idempotencyKey: fields.idempotencyKey } });
    const response = await submit(fields);
    expect(decodeURIComponent(response)).toContain("Ce formulaire a déjà été utilisé");
    expect(response).not.toContain(transaction.receiptNumber);
    expect(await effects(transaction.id)).toEqual({ items: 0, movements: 0, points: 0, exemptions: 0, audits: 0 });
  });
});
