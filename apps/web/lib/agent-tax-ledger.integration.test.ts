import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma, type PaymentStatus } from "@koeki/database";
import { canAny, type Role } from "@koeki/domain";
import type { SessionInfo } from "./session";
import { getAgentTaxLedger } from "./agent-tax-ledger";
import { createTestNinja, createTestUser, ensureReferential } from "./test-fixtures";
import { getHandledNinjas } from "./handled-ninjas";

vi.mock("./session", () => ({ demoMode: false, hasPermission: (session: SessionInfo, permission: Parameters<typeof canAny>[1]) => canAny(session.roles, permission) }));

describe.skipIf(!inject("dbReady"))("agent tax receipts (PostgreSQL)", () => {
  let manager: SessionInfo, first: SessionInfo, second: SessionInfo, idle: SessionInfo;
  let ninjaId: string;
  const amount = 9_007_199_254_740_993n;
  const period = { from: "2026-05-14", to: "2026-05-14" };
  const inside = new Date("2026-05-14T10:00:00Z");
  async function identity(role: Role): Promise<SessionInfo> {
    const user = await createTestUser(`Journal ${role} ${randomUUID()}`);
    const record = await prisma.role.upsert({ where: { code: role }, create: { code: role, label: role }, update: {} });
    await prisma.userRole.create({ data: { userId: user.id, roleId: record.id } });
    return { userId: user.id, name: user.name!, roles: [role] };
  }
  async function receipt(author: string, value: bigint, origin = "BUSINESS", status: PaymentStatus = "VALIDATED", method = "RYO", at: Date | null = inside) {
    return prisma.taxPayment.create({ data: { ninjaId, recordedById: author, amount: value, operationOrigin: origin, status, method, validatedAt: at, createdAt: inside, balanceBefore: value, balanceAfter: 0n, idempotencyKey: randomUUID(), receiptNumber: `JOURNAL-${randomUUID()}` } });
  }
  beforeAll(async () => {
    const refs = await ensureReferential();
    manager = await identity("KOEKI_MANAGER"); first = await identity("ECONOMIC_AGENT"); second = await identity("ECONOMIC_AGENT"); idle = await identity("ECONOMIC_AGENT");
    const ninja = await createTestNinja(refs.grade.id, "Registre", "Partagé");
    ninjaId = ninja.id;
    // An obsolete reference never gets credit for another agent's payment.
    await prisma.ninjaProfile.update({ where: { id: ninjaId }, data: { referenceAgentId: second.userId } });
    await receipt(first.userId, amount);
    for (let i = 0; i < 26; i++) await receipt(first.userId, 1n);
    await receipt(second.userId, 777n);
    await receipt(first.userId, 45n, "UNKNOWN", "VALIDATED", "Espèces");
    await receipt(first.userId, 900n, "BUSINESS", "PENDING", "RYO", null);
    await receipt(first.userId, 901n, "BUSINESS", "REVERSED");
    await receipt(first.userId, 902n, "BUSINESS", "VALIDATED", "EXEMPTION_CREDIT");
    await receipt(first.userId, 903n, "UNKNOWN", "VALIDATED", "RYO", null);
    // Paris starts at 22:00 UTC the preceding day in May; the next boundary is excluded.
    await receipt(first.userId, 4n, "BUSINESS", "VALIDATED", "RYO", new Date("2026-05-13T22:00:00Z"));
    await receipt(first.userId, 999n, "BUSINESS", "VALIDATED", "RYO", new Date("2026-05-14T22:00:00Z"));
  });

  it("keeps authors, exact amounts, zero agents and distinct historical totals", async () => {
    const data = await getAgentTaxLedger(manager, { ...period, agentId: first.userId });
    expect(data.selected).toMatchObject({ id: first.userId, collected: amount + 30n, payments: 28, historical: 45n, historicalPayments: 1 });
    expect(data.agents.find((row) => row.id === second.userId)).toMatchObject({ collected: 777n, payments: 1 });
    expect(data.agents.find((row) => row.id === idle.userId)).toMatchObject({ collected: 0n, payments: 0 });
    expect(data.unknownDates).toBe(1);
    expect((await getHandledNinjas(manager, first.userId, period)).map((row) => row.id)).toContain(ninjaId);
    expect((await getHandledNinjas(manager, second.userId, period)).map((row) => row.id)).toContain(ninjaId);
  });

  it("paginates all receipts without truncating or double-counting totals", async () => {
    const page1 = await getAgentTaxLedger(manager, { ...period, agentId: first.userId });
    const page2 = await getAgentTaxLedger(manager, { ...period, agentId: first.userId, page: "2" });
    expect(page1.receiptCount).toBe(33);
    expect(page1.receipts).toHaveLength(25);
    expect(page2.receipts).toHaveLength(8);
    expect(page2.selected?.collected).toBe(page1.selected?.collected);
    const receipts = [...page1.receipts, ...page2.receipts];
    expect(new Set(receipts.map((row) => row.id)).size).toBe(33);
    expect(receipts.filter((row) => row.bucket === "collected").reduce((sum, row) => sum + row.amount, 0n)).toBe(amount + 30n);
  });

  it("preserves former agents and refuses revoked viewers with stale session roles", async () => {
    await prisma.user.update({ where: { id: second.userId }, data: { revokedAt: new Date() } });
    expect((await getAgentTaxLedger(manager, { ...period, agentId: second.userId })).selected).toMatchObject({ disabled: true, collected: 777n });
    await expect(getAgentTaxLedger(first, period)).rejects.toThrow("FORBIDDEN");
    const stale = await identity("KOEKI_MANAGER");
    await prisma.user.update({ where: { id: stale.userId }, data: { revokedAt: new Date() } });
    await expect(getAgentTaxLedger(stale, period)).rejects.toThrow("FORBIDDEN");
  });
});
