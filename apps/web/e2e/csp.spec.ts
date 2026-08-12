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

test("equipment filters find the right ninja quickly", async ({ page }) => {
  await page.goto("/equipement");
  await expect(page.locator(".equipment-row")).toHaveCount(6);

  await page.getByRole("button", { name: /Sans équipement/ }).click();
  await expect(page.locator(".equipment-row")).toHaveCount(1);
  await expect(page.getByText("Aoki Hoki", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Tous/ }).click();
  await page.getByPlaceholder("Rechercher un ninja…").fill("Toshiro");
  await expect(page.locator(".equipment-row")).toHaveCount(1);
  await expect(page.getByText("Toshiro Makaze", { exact: true })).toBeVisible();
});

test("reports launch and replay the fireworks spectacle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Rapports", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.locator(".report-spectacle")).toBeVisible();
  await expect(page.locator(".report-spectacle-copy").getByText("*keur* si c'est pas ce que tu veux alors j'ai R compris", { exact: true })).toBeVisible();
  await expect(page.locator(".report-firework")).toHaveCount(11);

  const firstRound = Number(await page.locator(".report-spectacle").getAttribute("data-round"));
  await page.getByRole("link", { name: "Rapports", exact: true }).click();
  await expect(page.locator(".report-spectacle")).toHaveAttribute("data-round", String(firstRound + 1));
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: "test-results/reports-fireworks-replay.png" });
});
