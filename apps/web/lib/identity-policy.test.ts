import { describe, expect, it, vi } from "vitest";
import { hasConsistentDiscordIdentity, ownsDiscordIdentity } from "./discord-identity";
import { parseProfileReference, profileLabel } from "./profile-claim";
import { readAuthStartForm } from "./auth-start-guard";

vi.mock("./session", () => ({ demoMode: false, requirePermission: async () => ({ userId: "fixture" }) }));

describe("Discord identity invariants", () => {
  it("uses the provider id, never an RP name", () => {
    expect(ownsDiscordIdentity({ discordId: "111", accounts: [{ providerAccountId: "111" }] }, "111")).toBe(true);
    expect(ownsDiscordIdentity({ discordId: "111", accounts: [{ providerAccountId: "111" }] }, "222")).toBe(false);
  });
  it("fails closed on mismatched and multiple accounts", () => {
    expect(hasConsistentDiscordIdentity({ discordId: "111", accounts: [{ providerAccountId: "222" }] })).toBe(false);
    expect(hasConsistentDiscordIdentity({ discordId: null, accounts: [{ providerAccountId: "111" }, { providerAccountId: "222" }] })).toBe(false);
    expect(hasConsistentDiscordIdentity({ discordId: "111", accounts: [] })).toBe(false);
  });
  it("retains legacy single-account and unlinked bootstrap compatibility without treating them as the same identity", () => {
    expect(ownsDiscordIdentity({ discordId: null, accounts: [{ providerAccountId: "111" }] }, "111")).toBe(true);
    expect(hasConsistentDiscordIdentity({ discordId: null, accounts: [] })).toBe(true);
    expect(ownsDiscordIdentity({ discordId: null, accounts: [] }, "111")).toBe(false);
  });
});

describe("exact profile references", () => {
  it("requires a complete label and exact code", () => {
    expect(parseProfileReference("Suki Zetsubo · NIN-123456")).toEqual({ label: "Suki Zetsubo · NIN-123456", code: "NIN-123456" });
    expect(profileLabel("Suki", "Zetsubo", "NIN-123456")).toBe("Suki Zetsubo · NIN-123456");
    for (const input of [null, "Suki", "Suki Zetsubo", "NIN-123456", "Suki · NIN-123456 autre", "Suki · NIN-12", "a".repeat(251)]) expect(() => parseProfileReference(input)).toThrow();
  });
  it("normalizes harmless Unicode spacing but does not conflate different characters", () => {
    expect(parseProfileReference(" Suki\u00a0 Zetsubo  · NIN-123456 ").label).toBe("Suki Zetsubo · NIN-123456");
    expect(profileLabel("Suki", "Zetsubo", "NIN-123456")).not.toBe(profileLabel("Kagero", "Hakumei", "NIN-123456"));
  });
});

describe("invitation confirmation form parsing", () => {
  const request = (body: string) => new Request("https://koeki.example/api/connexion/discord", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  it("allows confirmation only for invitations", async () => {
    const data = await readAuthStartForm(request("intent=invitation&token=test&confirmIdentity=on&confirmedNinjaId=ninja"));
    expect(data?.get("confirmedNinjaId")).toBe("ninja");
    expect(await readAuthStartForm(request("intent=connexion&confirmIdentity=on"))).toBeNull();
  });
  it("rejects duplicate confirmations, unknown fields and false confirmations", async () => {
    for (const body of ["intent=invitation&confirmIdentity=on&confirmIdentity=on", "intent=invitation&confirmedNinjaId=a&confirmedNinjaId=b", "intent=invitation&userId=someone", "intent=invitation&confirmIdentity=false"]) expect(await readAuthStartForm(request(body))).toBeNull();
  });
});
