import { test, expect } from "@playwright/test";

/** This guard runs before OAuth or database side effects, even for hand-written requests. */
test("native OAuth initiation rejects cross-origin requests and GET without setting credentials", async ({ request }) => {
  const endpoint = "/api/connexion/discord";
  const get = await request.get(endpoint);
  expect(get.status()).toBe(405);
  for (const origin of [undefined, "null", "https://attacker.invalid", "http://localhost:3100.attacker.invalid"]) {
    const response = await request.post(endpoint, { form: { intent: "connexion" }, ...(origin ? { headers: { Origin: origin } } : {}), maxRedirects: 0 });
    expect(response.status()).toBe(403);
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(response.headers()["location"]).toBeUndefined();
  }
  const oversized = await request.post(endpoint, { headers: { Origin: "http://localhost:3100" }, form: { intent: "invitation", token: "x".repeat(3000) }, maxRedirects: 0 });
  expect(oversized.status()).toBe(400);
  expect(oversized.headers()["set-cookie"]).toBeUndefined();
});
