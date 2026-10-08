import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/auth";
import { checkInvitation } from "./invitation-check";
import { consumeInvitationAccess } from "./invitation-service";

vi.mock("./session", () => ({ demoMode: false, requirePermission: async () => ({ userId: "unused" }) }));
const pepper = `invitation-check-${randomUUID()}`;
const dbReady = inject("dbReady");

describe.skipIf(!dbReady)("invitation preflight and atomic acceptance (PostgreSQL)", () => {
  let managerId: string, roleId: string;
  beforeAll(async () => {
    vi.stubEnv("INVITE_TOKEN_PEPPER", pepper);
    const managerRole = await prisma.role.upsert({ where: { code: "KOEKI_MANAGER" }, create: { code: "KOEKI_MANAGER", label: "Manager" }, update: {} });
    const role = await prisma.role.upsert({ where: { code: "ECONOMIC_AGENT" }, create: { code: "ECONOMIC_AGENT", label: "Agent" }, update: {} });
    roleId = role.id;
    const manager = await prisma.user.create({ data: { name: `Invitation manager ${randomUUID()}`, roles: { create: { roleId: managerRole.id } } } });
    managerId = manager.id;
  });
  afterEach(() => vi.stubEnv("INVITE_TOKEN_PEPPER", pepper));
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });
  async function invitation() {
    const { token, tokenHash } = createInvitationToken(pepper);
    const row = await prisma.invitation.create({ data: { tokenHash, roleId, createdById: managerId, expiresAt: new Date(Date.now() + 3_600_000) } });
    return { token, row };
  }
  it("preflight is read-only and discloses no creator, recipient or role data", async () => {
    const { token, row } = await invitation();
    const first = await checkInvitation(token);
    expect(first).toEqual({ ok: true, id: row.id, expiresAt: row.expiresAt });
    expect(await checkInvitation(token)).toEqual(first);
    expect(await prisma.invitation.findUnique({ where: { id: row.id } })).toEqual(row);
    expect(await prisma.auditLog.count({ where: { entityType: "Invitation", entityId: row.id } })).toBe(0);
  });
  it("rejects invalid, expired and revoked links distinctly", async () => {
    expect(await checkInvitation("invalid")).toEqual({ ok: false, error: "InvitationInvalid" });
    expect(await checkInvitation(createInvitationToken(pepper).token)).toEqual({ ok: false, error: "InvitationInvalid" });
    const { token, row } = await invitation();
    await prisma.invitation.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await checkInvitation(token)).toEqual({ ok: false, error: "InvitationExpired" });
    await prisma.invitation.update({ where: { id: row.id }, data: { revokedAt: new Date(), status: "REVOKED" } });
    expect(await checkInvitation(token)).toEqual({ ok: false, error: "InvitationRevoked" });
  });
  it("never turns a missing server secret into an invalid user invitation", async () => {
    const { token } = await invitation();
    vi.stubEnv("INVITE_TOKEN_PEPPER", "");
    expect(await checkInvitation(token)).toEqual({ ok: false, error: "Configuration" });
  });
  it("two concurrent acceptances produce one recipient, one role grant and one audit entry", async () => {
    const { token, row } = await invitation();
    const a = await prisma.user.create({ data: { name: `Invite a ${randomUUID()}` } });
    const b = await prisma.user.create({ data: { name: `Invite b ${randomUUID()}` } });
    expect((await checkInvitation(token)).ok).toBe(true);
    const attempts = await Promise.allSettled([consumeInvitationAccess(a.id, row.id), consumeInvitationAccess(b.id, row.id)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.userRole.count({ where: { userId: { in: [a.id, b.id] } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "Invitation", entityId: row.id, action: "INVITATION_CONSUMED" } })).toBe(1);
    expect(await checkInvitation(token)).toEqual({ ok: false, error: "InvitationUsed" });
  });
  it("rechecks a creator who is revoked after the link is rendered", async () => {
    const { token, row } = await invitation();
    expect((await checkInvitation(token)).ok).toBe(true);
    const target = await prisma.user.create({ data: { name: `Invitation refused ${randomUUID()}` } });
    await prisma.user.update({ where: { id: managerId }, data: { revokedAt: new Date() } });
    try {
      expect(await checkInvitation(token)).toEqual({ ok: false, error: "InvitationUnavailable" });
      await expect(consumeInvitationAccess(target.id, row.id)).rejects.toThrow();
      expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(0);
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING");
    } finally { await prisma.user.update({ where: { id: managerId }, data: { revokedAt: null } }); }
  });
});
