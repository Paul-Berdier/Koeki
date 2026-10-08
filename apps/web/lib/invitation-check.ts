import { hashInvitationToken } from "@koeki/auth";
import { prisma } from "@koeki/database";
import { assertInvitationRole } from "@koeki/domain";
import { hasInvitationTokenShape, invitationFailure, type InvitationFailure } from "./invitation-state";

type InvitationCheck = { ok: true; id: string; expiresAt: Date } | { ok: false; error: InvitationFailure };

/** Read-only preflight. GETs, link previews and crawlers must never consume invitations. */
export async function checkInvitation(token: unknown): Promise<InvitationCheck> {
  if (!hasInvitationTokenShape(token)) return { ok: false, error: "InvitationInvalid" };
  const pepper = process.env.INVITE_TOKEN_PEPPER;
  if (!pepper) return { ok: false, error: "Configuration" };
  try {
    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(token, pepper) },
      include: {
        role: { select: { code: true } },
        createdBy: { select: { id: true, revokedAt: true, roles: { select: { role: { select: { code: true } } } } } },
        ninjaProfile: { select: { status: true, userId: true } },
      },
    });
    const error = invitationFailure(invitation);
    if (error) return { ok: false, error };
    if (!invitation) return { ok: false, error: "InvitationInvalid" };
    try {
      assertInvitationRole({ id: invitation.createdBy.id, revokedAt: invitation.createdBy.revokedAt, roles: invitation.createdBy.roles.map(({ role }) => role.code) }, invitation.role.code);
    } catch {
      return { ok: false, error: "InvitationUnavailable" };
    }
    if (invitation.ninjaProfileId && (!invitation.ninjaProfile || invitation.ninjaProfile.status !== "ACTIVE" || invitation.ninjaProfile.userId)) {
      return { ok: false, error: "InvitationUnavailable" };
    }
    return { ok: true, id: invitation.id, expiresAt: invitation.expiresAt };
  } catch {
    // No credential, hash, identity or database exception is exposed in public URLs/logs.
    console.warn("[auth] vérification technique de l’invitation indisponible");
    return { ok: false, error: "Configuration" };
  }
}
