import { prisma } from "@koeki/database";
import { hashInvitationToken } from "@koeki/auth";
import { assertInvitationRole } from "@koeki/domain";
import { currentAccount, lockAccountChanges } from "./account-service";
import { hasInvitationTokenShape } from "./invitation-state";

/** OAuth calls this only after verifying the opaque invitation token. */
export async function consumeInvitationAccess(userId: string, invitationId: string, confirmedToken?: string) {
  await prisma.$transaction(async (tx) => {
    await lockAccountChanges(tx);
    const invitation = await tx.invitation.findUnique({ where: { id: invitationId }, include: { role: true } });
    if (!invitation || invitation.status !== "PENDING" || invitation.consumedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) throw new Error("INVITATION_UNUSABLE");
    const target = await currentAccount(tx, userId);
    if (target.revokedAt) throw new Error("ACCOUNT_REVOKED");
    const linkOnly = target.roles.length > 0;
    // Existing access cannot be promoted through an invitation. The only new
    // case is the exact reserved profile confirmed before OAuth, with its token
    // rechecked under the same lock as the account and invitation changes.
    if (linkOnly && !invitation.ninjaProfileId) throw new Error("ACCOUNT_ALREADY_AUTHORIZED");
    if (linkOnly || confirmedToken !== undefined) {
      const pepper = process.env.INVITE_TOKEN_PEPPER;
      if (!pepper || !hasInvitationTokenShape(confirmedToken) || hashInvitationToken(confirmedToken, pepper) !== invitation.tokenHash) throw new Error("INVITATION_UNUSABLE");
    }
    const creator = await currentAccount(tx, invitation.createdById);
    assertInvitationRole(creator, invitation.role.code);
    if (invitation.ninjaProfileId) {
      const currentProfile = await tx.ninjaProfile.findUnique({ where: { userId }, select: { id: true } });
      if (currentProfile) throw new Error("ACCOUNT_IDENTITY_MISMATCH");
      await tx.$executeRaw`SELECT id FROM "NinjaProfile" WHERE id = ${invitation.ninjaProfileId} FOR UPDATE`;
      const linked = await tx.ninjaProfile.updateMany({ where: { id: invitation.ninjaProfileId, status: "ACTIVE", userId: null }, data: { userId, version: { increment: 1 } } });
      if (linked.count !== 1) throw new Error("INVITED_NINJA_UNAVAILABLE");
    }
    const consumed = await tx.invitation.updateMany({ where: { id: invitation.id, status: "PENDING", consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { status: "USED", consumedById: userId, consumedAt: new Date() } });
    if (consumed.count !== 1) throw new Error("INVITATION_ALREADY_CONSUMED");
    if (!linkOnly) {
      await tx.userRole.create({ data: { userId, roleId: invitation.roleId, assignedById: creator.id } });
      if (invitation.role.code === "ECONOMIC_AGENT") await tx.agentParticipation.create({ data: { userId, startsAt: new Date(), dateSource: "DECLARED", serviceRole: "ECONOMIC_AGENT", rankingEligible: true, createdById: creator.id } });
    }
    await tx.auditLog.create({ data: { actorId: userId, action: "INVITATION_CONSUMED", entityType: "Invitation", entityId: invitation.id, requestId: crypto.randomUUID(), newValues: { ninjaProfileId: invitation.ninjaProfileId, accessGranted: !linkOnly } } });
  });
}
