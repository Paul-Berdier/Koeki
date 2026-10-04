import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma, publishRanking } from "@koeki/database";
import { rankingWeekAt, type Role } from "@koeki/domain";
import { createTestNinja, createTestUser, ensureReferential } from "./test-fixtures";

const authState = vi.hoisted(() => ({ userId: "", name: "Fixture projection", roles: [] as Role[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("./session", async () => {
  const { canAny } = await import("@koeki/domain");
  return {
    demoMode: false,
    requirePermission: async (permission: Parameters<typeof canAny>[1]) => {
      if (!canAny(authState.roles, permission)) throw new Error("FORBIDDEN");
      return authState;
    },
    hasPermission: (actor: typeof authState, permission: Parameters<typeof canAny>[1]) => canAny(actor.roles, permission)
  };
});
import { getRankingContribution, getWeeklyRanking } from "./ranking-service";

// Database integration of DTO scoping; session authentication itself is covered
// separately by the Auth.js/session and authenticated E2E suites.
describe.skipIf(!inject("dbReady"))("ranking source and collective projections (PostgreSQL)", () => {
  let agentId: string, managerId: string, ownId: string, otherId: string;
  const secret = `Correction interne confidentielle ${randomUUID()}`;
  beforeAll(async () => {
    const ref = await ensureReferential();
    const [agent, other, manager] = await Promise.all([createTestUser("Source propre"), createTestUser("Source collègue"), createTestUser("Source responsable")]);
    agentId = agent.id; managerId = manager.id;
    const role = await prisma.role.upsert({ where: { code: "KOEKI_MANAGER" }, create: { code: "KOEKI_MANAGER", label: "Responsable" }, update: {} });
    await prisma.userRole.create({ data: { userId: manager.id, roleId: role.id } });
    const week = rankingWeekAt(new Date());
    await prisma.agentParticipation.createMany({ data: [agent, other].map((user) => ({ userId: user.id, startsAt: week.startsAt, rankingEligible: true })) });
    const ninja = await createTestNinja(ref.grade.id);
    const create = (authorId: string) => prisma.resourceTransaction.create({ data: { receiptNumber: `PROJECTION-${randomUUID()}`, type: "DONATION", status: "VALIDATED", ninjaId: ninja.id, agentId: authorId, recordedById: authorId, totalAmount: 50n, idempotencyKey: randomUUID(), operationOrigin: "BUSINESS" } });
    ownId = (await create(agent.id)).id; otherId = (await create(other.id)).id;
    let latest = await prisma.rankingPeriod.findUnique({ where: { weekKey: week.key }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!latest) { await publishRanking(prisma, { weekKey: week.key, now: week.endsAt }); latest = await prisma.rankingPeriod.findUnique({ where: { weekKey: week.key }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }); }
    // Ensure a real motivated revision whose reason must remain manager-only.
    await create(agent.id);
    await publishRanking(prisma, { weekKey: week.key, actorId: managerId, now: week.endsAt, correctionReason: secret, expectedVersion: latest!.versions[0]!.version });
  });
  it("refuses a forged colleague source ID while allowing the agent's own source", async () => {
    Object.assign(authState, { userId: agentId, roles: ["ECONOMIC_AGENT"] });
    expect((await getRankingContribution("DONATION", ownId)).recordedById).toBe(agentId);
    await expect(getRankingContribution("DONATION", otherId)).rejects.toThrow("NOT_FOUND");
    const view = await getWeeklyRanking();
    expect(view.sources.every((source) => source.authorId === agentId)).toBe(true);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(JSON.stringify(view)).not.toContain(otherId);
  });
  it("uses role union and lets a manager inspect sources and correction reasons", async () => {
    Object.assign(authState, { userId: managerId, roles: ["NINJA", "KOEKI_MANAGER"] });
    expect((await getRankingContribution("DONATION", otherId)).id).toBe(otherId);
    expect(JSON.stringify(await getWeeklyRanking())).toContain(secret);
  });
  it("denies an auditor-only actor before reading ranking details", async () => {
    Object.assign(authState, { userId: agentId, roles: ["AUDITOR"] });
    await expect(getWeeklyRanking()).rejects.toThrow("FORBIDDEN");
    await expect(getRankingContribution("DONATION", ownId)).rejects.toThrow("FORBIDDEN");
  });
});
