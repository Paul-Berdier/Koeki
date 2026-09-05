import { expect, test } from "@playwright/test";

test("typing in the ninja search filters instantly without a server round trip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "interactive", "Needs JavaScript");
  await page.goto("/ninjas");
  await expect(page.getByRole("heading", { name: "Ninjas" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".ninja-table tbody tr")).toHaveCount(8);
  const navigations: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/ninjas?")) navigations.push(request.url()); });
  const search = page.getByRole("searchbox", { name: "Rechercher un ninja" });
  await search.click();
  await search.pressSequentially("hoki", { delay: 350 });
  await expect(page.locator(".ninja-table tbody tr")).toHaveCount(7);
  await expect(page.getByText(/7 ninjas affichés/)).toBeVisible();
  await search.fill("cigale");
  await expect(page.locator(".ninja-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".ninja-table tbody tr").first()).toContainText("Aoki Hoki");
  await page.waitForTimeout(600);
  expect(navigations).toEqual([]);
  expect(page.url()).toContain("q=cigale");
  await search.fill("");
  await expect(page.locator(".ninja-table tbody tr")).toHaveCount(8);
});
