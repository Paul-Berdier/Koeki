import type { InvitationState } from "@koeki/auth";

export type InvitationFailure = "InvitationInvalid" | "InvitationUsed" | "InvitationRevoked" | "InvitationExpired" | "InvitationUnavailable" | "Configuration";
export const INVITATION_COOKIE = "koeki_invite";
export const INVITATION_COOKIE_MAX_AGE = 600;

/** Opaque 32-byte base64url tokens; never trim or silently repair a bearer credential. */
export function hasInvitationTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function invitationFailure(invitation: InvitationState | null, now = new Date()): InvitationFailure | null {
  if (!invitation) return "InvitationInvalid";
  if (invitation.revokedAt || invitation.status === "REVOKED") return "InvitationRevoked";
  if (invitation.consumedAt || invitation.status === "USED") return "InvitationUsed";
  if (invitation.status === "EXPIRED" || !Number.isFinite(invitation.expiresAt.getTime()) || invitation.expiresAt <= now) return "InvitationExpired";
  return invitation.status === "PENDING" ? null : "InvitationInvalid";
}

export function invitationCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: INVITATION_COOKIE_MAX_AGE, path: "/" };
}
