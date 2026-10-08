import { afterEach, describe, expect, it, vi } from "vitest";
import { createInvitationToken, isInvitationUsable, type InvitationState } from "@koeki/auth";
import { hasInvitationTokenShape, invitationCookieOptions, invitationFailure } from "./invitation-state";
import { getAuthErrorMessage } from "./auth-error-message";

const now = new Date("2026-10-08T12:00:00Z");
const pending: InvitationState = { status: "PENDING", expiresAt: new Date("2026-10-09T12:00:00Z"), consumedAt: null, revokedAt: null };
afterEach(() => vi.unstubAllEnvs());

describe("individual invitation states", () => {
  it("accepts issued tokens and rejects malformed or modified credentials", () => {
    const { token } = createInvitationToken("fixture-pepper-only");
    expect(hasInvitationTokenShape(token)).toBe(true);
    for (const invalid of [null, undefined, 42, "", "bad", `${token} `, `${token}/`, "a".repeat(10_000), "../".repeat(15)]) expect(hasInvitationTokenShape(invalid)).toBe(false);
  });
  it("agrees with the existing usability rule for all supported states", () => {
    for (const status of ["PENDING", "USED", "REVOKED", "EXPIRED"] as const) {
      for (const expiresAt of [new Date(now.getTime() - 1), now, pending.expiresAt]) {
        for (const consumedAt of [null, now]) for (const revokedAt of [null, now]) {
          const input = { status, expiresAt, consumedAt, revokedAt };
          expect(invitationFailure(input, now) === null).toBe(isInvitationUsable(input, now));
        }
      }
    }
  });
  it("distinguishes missing, used, revoked and expired invitations, including expiry equality", () => {
    expect(invitationFailure(null, now)).toBe("InvitationInvalid");
    expect(invitationFailure(pending, now)).toBeNull();
    expect(invitationFailure({ ...pending, status: "USED", consumedAt: now }, now)).toBe("InvitationUsed");
    expect(invitationFailure({ ...pending, revokedAt: now }, now)).toBe("InvitationRevoked");
    expect(invitationFailure({ ...pending, expiresAt: now }, now)).toBe("InvitationExpired");
    expect(invitationFailure({ ...pending, expiresAt: new Date(NaN) }, now)).toBe("InvitationExpired");
  });
  it("keeps production cookies secure, host-only and scoped to the callback as well as the invite page", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(invitationCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    vi.stubEnv("NODE_ENV", "development");
    expect(invitationCookieOptions().secure).toBe(false);
  });
  it.each([
    ["InvitationRequired", "Lien d’invitation nécessaire"], ["InvitationUsed", "Invitation déjà utilisée"],
    ["InvitationExpired", "Invitation expirée"], ["InvitationRevoked", "Invitation révoquée"],
    ["InvitationInvalid", "Lien d’invitation invalide"], ["InvitationUnavailable", "Invitation indisponible"],
    ["DiscordMembershipRequired", "Serveur Discord requis"], ["DiscordUnavailable", "Vérification Discord indisponible"],
    ["AccountRevoked", "Accès désactivé"],
  ])("renders an actionable fixed message for %s", (code, title) => {
    expect(getAuthErrorMessage(code).title).toBe(title);
    expect(getAuthErrorMessage(code).help.length).toBeGreaterThan(30);
  });
  it.each(["__proto__", "constructor", "toString", '<script>secret-token</script>'])("does not treat inherited or arbitrary keys as messages: %s", (code) => {
    expect(getAuthErrorMessage(code).title).toBe("Connexion indisponible");
    expect(JSON.stringify(getAuthErrorMessage(code))).not.toContain(code);
  });
});
