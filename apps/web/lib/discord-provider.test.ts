import { afterEach, describe, expect, it, vi } from "vitest";
import Discord from "next-auth/providers/discord";
import { createDiscordProvider, DISCORD_ISSUER } from "./discord-provider";

afterEach(() => vi.unstubAllEnvs());

describe("Discord OAuth configuration", () => {
  it("pins the real issuer instead of Auth.js's placeholder", () => {
    const provider = createDiscordProvider();
    expect(provider.id).toBe("discord");
    expect(DISCORD_ISSUER).toBe("https://discord.com");
    expect(provider.options?.issuer).toBe(DISCORD_ISSUER);
  });

  it("preserves the guild scope and default security checks", () => {
    const provider = createDiscordProvider();
    const defaults = Discord({ clientId: "test", clientSecret: "test" });
    expect(provider.options?.authorization).toEqual({ params: { scope: "identify guilds" } });
    expect(provider.checks).toEqual(defaults.checks);
    expect(provider.options?.checks).toBeUndefined();
    expect(provider.options?.allowDangerousEmailAccountLinking).not.toBe(true);
    expect(provider.token).toEqual(defaults.token);
    expect(provider.userinfo).toEqual(defaults.userinfo);
  });

  it("uses server credentials without baking them into source", () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "fixture-client");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "fixture-secret");
    expect(createDiscordProvider().options).toMatchObject({
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
    });
  });
});
