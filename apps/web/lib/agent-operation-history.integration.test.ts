import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import { rankingWeekAt, type Role } from "@koeki/domain";
import { createTestNinja, createTestUser, ensureReferential } from "./test-fixtures";

const actor = vi.hoisted(() => ({ userId: "", name: "Journal", roles: [] as Role[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("./session", async () => {
  const { canAny } = await import("@koeki/domain");
  return { demoMode: false, requirePermission: async (permission: Parameters<typeof canAny>[1]) => {
    if (!canAny(actor.roles, permission)) throw new Error("FORBIDDEN");
    return actor;
  }, hasPermission: (session: typeof actor, permission: Parameters<typeof canAny>[1]) => canAny(session.roles, permission) };
});
import { getAgentOperationHistory } from "./agent-operation-history";
import { getRankingContribution } from "./ranking-service";

describe.skipIf(!inject("dbReady"))("complete agent operation history (PostgreSQL)", () => {
  let agentId: string, managerId: string, otherId: string, oldestId: string, legacyId: string, ownBusinessId: string, wrongAuthorId: string;
  const huge = 9_007_199_254_740_993n;
  const asAgent = () => Object.assign(actor, { userId: agentId, roles: ["ECONOMIC_AGENT"] });
  beforeAll(async () => {
    const ref = await ensureReferential(), ninja = await createTestNinja(ref.grade.id);
    const agent = await createTestUser("Journal agent"), manager = await createTestUser("Journal manager"), other = await createTestUser("Journal autre");
    agentId = agent.id; managerId = manager.id; otherId = other.id;
    for (const [userId, code] of [[agentId, "ECONOMIC_AGENT"], [managerId, "KOEKI_MANAGER"], [otherId, "ECONOMIC_AGENT"]] as const) {
      const role = await prisma.role.upsert({ where: { code: code! }, create: { code: code!, label: code! }, update: {} });
      await prisma.userRole.create({ data: { userId: userId!, roleId: role.id } });
    }
    await prisma.agentParticipation.create({ data: { userId: agentId, startsAt: rankingWeekAt(new Date()).startsAt, rankingEligible: true } });
    for (let i = 0; i < 31; i++) {
      const payment = await prisma.taxPayment.create({ data: {
        ninjaId: ninja.id, recordedById: agentId, receiptNumber: `JOURNAL-PAY-${randomUUID()}`, idempotencyKey: randomUUID(),
        amount: i === 0 ? huge : BigInt(i), method: "CASH", status: i === 5 ? "CANCELLED" : "VALIDATED", balanceBefore: 0n, balanceAfter: 0n,
        createdAt: new Date(Date.UTC(2022, 0, i + 1, 12)), operationOrigin: i === 0 ? "IMPORT" : "UNKNOWN",
      } });
      if (i === 0) oldestId = payment.id;
    }
    for (let i = 0; i < 30; i++) {
      const transaction = await prisma.resourceTransaction.create({ data: {
        ninjaId: ninja.id, agentId, recordedById: null, receiptNumber: `JOURNAL-RES-${randomUUID()}`, idempotencyKey: randomUUID(),
        totalAmount: 123n, type: i < 15 ? "DONATION" : "BUYBACK", status: "VALIDATED", operationOrigin: i === 0 ? "IMPORT" : "UNKNOWN",
        createdAt: new Date(Date.UTC(2022, 1, i + 1, 12)),
      } });
      if (i === 0) legacyId = transaction.id;
    }
    ownBusinessId = (await prisma.resourceTransaction.create({ data: {
      ninjaId: ninja.id, agentId, recordedById: agentId, receiptNumber: `JOURNAL-NOW-${randomUUID()}`, idempotencyKey: randomUUID(),
      totalAmount: 500n, type: "DONATION", status: "VALIDATED", operationOrigin: "BUSINESS",
    } })).id;
    wrongAuthorId = (await prisma.resourceTransaction.create({ data: {
      ninjaId: ninja.id, agentId, recordedById: otherId, receiptNumber: `JOURNAL-OTHER-${randomUUID()}`, idempotencyKey: randomUUID(),
      totalAmount: 777n, type: "DONATION", status: "VALIDATED", operationOrigin: "BUSINESS",
    } })).id;
  });

  it("paginates the merged journal without dropping old or imported rows and keeps money exact", async () => {
    asAgent();
    const first = await getAgentOperationHistory();
    const second = await getAgentOperationHistory(agentId, { page: 2 });
    const last = await getAgentOperationHistory(agentId, { page: 999 });
    expect([first.total, first.payments, first.donations, first.buybacks]).toEqual([62, 31, 16, 15]);
    expect([first.rows.length, second.rows.length, last.rows.length, last.page]).toEqual([25, 25, 12, 3]);
    const rows = [...first.rows, ...second.rows, ...last.rows];
    expect(new Set(rows.map((row) => `${row.kind}:${row.id}`)).size).toBe(62);
    expect(rows.at(-1)?.id).toBe(oldestId);
    expect(rows.at(-1)?.amount).toBe(huge);
    expect(rows.at(-1)?.exclusion).toBe("Import exclu du classement");
    expect(rows.some((row) => row.status === "CANCELLED")).toBe(true);
    expect(rows.some((row) => row.id === wrongAuthorId)).toBe(false);
    expect((await getAgentOperationHistory(agentId, { page: -5 })).page).toBe(1);
  });

  it("keeps a legacy association visible without inventing an author or first validation", async () => {
    asAgent();
    const history = await getAgentOperationHistory(agentId, { du: "2022-02-01", au: "2022-02-01" });
    expect(history.total).toBe(1);
    expect(history.rows[0]).toMatchObject({ id: legacyId, recordedById: null, provenValidation: false, weekKey: null, firstValidatedAt: null });
    const source = await getRankingContribution("DONATION", legacyId);
    expect(source.recordedById).toBeNull();
    expect(source.historyUserId).toBe(agentId);
    await expect(getRankingContribution("DONATION", wrongAuthorId)).rejects.toThrow("NOT_FOUND");
  });

  it("uses Paris day bounds and reports bad ranges rather than silently returning empty rows", async () => {
    asAgent();
    const day = await getAgentOperationHistory(agentId, { du: "2022-01-01", au: "2022-01-01" });
    expect(day.rows.map((row) => row.id)).toEqual([oldestId]);
    await expect(getAgentOperationHistory(agentId, { du: "2022-02-30" })).rejects.toThrow("Date invalide");
    await expect(getAgentOperationHistory(agentId, { du: "2022-02-01", au: "2022-01-01" })).rejects.toThrow("La date de début");
  });

  it("reads new validated operations live even without a published ranking version", async () => {
    asAgent();
    const history = await getAgentOperationHistory();
    expect(history.rows[0]).toMatchObject({ id: ownBusinessId, provenValidation: true, exclusion: null, weekKey: rankingWeekAt(new Date()).key });
  });

  it("allows self and manager histories but refuses forged users and stale manager roles", async () => {
    asAgent();
    await expect(getAgentOperationHistory(otherId)).rejects.toThrow("NOT_FOUND");
    Object.assign(actor, { userId: agentId, roles: ["KOEKI_MANAGER"] });
    await expect(getAgentOperationHistory(otherId)).rejects.toThrow("NOT_FOUND");
    Object.assign(actor, { userId: managerId, roles: ["NINJA", "KOEKI_MANAGER"] });
    expect((await getAgentOperationHistory(agentId)).total).toBe(62);
    Object.assign(actor, { userId: agentId, roles: ["AUDITOR"] });
    await expect(getAgentOperationHistory(agentId)).rejects.toThrow("FORBIDDEN");
  });

  it("rechecks revocation before disclosing the private journal", async () => {
    asAgent();
    await prisma.user.update({ where: { id: agentId }, data: { revokedAt: new Date() } });
    try { await expect(getAgentOperationHistory(agentId)).rejects.toThrow("NOT_FOUND"); }
    finally { await prisma.user.update({ where: { id: agentId }, data: { revokedAt: null } }); }
  });
});
