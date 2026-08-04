import { z } from "zod";
export { createInvitationToken, hashInvitationToken, verifyInvitationToken } from "@koeki/domain";
export const authEnvSchema = z.object({ AUTH_SECRET: z.string().min(32), DISCORD_CLIENT_ID: z.string().min(1), DISCORD_CLIENT_SECRET: z.string().min(1), DISCORD_GUILD_ID: z.string().min(1), INVITE_TOKEN_PEPPER: z.string().min(16) });
export type InvitationState = { status: "PENDING" | "USED" | "REVOKED" | "EXPIRED"; expiresAt: Date; consumedAt: Date | null; revokedAt: Date | null };
export function isInvitationUsable(invitation: InvitationState, now = new Date()) { return invitation.status === "PENDING" && invitation.expiresAt > now && invitation.consumedAt === null && invitation.revokedAt === null; }
export function sessionIsValid(user: { revokedAt: Date | null; sessionVersion: number }, session: { expires: Date; sessionVersion: number }, now = new Date()) { return user.revokedAt === null && session.expires > now && user.sessionVersion === session.sessionVersion; }
