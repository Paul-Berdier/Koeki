import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/auth";
import type { Role } from "@koeki/domain";
import { changeAccount } from "./account-service";
import { accessControlledAdapter } from "./auth-session-adapter";
import { consumeInvitationAccess } from "./invitation-service";
import { getNinjas } from "./data";

vi.mock("./session", () => ({ demoMode: false, requirePermission: async () => ({ userId: "unused" }) }));
const dbReady = inject("dbReady");
const reason = "Décision de gestion testée sur base jetable";
const invitationPepper = `account-invitation-${randomUUID()}`;

describe.skipIf(!dbReady)("account access and sessions (PostgreSQL)", () => {
  let manager: { id: string }, agent: { id: string }, replacement: { id: string };
  let gradeId: string;
  async function user(name: string, roles: Role[]) {
    const created = await prisma.user.create({ data: { name: `${name} ${randomUUID()}` } });
    for (const code of roles) {
      const role = await prisma.role.upsert({ where: { code }, create: { code, label: code }, update: {} });
      await prisma.userRole.create({ data: { userId: created.id, roleId: role.id } });
    }
    if (roles.includes("SUPER_ADMIN")) await prisma.account.create({ data: { userId: created.id, type: "oauth", provider: "discord", providerAccountId: `fixture-${randomUUID()}` } });
    return created;
  }
  beforeAll(async () => {
    vi.stubEnv("INVITE_TOKEN_PEPPER", invitationPepper);
    manager = await user("Responsable comptes", ["KOEKI_MANAGER"]);
    agent = await user("Agent comptes", ["ECONOMIC_AGENT", "NINJA"]);
    replacement = await user("Remplaçant", ["ECONOMIC_AGENT"]);
    const grade = await prisma.ninjaGrade.upsert({ where: { code: "GENIN" }, create: { code: "GENIN", label: "Genin", sortOrder: 2 }, update: {} });
    gradeId = grade.id;
  });
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

  it("revokes atomically, preserves authors and ninja history, transfers only tasks and never resurrects cookies", async () => {
    const ninja = await prisma.ninjaProfile.create({ data: { firstName: "Fixture", lastName: "Comptes", code: `ACCOUNT-${randomUUID()}`, currentGradeId: gradeId, userId: agent.id, referenceAgentId: agent.id } });
    const task = await prisma.followUpTask.create({ data: { title: "Suivi à transférer", description: "Test", assigneeId: agent.id, createdById: manager.id, ninjaId: ninja.id } });
    const participation = await prisma.agentParticipation.create({ data: { userId: agent.id, startsAt: new Date("2026-01-01T00:00:00Z") } });
    const payment = await prisma.taxPayment.create({ data: { receiptNumber: `ACCT-${randomUUID()}`, ninjaId: ninja.id, recordedById: agent.id, amount: 250n, balanceBefore: 250n, balanceAfter: 0n, method: "Espèces", status: "VALIDATED", idempotencyKey: randomUUID() } });
    const report = await prisma.agentReport.create({ data: { authorId: agent.id, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-01-08T00:00:00Z"), summary: "Historique" } });
    const token = randomUUID();
    await accessControlledAdapter.createSession!({ sessionToken: token, userId: agent.id, expires: new Date(Date.now() + 3_600_000) });
    expect(await accessControlledAdapter.getSessionAndUser!(token)).not.toBeNull();
    const request = { actorId: manager.id, targetId: agent.id, operation: "revoke" as const, reason, replacementAgentId: replacement.id };
    const concurrent = await Promise.all([changeAccount(request), changeAccount(request)]);
    expect(concurrent.filter((entry) => entry.changed)).toHaveLength(1);
    expect(await accessControlledAdapter.getSessionAndUser!(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: agent.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: agent.id, action: "USER_ACCESS_REVOKED" } })).toBe(1);
    expect(await prisma.ninjaProfile.findUnique({ where: { id: ninja.id } })).toMatchObject({ userId: agent.id, referenceAgentId: agent.id });
    expect(await prisma.followUpTask.findUnique({ where: { id: task.id } })).toMatchObject({ assigneeId: replacement.id });
    expect(await prisma.assignmentHistory.count({ where: { taskId: task.id, previousAgentId: agent.id, assignedAgentId: replacement.id } })).toBe(1);
    expect(await prisma.assignmentHistory.count({ where: { ninjaId: ninja.id } })).toBe(0);
    expect((await prisma.agentParticipation.findUniqueOrThrow({ where: { id: participation.id } })).endsAt).not.toBeNull();
    expect(await prisma.taxPayment.findUnique({ where: { id: payment.id } })).toMatchObject({ recordedById: agent.id, amount: 250n });
    expect(await prisma.agentReport.findUnique({ where: { id: report.id } })).toMatchObject({ authorId: agent.id });
    await expect(accessControlledAdapter.createSession!({ sessionToken: randomUUID(), userId: agent.id, expires: new Date(Date.now() + 3_600_000) })).rejects.toThrow("SESSION_REVOKED");
    await changeAccount({ actorId: manager.id, targetId: agent.id, operation: "reactivate", reason });
    expect(await accessControlledAdapter.getSessionAndUser!(token)).toBeNull();
    expect(await prisma.ninjaProfile.findUnique({ where: { id: ninja.id } })).toMatchObject({ referenceAgentId: agent.id });
    const newToken = randomUUID();
    await accessControlledAdapter.createSession!({ sessionToken: newToken, userId: agent.id, expires: new Date(Date.now() + 3_600_000) });
    expect(await accessControlledAdapter.getSessionAndUser!(newToken)).not.toBeNull();
  });

  it("removing the agent role leaves personal access and unassigns only unfinished tasks", async () => {
    const target = await user("Retrait agent", ["NINJA", "ECONOMIC_AGENT"]);
    const ninja = await prisma.ninjaProfile.create({ data: { firstName: "Personnel", lastName: "Préservé", code: `ROLE-${randomUUID()}`, currentGradeId: gradeId, userId: target.id, referenceAgentId: target.id } });
    const task = await prisma.followUpTask.create({ data: { title: "À attribuer", description: "Test", assigneeId: target.id, createdById: manager.id } });
    await changeAccount({ actorId: manager.id, targetId: target.id, operation: "remove-agent", reason });
    expect(await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } })).toMatchObject([{ role: { code: "NINJA" } }]);
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toMatchObject({ revokedAt: null });
    expect(await prisma.ninjaProfile.findUnique({ where: { id: ninja.id } })).toMatchObject({ userId: target.id, referenceAgentId: target.id });
    expect(await prisma.followUpTask.findUnique({ where: { id: task.id } })).toMatchObject({ assigneeId: null });
  });

  it("keeps the ninja register collective regardless of legacy references and revokes without a dossier replacement", async () => {
    const target = await user("Ancien référent sans tâche", ["ECONOMIC_AGENT"]);
    const dossiers = await Promise.all([target.id, replacement.id, null].map((referenceAgentId) => prisma.ninjaProfile.create({ data: { firstName: "Collectif", lastName: "Registre", code: `SHARED-${randomUUID()}`, currentGradeId: gradeId, referenceAgentId } })));
    const before = await getNinjas({});
    expect(dossiers.every((dossier) => before.ninjas.some((row) => row.id === dossier.id))).toBe(true);
    await changeAccount({ actorId: manager.id, targetId: target.id, operation: "revoke", reason, replacementAgentId: "unused-invalid-replacement" });
    expect(await prisma.ninjaProfile.findUnique({ where: { id: dossiers[0]!.id } })).toMatchObject({ referenceAgentId: target.id });
    expect(await prisma.assignmentHistory.count({ where: { ninjaId: { in: dossiers.map((dossier) => dossier.id) } } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: target.id, action: "USER_ACCESS_REVOKED" } });
    expect(audit.newValues).toMatchObject({ replacementAgentId: null });
    const after = await getNinjas({});
    expect(dossiers.every((dossier) => after.ninjas.some((row) => row.id === dossier.id))).toBe(true);
    expect(await prisma.ninjaProfile.findUnique({ where: { id: dossiers[1]!.id } })).toMatchObject({ referenceAgentId: replacement.id });
  });

  it("rechecks revoked actors, leadership targets and forged grants inside the mutation", async () => {
    const inactive = await user("Ancien responsable", ["KOEKI_MANAGER"]);
    await prisma.user.update({ where: { id: inactive.id }, data: { revokedAt: new Date() } });
    await expect(changeAccount({ actorId: inactive.id, targetId: agent.id, operation: "revoke", reason })).rejects.toThrow(/refusé/);
    await expect(changeAccount({ actorId: manager.id, targetId: manager.id, operation: "revoke", reason })).rejects.toThrow(/propre/);
    const secondManager = await user("Autre responsable", ["NINJA", "KOEKI_MANAGER"]);
    await expect(changeAccount({ actorId: manager.id, targetId: secondManager.id, operation: "revoke", reason })).rejects.toThrow(/dirigeant/);
    await expect(changeAccount({ actorId: manager.id, targetId: agent.id, operation: "roles", roles: ["KOEKI_MANAGER"], reason })).rejects.toThrow(/dirigeant/);
    await expect(changeAccount({ actorId: manager.id, targetId: agent.id, operation: "revoke", reason: "" })).rejects.toThrow(/motif/);
  });

  it("rejects a session with a stale version even if its database row remains", async () => {
    const token = randomUUID();
    const target = await user("Version session", ["NINJA"]);
    await prisma.user.update({ where: { id: target.id }, data: { sessionVersion: 4 } });
    await prisma.session.create({ data: { userId: target.id, sessionToken: token, expires: new Date(Date.now() + 3_600_000), sessionVersion: 3 } });
    expect(await accessControlledAdapter.getSessionAndUser!(token)).toBeNull();
  });

  it("preserves leadership history when granting an agent role, then closes participation on leaving service", async () => {
    const superAdmin = await user("Gestion participation", ["SUPER_ADMIN"]);
    const leader = await user("Responsable participant", ["KOEKI_MANAGER"]);
    const participation = await prisma.agentParticipation.create({ data: { userId: leader.id, startsAt: new Date("2026-01-01T00:00:00Z"), serviceRole: "LEADERSHIP", rankingEligible: false, createdById: superAdmin.id } });
    try {
      await changeAccount({ actorId: superAdmin.id, targetId: leader.id, operation: "roles", roles: ["KOEKI_MANAGER", "ECONOMIC_AGENT"], reason });
      expect(await prisma.agentParticipation.count({ where: { userId: leader.id, endsAt: null } })).toBe(1);
      const preceding = await prisma.agentParticipation.findUniqueOrThrow({ where: { id: participation.id } });
      const current = await prisma.agentParticipation.findFirstOrThrow({ where: { userId: leader.id, endsAt: null } });
      expect(preceding.startsAt).toEqual(participation.startsAt);
      expect(preceding.serviceRole).toBe("LEADERSHIP");
      expect(preceding.endsAt).toEqual(current.startsAt);
      expect(current.serviceRole).toBe("ECONOMIC_AGENT");
      expect(current.rankingEligible).toBe(false);
      const task = await prisma.followUpTask.create({ data: { title: "Dossier responsable", description: "Test", assigneeId: leader.id, createdById: superAdmin.id } });
      // Directly establish the pre-existing manager-only case as a fixture.
      await prisma.userRole.deleteMany({ where: { userId: leader.id, role: { code: "ECONOMIC_AGENT" } } });
      await changeAccount({ actorId: superAdmin.id, targetId: leader.id, operation: "roles", roles: ["NINJA"], reason });
      expect((await prisma.agentParticipation.findUniqueOrThrow({ where: { id: participation.id } })).endsAt).not.toBeNull();
      expect(await prisma.agentParticipation.count({ where: { userId: leader.id, endsAt: null } })).toBe(0);
      expect((await prisma.followUpTask.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBeNull();
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: superAdmin.id, role: { code: "SUPER_ADMIN" } } });
    }
  });

  it("an invitation cannot reactivate a revoked account or retain a revoked creator's authority", async () => {
    const target = await user("Invité désactivé", []);
    const ninjaRole = await prisma.role.findUniqueOrThrow({ where: { code: "NINJA" } });
    const invitation = await prisma.invitation.create({ data: { tokenHash: randomUUID(), roleId: ninjaRole.id, createdById: manager.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    await prisma.user.update({ where: { id: target.id }, data: { revokedAt: new Date() } });
    await expect(consumeInvitationAccess(target.id, invitation.id)).rejects.toThrow("ACCOUNT_REVOKED");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("PENDING");
    expect(await prisma.userRole.count({ where: { userId: target.id } })).toBe(0);
    const formerManager = await user("Créateur rétrogradé", ["KOEKI_MANAGER"]);
    const pending = await prisma.invitation.create({ data: { tokenHash: randomUUID(), roleId: ninjaRole.id, createdById: formerManager.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    await prisma.userRole.deleteMany({ where: { userId: formerManager.id } });
    const newTarget = await user("Nouvel invité", []);
    await expect(consumeInvitationAccess(newTarget.id, pending.id)).rejects.toThrow(/refusé/);
  });

  it("consumes an invitation once and revalidates leadership grants at consumption", async () => {
    const ordinaryRole = await prisma.role.findUniqueOrThrow({ where: { code: "NINJA" } });
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: "KOEKI_MANAGER" } });
    const first = await user("Invitation concurrente 1", []), second = await user("Invitation concurrente 2", []);
    const invitation = await prisma.invitation.create({ data: { tokenHash: randomUUID(), roleId: ordinaryRole.id, createdById: manager.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    const result = await Promise.allSettled([consumeInvitationAccess(first.id, invitation.id), consumeInvitationAccess(second.id, invitation.id)]);
    expect(result.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: invitation.id, action: "INVITATION_CONSUMED" } })).toBe(1);
    const forged = await prisma.invitation.create({ data: { tokenHash: randomUUID(), roleId: managerRole.id, createdById: manager.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    const third = await user("Fausse invitation dirigeante", []);
    await expect(consumeInvitationAccess(third.id, forged.id)).rejects.toThrow(/dirigeant/);
  });

  async function reservedInvitation(role: Role = "NINJA", creatorId = manager.id) {
    const ninja = await prisma.ninjaProfile.create({ data: { firstName: "Invitation", lastName: "Réservée", code: `LINK-${randomUUID()}`, currentGradeId: gradeId } });
    const invitedRole = await prisma.role.upsert({ where: { code: role }, create: { code: role, label: role }, update: {} });
    const { token, tokenHash } = createInvitationToken(invitationPepper);
    const invitation = await prisma.invitation.create({ data: { tokenHash, roleId: invitedRole.id, createdById: creatorId, ninjaProfileId: ninja.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    return { ninja, invitation, token };
  }

  it.each([["KOEKI_MANAGER", "NINJA"], ["NINJA", "ECONOMIC_AGENT"]] as const)("links a reserved profile for %s without granting the invited %s role or participation", async (existingRole, invitedRole) => {
    const target = await user("Compte déjà autorisé", [existingRole]);
    const { ninja, invitation, token } = await reservedInvitation(invitedRole);
    const previousRoles = await prisma.userRole.findMany({ where: { userId: target.id } });
    await consumeInvitationAccess(target.id, invitation.id, token);
    expect(await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninja.id } })).toMatchObject({ userId: target.id, version: ninja.version + 1 });
    expect(await prisma.userRole.findMany({ where: { userId: target.id } })).toEqual(previousRoles);
    expect(await prisma.agentParticipation.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).toMatchObject({ status: "USED", consumedById: target.id });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { entityId: invitation.id, action: "INVITATION_CONSUMED" } })).toMatchObject({ actorId: target.id, newValues: { ninjaProfileId: ninja.id, accessGranted: false } });
  });

  it("requires the confirmed token and never changes existing access from a general invitation", async () => {
    const target = await user("Liaison avec preuve", ["NINJA"]);
    const { ninja, invitation, token } = await reservedInvitation("ECONOMIC_AGENT");
    for (const wrongToken of [undefined, createInvitationToken(invitationPepper).token]) {
      await expect(consumeInvitationAccess(target.id, invitation.id, wrongToken)).rejects.toThrow("INVITATION_UNUSABLE");
    }
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninja.id } })).userId).toBeNull();
    await prisma.invitation.update({ where: { id: invitation.id }, data: { ninjaProfileId: null } });
    await expect(consumeInvitationAccess(target.id, invitation.id, token)).rejects.toThrow("ACCOUNT_ALREADY_AUTHORIZED");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("PENDING");
    expect(await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } })).toMatchObject([{ role: { code: "NINJA" } }]);
  });

  it("never replaces an existing identity or claims a profile already linked to another account", async () => {
    const target = await user("Identité déjà liée", ["KOEKI_MANAGER"]);
    const current = await prisma.ninjaProfile.create({ data: { firstName: "Identité", lastName: "Conservée", code: `OWN-${randomUUID()}`, currentGradeId: gradeId, userId: target.id } });
    const { ninja, invitation, token } = await reservedInvitation();
    await expect(consumeInvitationAccess(target.id, invitation.id, token)).rejects.toThrow("ACCOUNT_IDENTITY_MISMATCH");
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: current.id } })).userId).toBe(target.id);
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninja.id } })).userId).toBeNull();
    const unlinked = await user("Compte sans fiche", ["NINJA"]);
    const occupied = await reservedInvitation();
    const owner = await user("Propriétaire conservé", ["NINJA"]);
    await prisma.ninjaProfile.update({ where: { id: occupied.ninja.id }, data: { userId: owner.id } });
    await expect(consumeInvitationAccess(unlinked.id, occupied.invitation.id, occupied.token)).rejects.toThrow("INVITED_NINJA_UNAVAILABLE");
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: occupied.ninja.id } })).userId).toBe(owner.id);
    expect(await prisma.invitation.count({ where: { id: { in: [invitation.id, occupied.invitation.id] }, status: "PENDING" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: { in: [invitation.id, occupied.invitation.id] }, action: "INVITATION_CONSUMED" } })).toBe(0);
  });

  it("rechecks invitation lifecycle, creator authority and active profile before linking existing access", async () => {
    for (const state of ["expired", "revoked", "used", "creator-revoked", "creator-demoted", "profile-inactive", "account-revoked", "token-changed"] as const) {
      const target = await user(`Compte liaison ${state}`, ["NINJA"]);
      const creator = await user(`Créateur liaison ${state}`, ["KOEKI_MANAGER"]);
      const { ninja, invitation, token } = await reservedInvitation("ECONOMIC_AGENT", creator.id);
      if (state === "expired") await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      if (state === "revoked") await prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date(), status: "REVOKED" } });
      if (state === "used") await prisma.invitation.update({ where: { id: invitation.id }, data: { consumedAt: new Date(), status: "USED" } });
      if (state === "creator-revoked") await prisma.user.update({ where: { id: creator.id }, data: { revokedAt: new Date() } });
      if (state === "creator-demoted") await prisma.userRole.deleteMany({ where: { userId: creator.id } });
      if (state === "profile-inactive") await prisma.ninjaProfile.update({ where: { id: ninja.id }, data: { status: "ARCHIVED" } });
      if (state === "account-revoked") await prisma.user.update({ where: { id: target.id }, data: { revokedAt: new Date() } });
      if (state === "token-changed") await prisma.invitation.update({ where: { id: invitation.id }, data: { tokenHash: createInvitationToken(invitationPepper).tokenHash } });
      await expect(consumeInvitationAccess(target.id, invitation.id, token)).rejects.toThrow();
      expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninja.id } })).userId).toBeNull();
      expect(await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } })).toMatchObject([{ role: { code: "NINJA" } }]);
      expect(await prisma.agentParticipation.count({ where: { userId: target.id } })).toBe(0);
    }
  });

  it("serializes competing existing accounts and competing profile invitations without changing roles", async () => {
    const first = await user("Liaison concurrente 1", ["NINJA"]), second = await user("Liaison concurrente 2", ["NINJA"]);
    const shared = await reservedInvitation("ECONOMIC_AGENT");
    const attempts = await Promise.allSettled([consumeInvitationAccess(first.id, shared.invitation.id, shared.token), consumeInvitationAccess(second.id, shared.invitation.id, shared.token)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const consumed = await prisma.invitation.findUniqueOrThrow({ where: { id: shared.invitation.id } });
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: shared.ninja.id } })).userId).toBe(consumed.consumedById);
    expect(await prisma.auditLog.count({ where: { entityId: shared.invitation.id, action: "INVITATION_CONSUMED" } })).toBe(1);
    expect(await prisma.userRole.count({ where: { userId: { in: [first.id, second.id] } } })).toBe(2);
    expect(await prisma.agentParticipation.count({ where: { userId: { in: [first.id, second.id] } } })).toBe(0);
    const target = await user("Deux invitations de fiche", ["KOEKI_MANAGER"]);
    const a = await reservedInvitation(), b = await reservedInvitation();
    const races = await Promise.allSettled([consumeInvitationAccess(target.id, a.invitation.id, a.token), consumeInvitationAccess(target.id, b.invitation.id, b.token)]);
    expect(races.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.ninjaProfile.count({ where: { userId: target.id } })).toBe(1);
    expect(await prisma.invitation.count({ where: { id: { in: [a.invitation.id, b.invitation.id] }, status: "PENDING" } })).toBe(1);
    expect(await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } })).toMatchObject([{ role: { code: "KOEKI_MANAGER" } }]);
  });

  it("serializes concurrent demotions and ignores a non-connectable bootstrap administrator", async () => {
    // This suite only runs on the explicitly isolated fixture database. No files
    // run concurrently; existing fixture roles are restored in finally.
    const first = await user("Super concurrence 1", ["SUPER_ADMIN"]);
    const second = await user("Super concurrence 2", ["SUPER_ADMIN"]);
    const superRole = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
    const bootstrap = await prisma.user.create({ data: { name: "Bootstrap sans accès", roles: { create: { roleId: superRole.id } } } });
    const connectedSupers = { revokedAt: null, roles: { some: { role: { code: "SUPER_ADMIN" as const } } }, OR: [{ accounts: { some: { provider: "discord" } } }, { sessions: { some: { expires: { gt: new Date() } } } }] };
    const supers = await prisma.user.findMany({ where: connectedSupers, select: { id: true, roles: { select: { roleId: true } } } });
    try {
      const results = await Promise.allSettled(supers.map((target) => changeAccount({ actorId: target.id, targetId: target.id, operation: "roles", roles: ["NINJA"], reason })));
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(await prisma.user.count({ where: connectedSupers })).toBe(1);
      expect(await prisma.userRole.count({ where: { userId: bootstrap.id, roleId: superRole.id } })).toBe(1);
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: { in: supers.map((target) => target.id) } } });
      await prisma.userRole.createMany({ data: supers.flatMap((target) => target.roles.map((role) => ({ userId: target.id, roleId: role.roleId }))), skipDuplicates: true });
      await prisma.userRole.deleteMany({ where: { userId: { in: [first.id, second.id, bootstrap.id] }, roleId: superRole.id } });
    }
  });
});
