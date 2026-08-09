import { expect, test } from "@playwright/test";

test("dashboard remains readable at desktop size", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only assertion");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Salle des comptes" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Taux de majoration absent")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/dashboard-desktop.png", fullPage: true });
});

test("ninjas use cards and a drawer menu on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only responsive assertion");
  await page.goto("/ninjas");
  await expect(page.getByRole("heading", { name: "Ninjas" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Ouvrir la navigation" })).toBeVisible();
  await expect(page.locator(".ninja-card")).toHaveCount(7);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/ninjas-mobile.png", fullPage: true });
});

test("equipment board stays readable without horizontal scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only assertion");
  await page.goto("/equipement");
  await expect(page.getByRole("heading", { name: "Équipement des Jōnin" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".equipment-row")).toHaveCount(6);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/equipment-desktop.png", fullPage: true });
});

test("equipment board becomes a compact card list on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only assertion");
  await page.goto("/equipement");
  await expect(page.getByRole("heading", { name: "Équipement des Jōnin" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".equipment-slot").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/equipment-mobile.png", fullPage: true });
});
