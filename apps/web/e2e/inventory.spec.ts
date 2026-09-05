import { expect, test } from "@playwright/test";

const noHorizontalOverflow = async (page: import("@playwright/test").Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

test("the inventory register lists every resource with stock, state and actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop assertion");
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventaire", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".board-table tbody tr")).toHaveCount(14);
  await expect(page.locator(".board-table").getByText("Non inventorié", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".board-table").getByText("Critique", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".board-table").getByText("Rupture", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".board-table tbody th").filter({ hasText: "Fer" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sortie de stock pour Fer" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/inventory-${testInfo.project.name}.png`, fullPage: true });
});

test("an agent finds Fer by alias, opens the exit drawer and sees the new stock before confirming", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "interactive", "Needs JavaScript");
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventaire", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("searchbox", { name: "Rechercher une ressource" }).fill("iron");
  await expect(page.locator(".board-table tbody tr")).toHaveCount(1);
  await expect(page.getByText("1 ressource affichée (filtre actif)")).toBeVisible();
  await page.getByRole("button", { name: "Sortie de stock pour Fer" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Sortie de stock" })).toBeVisible();
  await drawer.getByRole("textbox", { name: /Quantité/ }).fill("25");
  await expect(drawer.getByText("Nouveau stock")).toBeVisible();
  await expect(drawer.locator(".movement-preview")).toContainText("470 kg");
  await drawer.getByPlaceholder("Nom ou code NIN-…").fill("Aoki Hoki · NIN-000041");
  await drawer.locator("select[name=reason]").selectOption("Fabrication");
  await expect(drawer.getByRole("button", { name: "Retirer 25 kg" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  // Filters: only critical stocks.
  await page.getByRole("searchbox", { name: "Rechercher une ressource" }).fill("");
  await page.getByLabel("Filtre").selectOption("critical");
  await expect(page.locator(".board-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".board-table tbody th").first()).toContainText("Plan T3");
  await page.screenshot({ path: "test-results/inventory-drawer.png", fullPage: true });
});

test("the register becomes a compact card list on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only assertion");
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventaire", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".board-table thead")).toBeHidden();
  await expect(page.locator(".board-table tbody tr")).toHaveCount(14);
  await expect(page.getByRole("button", { name: "Ouvrir la navigation" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/inventory-mobile.png", fullPage: true });
});

test("the movement journal explains each line: quantity, before/after, who, agent, reason", async ({ page }, testInfo) => {
  await page.goto("/inventory/movements");
  await expect(page.getByRole("heading", { name: "Journal des mouvements" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".journal-table tbody tr")).toHaveCount(5);
  const first = page.locator(".journal-table tbody tr").first();
  await expect(first).toContainText("−25 kg");
  await expect(first).toContainText("520 → 495");
  await expect(first).toContainText("Pris par");
  await expect(first).toContainText("Aoki Hoki");
  await expect(first).toContainText("Yuki Sabaku");
  await expect(first).toContainText("Fabrication");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/inventory-journal-${testInfo.project.name}.png`, fullPage: true });
});

test("a resource page shows its stock, thresholds and full history", async ({ page }, testInfo) => {
  await page.goto("/inventory/res-iron");
  await expect(page.getByRole("heading", { name: "Fer", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("495 kg").first()).toBeVisible();
  await expect(page.locator(".journal-table tbody tr")).toHaveCount(4);
  await expect(page.getByText("Inventaire initial").first()).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/inventory-resource-${testInfo.project.name}.png`, fullPage: true });
});

test("a count review lists the detected differences before anything moves", async ({ page }, testInfo) => {
  await page.goto("/inventory/counts/st-1");
  await expect(page.getByRole("heading", { name: "Comptage", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table tbody tr")).toHaveCount(4);
  await expect(page.locator("table tbody tr").first()).toContainText("−10");
  await noHorizontalOverflow(page);
  await page.goto("/inventory/counts");
  await expect(page.getByRole("heading", { name: "Comptages" })).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  await page.screenshot({ path: `test-results/inventory-counts-${testInfo.project.name}.png`, fullPage: true });
});
