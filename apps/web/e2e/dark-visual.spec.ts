import { expect, test } from "@playwright/test";

test("signed-out pages use the dark theme and distinguish OAuth failures", async ({ page }, testInfo) => {
  await page.goto("/access-denied?error=Configuration");
  await expect(page.getByRole("heading", { name: "Connexion indisponible" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 23, 20)");
  await expect(page.getByRole("link", { name: "Revenir à la connexion" })).toHaveAttribute("href", "/connexion");
  await page.screenshot({ path: `test-results/dark-auth-error-${testInfo.project.name}.png`, fullPage: true });

  await page.goto("/access-denied?error=AccessDenied");
  await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
  await page.getByRole("link", { name: "Revenir à la connexion" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.locator(".invite-card")).toHaveCSS("background-color", "rgb(24, 34, 29)");
  await page.screenshot({ path: `test-results/dark-connexion-${testInfo.project.name}.png`, fullPage: true });
});

test("the private workspace has dark surfaces without horizontal overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mon bureau" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".workspace-header")).toHaveCSS("background-color", "rgb(24, 34, 29)");
  await expect(page.locator(".panel").first()).toHaveCSS("background-color", "rgb(24, 34, 29)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/dark-bureau-${testInfo.project.name}.png`, fullPage: true });

  await page.goto("/reports");
  await expect(page.locator(".report-card").first()).toHaveCSS("background-color", "rgb(24, 34, 29)");
  await page.screenshot({ path: `test-results/dark-reports-${testInfo.project.name}.png`, fullPage: true });
});
