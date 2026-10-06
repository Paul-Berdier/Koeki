import Discord from "next-auth/providers/discord";

/** Discord's canonical issuer, also published in its OpenID metadata. */
export const DISCORD_ISSUER = "https://discord.com";

export function createDiscordProvider() {
  return Discord({
    clientId: process.env.DISCORD_CLIENT_ID ?? "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
    // Without this, Auth.js falls back to https://authjs.dev and rejects
    // Discord's authorization response when it contains an `iss` parameter.
    // Keep issuer validation and the provider's default OAuth/PKCE checks.
    issuer: DISCORD_ISSUER,
    authorization: { params: { scope: "identify guilds" } },
  });
}
