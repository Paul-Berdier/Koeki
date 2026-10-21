import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { prisma } from "@koeki/database";
import type { SessionInfo } from "./session";
import { formatRecordedQuantity, getResourceDetailsByTransactionIds, getTeamResourceJournal } from "./team-resource-journal";

const dbReady = inject("dbReady");
const manager: SessionInfo = { userId: "journal-manager-fixture", name: "Responsable", roles: ["KOEKI_MANAGER"] };
const ordinary: SessionInfo = { ...manager, roles: ["ECONOMIC_AGENT"] };
const period = { from: "2026-10-19", to: "2026-10-25" };

describe("recorded quantity and access guards", () => {
  it("formats exact decimals without losing integer precision", () => {
    expect(formatRecordedQuantity("2")).toBe("2");
    expect(formatRecordedQuantity("1.2500")).toBe("1,25");
    expect(formatRecordedQuantity("-0.0001")).toBe("-0,0001");
    expect(formatRecordedQuantity("9007199254740993.1234").replace(/\s/g, "")).toBe("9007199254740993,1234");
    expect(formatRecordedQuantity("unknown")).toBe("Quantité inconnue");
  });
  it("refuses an agent or auditor before reading journal data", async () => {
    await expect(getTeamResourceJournal(ordinary)).rejects.toThrow("FORBIDDEN");
    await expect(getResourceDetailsByTransactionIds({ ...ordinary, roles: ["AUDITOR"] }, [])).rejects.toThrow("FORBIDDEN");
  });
  it("bounds the detailed lookup and returns no data for an empty request", async () => {
    expect((await getResourceDetailsByTransactionIds(manager, [])).size).toBe(0);
    await expect(getResourceDetailsByTransactionIds(manager, Array.from({ length: 101 }, (_, i) => String(i)))).rejects.toThrow(/Trop/);
    await expect(getTeamResourceJournal(manager, { from: "2026-10-25", to: "2026-10-19" })).rejects.toThrow(/période/);
  });
});

describe.skipIf(!dbReady)("team resource journal (isolated PostgreSQL)", () => {
  const prefix = `JRNL-${randomUUID()}`;
  let agentId: string, approverId: string, ninjaId: string, metalId: string, woodId: string;
  let donationId: string, buybackId: string, legacyId: string, pendingId: string;
  let movementId: string, correctionId: string;
  beforeAll(async () => {
    agentId = (await prisma.user.create({ data: { name: prefix } })).id;
    approverId = (await prisma.user.create({ data: { name: `${prefix}-approver` } })).id;
    const grade = await prisma.ninjaGrade.upsert({ where: { code: "GENIN" }, create: { code: "GENIN", label: "Genin", sortOrder: 2 }, update: {} });
    ninjaId = (await prisma.ninjaProfile.create({ data: { code: prefix, firstName: "Ninja", lastName: "Journal", currentGradeId: grade.id, userId: agentId } })).id;
    const category = await prisma.resourceCategory.create({ data: { code: prefix, label: "Journal test" } });
    const unit = await prisma.resourceUnit.create({ data: { code: prefix, label: "unité", decimals: 4 } });
    const metal = await prisma.resource.create({ data: { code: `${prefix}-METAL`, name: "Métal de chakra", categoryId: category.id, unitId: unit.id, minimumStock: 0, criticalStock: 0, exemptionPerUnit: 99999n } });
    const wood = await prisma.resource.create({ data: { code: `${prefix}-BOIS`, name: "Bois", categoryId: category.id, unitId: unit.id, minimumStock: 0, criticalStock: 0 } });
    metalId = metal.id; woodId = wood.id;
    const at = new Date("2026-10-20T12:00:00Z");
    const common = { ninjaId, recordedById: agentId, agentId: approverId, createdAt: at, validatedAt: at, operationOrigin: "BUSINESS" };
    donationId = (await prisma.resourceTransaction.create({ data: {
      ...common, receiptNumber: `${prefix}-DON`, idempotencyKey: randomUUID(), type: "DONATION", status: "VALIDATED", totalAmount: 246n,
      items: { create: [{ resourceId: metalId, quantity: "2", unitPriceSnapshot: 123n, lineTotal: 246n }, { resourceId: woodId, quantity: "5", unitPriceSnapshot: 0n, lineTotal: 0n }] },
    } })).id;
    buybackId = (await prisma.resourceTransaction.create({ data: {
      ...common, agentId, recordedById: null, receiptNumber: `${prefix}-BUY`, idempotencyKey: randomUUID(), type: "BUYBACK", status: "VALIDATED", totalAmount: 10n,
      items: { create: { resourceId: metalId, quantity: "1.25", unitPriceSnapshot: 8n, lineTotal: 10n } },
    } })).id;
    legacyId = (await prisma.resourceTransaction.create({ data: { ...common, receiptNumber: `${prefix}-OLD`, idempotencyKey: randomUUID(), type: "DONATION", status: "CANCELLED", operationOrigin: "UNKNOWN", totalAmount: 300n } })).id;
    pendingId = (await prisma.resourceTransaction.create({ data: { ...common, validatedAt: null, receiptNumber: `${prefix}-PENDING`, idempotencyKey: randomUUID(), type: "DONATION", status: "PENDING_APPROVAL", totalAmount: 0n } })).id;
    movementId = (await prisma.inventoryMovement.create({ data: { resourceId: metalId, transactionId: donationId, agentId, type: "DONATION_IN", quantity: "2", quantityBefore: 0, quantityAfter: 2, reason: "Fixture journal", idempotencyKey: randomUUID(), occurredAt: at } })).id;
    correctionId = (await prisma.inventoryMovement.create({ data: { resourceId: metalId, transactionId: donationId, reversedMovementId: movementId, agentId, type: "REVERSAL", quantity: "-2", quantityBefore: 2, quantityAfter: 0, reason: "Fixture correction", idempotencyKey: randomUUID(), occurredAt: new Date("2026-10-27T12:00:00Z") } })).id;
    await prisma.resourceTransaction.createMany({ data: [
      { ...common, receiptNumber: `${prefix}-BEFORE`, idempotencyKey: randomUUID(), type: "DONATION", status: "VALIDATED", totalAmount: 1n, validatedAt: new Date("2026-10-18T21:59:59Z") },
      { ...common, receiptNumber: `${prefix}-AFTER`, idempotencyKey: randomUUID(), type: "DONATION", status: "VALIDATED", totalAmount: 1n, validatedAt: new Date("2026-10-25T23:00:00Z") },
    ] });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("returns all objects, exact quantities and saved values, never current prices", async () => {
    const data = await getTeamResourceJournal(manager, { ...period, q: `${prefix}-DON` });
    expect(data.total).toBe(1);
    const row = data.rows[0]!;
    expect(row.totalAmount).toBe(246n);
    expect(row.details.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Métal de chakra", quantity: "2", unitPrice: 123n, lineTotal: 246n }),
      expect.objectContaining({ name: "Bois", quantity: "5", unitPrice: 0n, lineTotal: 0n }),
    ]));
    expect(row.agentId).toBe(agentId);
    expect(row.agentName).toBe("Ninja Journal");
    expect(row.authorKnown).toBe(true);
  });
  it("resource search selects operations but does not remove their other items", async () => {
    const data = await getTeamResourceJournal(manager, { ...period, q: `${prefix}-METAL`, type: "DONATION" });
    expect(data.total).toBe(1);
    expect(data.rows[0]!.details.items).toHaveLength(2);
  });
  it("retains pending and cancelled histories, reports missing details and uses civil date boundaries", async () => {
    const data = await getTeamResourceJournal(manager, { ...period, q: prefix, page: "-9" });
    expect(data.page).toBe(1);
    expect(data.total).toBe(4);
    expect(data.rows.find((row) => row.id === legacyId)).toMatchObject({ status: "CANCELLED", details: { items: [] } });
    expect(data.rows.find((row) => row.id === pendingId)).toMatchObject({ status: "PENDING_APPROVAL", dateKnown: false });
    expect(data.rows.find((row) => row.id === buybackId)).toMatchObject({ authorKnown: false, agentId, details: { items: [expect.objectContaining({ quantity: "1.25" })] } });
  });
  it("batches the same details for the agent page and includes each correction exactly once", async () => {
    const data = await getResourceDetailsByTransactionIds(manager, [donationId, donationId, legacyId]);
    expect(data.size).toBe(2);
    expect(data.get(donationId)!.movements.map((row) => row.id)).toEqual([movementId, correctionId]);
    expect(data.get(donationId)!.movements.map((row) => row.quantity)).toEqual(["2", "-2"]);
    expect((await prisma.resourceTransaction.findUniqueOrThrow({ where: { id: donationId } })).totalAmount).toBe(246n);
  });
  it("does not attribute an operation to its approver instead of its original author", async () => {
    const data = await getTeamResourceJournal(manager, { ...period, q: prefix, agentId: approverId });
    expect(data.total).toBe(0);
  });
});
