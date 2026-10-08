// Test-process preload only. Never imported by the application or enabled in a production config.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
const db = new URL(process.env.DATABASE_URL_TEST ?? "http://invalid");
const secret = process.env.KOEKI_E2E_OAUTH_SECRET;
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(db.hostname) || !["/koeki_v2_test", "/koeki_front_test_20261004"].includes(db.pathname) || process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST || !secret || secret.length < 32) {
  throw new Error("OAuth fixture requires an isolated, explicitly allowed local test database");
}
const originalFetch = globalThis.fetch;
function parseFixture(value) {
  const [prefix, encoded, signature] = String(value ?? "").split(".");
  if (prefix !== "koeki-e2e" || !encoded || encoded.length > 4096 || !signature) throw new Error("Invalid fixture");
  const expected = Buffer.from(createHmac("sha256", secret).update(encoded).digest("hex"));
  const provided = Buffer.from(signature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new Error("Invalid fixture signature");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!/^\d{18,20}$/.test(payload.id) || !/^[A-Za-z0-9_-]{43}$/.test(payload.challenge)) throw new Error("Invalid fixture payload");
  return payload;
}
globalThis.fetch = async (input, init) => {
  const address = input instanceof Request ? input.url : String(input);
  const url = new URL(address);
  if (url.hostname !== "discord.com") return originalFetch(input, init);
  const request = new Request(input, init);
  try {
    if (url.pathname === "/api/oauth2/token" && request.method === "POST") {
      const body = new URLSearchParams(await request.text());
      const code = body.get("code");
      const payload = parseFixture(code);
      const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
      if (body.get("grant_type") !== "authorization_code" || challenge !== payload.challenge) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: code, token_type: "Bearer", expires_in: 3600, scope: "identify guilds" });
    }
    const payload = parseFixture(request.headers.get("Authorization")?.replace(/^Bearer /i, ""));
    if (url.pathname === "/api/users/@me") return Response.json({ id: payload.id, username: `InviteFixture${payload.id}`, global_name: "Invité de test", discriminator: "0", avatar: null });
    if (url.pathname === "/api/users/@me/guilds") {
      if (payload.guild === "unavailable") return Response.json({ message: "Fixture unavailable" }, { status: 503 });
      if (payload.guild === "malformed") return Response.json({ invalid: true });
      return Response.json(payload.guild === "outsider" ? [] : [{ id: process.env.DISCORD_GUILD_ID }]);
    }
    // Never send synthetic OAuth credentials to an actual external server.
    return Response.json({ error: "Unknown Discord fixture endpoint" }, { status: 503 });
  } catch { return Response.json({ error: "Invalid OAuth fixture" }, { status: 400 }); }
};
