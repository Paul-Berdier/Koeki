import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import { accessControlledAdapter as adapter } from "./auth-session-adapter";
import { claimExactProfile, profileLabel } from "./profile-claim";

vi.mock("./session", () => ({ demoMode: false, requirePermission: async () => ({ userId: "fixture" }) }));
const dbReady = inject("dbReady");
const discordId = () => String(100_000_000_000_000_000n + BigInt(`0x${randomBytes(7).toString("hex")}`));

describe.skipIf(!dbReady)("identity binding (isolated PostgreSQL)", () => {
  let roleId: string, gradeId: string;
  beforeAll(async () => {
    roleId = (await prisma.role.upsert({ where: { code: "NINJA" }, create: { code: "NINJA", label: "Ninja" }, update: {} })).id;
    gradeId = (await prisma.ninjaGrade.upsert({ where: { code: "IDENTITY_TEST" }, create: { code: "IDENTITY_TEST", label: "Fixture identité", sortOrder: 991 }, update: {} })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });
  async function user() { return prisma.user.create({ data: { name: `Identity fixture ${randomUUID()}`, roles: { create: { roleId } } } }); }
  async function profile(firstName = "Fixture", lastName = randomUUID()) {
    const sequence = await prisma.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('"NinjaProfile_code_seq"') AS value`;
    return prisma.ninjaProfile.create({ data: { code: `NIN-${String(sequence[0]!.value).padStart(6, "0")}`, firstName, lastName, currentGradeId: gradeId } });
  }
  const link = (userId: string, id: string) => adapter.linkAccount!({ userId, provider: "discord", providerAccountId: id, type: "oauth" });
  const claim = (userId: string, p: { firstName: string; lastName: string; code: string }) => claimExactProfile(userId, profileLabel(p.firstName, p.lastName, p.code), true);

  it("links one provider identity atomically and does not overwrite it on a second identity", async () => {
    const target = await user(), first = discordId(), second = discordId();
    await link(target.id, first);
    await link(target.id, first);
    expect(await prisma.account.count({ where: { userId: target.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).discordId).toBe(first);
    await expect(link(target.id, second)).rejects.toThrow("DISCORD_IDENTITY_CONFLICT");
    expect(await prisma.account.count({ where: { providerAccountId: second } })).toBe(0);
    const other = await user();
    await expect(link(other.id, first)).rejects.toThrow("DISCORD_IDENTITY_CONFLICT");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).discordId).toBeNull();
    expect((await adapter.getUserByAccount!({ provider: "discord", providerAccountId: first }))?.id).toBe(target.id);
  });

  it("serializes concurrent first links and refuses a link for a revoked user", async () => {
    const target = await user();
    const results = await Promise.allSettled([link(target.id, discordId()), link(target.id, discordId())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accounts = await prisma.account.findMany({ where: { userId: target.id } });
    expect(accounts).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).discordId).toBe(accounts[0]!.providerAccountId);
    const revoked = await user();
    await prisma.user.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
    await expect(link(revoked.id, discordId())).rejects.toThrow("SESSION_REVOKED");
  });

  it("rejects old sessions and new logins when canonical and provider identities conflict", async () => {
    const target = await user(), id = discordId(), token = randomUUID();
    await link(target.id, id);
    await adapter.createSession!({ userId: target.id, sessionToken: token, expires: new Date(Date.now() + 3_600_000) });
    expect((await adapter.getSessionAndUser!(token))?.user.id).toBe(target.id);
    // Deliberately corrupt only this synthetic fixture, not a production account.
    await prisma.user.update({ where: { id: target.id }, data: { discordId: discordId() } });
    expect(await adapter.getSessionAndUser!(token)).toBeNull();
    await expect(adapter.getUserByAccount!({ provider: "discord", providerAccountId: id })).rejects.toThrow("DISCORD_IDENTITY_CONFLICT");
    await expect(adapter.createSession!({ userId: target.id, sessionToken: randomUUID(), expires: new Date(Date.now() + 3_600_000) })).rejects.toThrow("DISCORD_IDENTITY_CONFLICT");
  });

  it("fails closed on legacy users with multiple Discord accounts, without choosing or deleting one", async () => {
    const target = await user(), a = discordId(), b = discordId();
    await prisma.account.createMany({ data: [a, b].map((id) => ({ userId: target.id, provider: "discord", providerAccountId: id, type: "oauth" })) });
    for (const id of [a, b]) await expect(adapter.getUserByAccount!({ provider: "discord", providerAccountId: id })).rejects.toThrow("DISCORD_IDENTITY_CONFLICT");
    expect(await prisma.account.count({ where: { userId: target.id } })).toBe(2);
  });

  it("requires exact name/code and confirmation and leaves financial histories and roles unchanged", async () => {
    const target = await user(), sheet = await profile("Synthetic Suki", "Synthetic Zetsubo"), other = await profile("Synthetic Kagero", "Synthetic Hakumei");
    const payment = await prisma.taxPayment.create({ data: { receiptNumber: `IDENTITY-${randomUUID()}`, ninjaId: sheet.id, recordedById: target.id, amount: 123n, balanceBefore: 123n, balanceAfter: 0n, method: "Fixture", status: "VALIDATED", idempotencyKey: randomUUID() } });
    const roles = await prisma.userRole.findMany({ where: { userId: target.id } });
    await expect(claimExactProfile(target.id, sheet.firstName, true)).rejects.toThrow(/complète/);
    await expect(claimExactProfile(target.id, profileLabel(sheet.firstName, sheet.lastName, other.code), true)).rejects.toThrow(/correspond/);
    await expect(claimExactProfile(target.id, profileLabel(sheet.firstName, sheet.lastName, sheet.code), false)).rejects.toThrow(/Confirmez/);
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: sheet.id } })).userId).toBeNull();
    expect(await claim(target.id, sheet)).toBe(sheet.id);
    expect(await claim(target.id, sheet)).toBe(sheet.id);
    await expect(claim(target.id, other)).rejects.toThrow(/déjà rattaché/);
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: other.id } })).userId).toBeNull();
    expect(await prisma.taxPayment.findUnique({ where: { id: payment.id } })).toEqual(payment);
    expect(await prisma.userRole.findMany({ where: { userId: target.id } })).toEqual(roles);
    expect(await prisma.auditLog.count({ where: { action: "NINJA_CLAIMED", entityId: sheet.id } })).toBe(1);
  });

  it("never steals a claimed or reserved profile and rejects revoked claimants", async () => {
    const owner = await user(), newcomer = await user(), occupied = await profile(), reserved = await profile();
    await claim(owner.id, occupied);
    await expect(claim(newcomer.id, occupied)).rejects.toThrow(/disponible/);
    await prisma.invitation.create({ data: { tokenHash: randomUUID(), roleId, createdById: owner.id, ninjaProfileId: reserved.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    await expect(claim(newcomer.id, reserved)).rejects.toThrow(/réservée/);
    await prisma.user.update({ where: { id: newcomer.id }, data: { revokedAt: new Date() } });
    await expect(claim(newcomer.id, await profile())).rejects.toThrow(/refusé/);
  });

  it("permits only one winner when two users confirm the same free sheet concurrently", async () => {
    const a = await user(), b = await user(), sheet = await profile();
    const results = await Promise.allSettled([claim(a.id, sheet), claim(b.id, sheet)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: sheet.id } });
    expect([a.id, b.id]).toContain(current.userId);
    expect(await prisma.auditLog.count({ where: { action: "NINJA_CLAIMED", entityId: sheet.id } })).toBe(1);
  });
});
