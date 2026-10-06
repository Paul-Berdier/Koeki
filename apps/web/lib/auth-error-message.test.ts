import { describe, expect, it } from "vitest";
import { getAuthErrorMessage } from "./auth-error-message";

describe("authentication error messages", () => {
  it.each([undefined, "AccessDenied"])("keeps real access refusals distinct (%s)", (error) => {
    expect(getAuthErrorMessage(error).title).toBe("Accès refusé");
  });

  it.each(["Configuration", "CallbackRouteError", "Default", "InvalidCheck", "unexpected-value"])("does not blame invitations for technical failures (%s)", (error) => {
    expect(getAuthErrorMessage(error).title).toBe("Connexion indisponible");
    expect(getAuthErrorMessage(error).description).toContain("problème technique");
  });

  it("does not render untrusted query parameters", () => {
    const untrusted = '<script>alert("secret-oauth-code")</script>';
    expect(JSON.stringify(getAuthErrorMessage(untrusted))).not.toContain(untrusted);
    expect(JSON.stringify(getAuthErrorMessage(untrusted))).not.toContain("secret-oauth-code");
  });

  it("never silently links a different Discord account", () => {
    expect(getAuthErrorMessage("OAuthAccountNotLinked").title).toBe("Compte Discord non associé");
  });
});
