import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: true });

test("generated scripts use the response CSP nonce", async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      (window as typeof window & { __cspViolations?: string[] }).__cspViolations ??= [];
      (window as typeof window & { __cspViolations: string[] }).__cspViolations.push(
        `${event.effectiveDirective}: ${event.blockedURI}`
      );
    });
  });

  page.on("pageerror", (error) => violations.push(error.message));
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];

  expect(response?.status()).toBe(200);
  expect(nonce).toBeTruthy();

  const scriptNonces = await page.locator("script").evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).nonce)
  );
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((scriptNonce) => scriptNonce === nonce)).toBe(true);

  const cspViolations = await page.evaluate(
    () => (window as typeof window & { __cspViolations?: string[] }).__cspViolations ?? []
  );
  expect([...violations, ...cspViolations]).toEqual([]);
});
