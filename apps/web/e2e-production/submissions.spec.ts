import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { prisma } from "@koeki/database";

let ninjaId: string;
let token: string;
const browserErrors: string[] = [];

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const grade = await prisma.ninjaGrade.upsert({ where: { code: "JONIN" }, create: { code: "JONIN", label: "Jōnin", sortOrder: 70 }, update: {} });
  const role = await prisma.role.upsert({ where: { code: "KOEKI_MANAGER" }, create: { code: "KOEKI_MANAGER", label: "Responsable" }, update: {} });
  const user = await prisma.user.create({ data: { name: `Production regression ${suffix}`, roles: { create: { roleId: role.id } } } });
  const ninja = await prisma.ninjaProfile.create({ data: { code: `PROD-E2E-${suffix}`, firstName: "Navigation", lastName: suffix, currentGradeId: grade.id, userId: user.id } });
  ninjaId = ninja.id;
  token = randomUUID() + randomUUID();
  await prisma.session.create({ data: { userId: user.id, sessionToken: token, sessionVersion: 1, expires: new Date(Date.now() + 3600_000) } });
});
test.afterAll(async () => { await prisma.$disconnect(); });

test.beforeEach(async ({ context, page }) => {
  browserErrors.length = 0;
  // Chromium treats localhost as trustworthy; exercise the actual production
  // cookie name and secure flag, without weakening application authentication.
  await context.addCookies([{ name: "__Secure-koeki.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  await page.addInitScript(() => {
    const state = window as typeof window & { __cspViolations?: string[] };
    state.__cspViolations = [];
    window.addEventListener("securitypolicyviolation", event => state.__cspViolations!.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", response => {
    if (response.request().method() === "POST") console.log("mutation-response", JSON.stringify({ status: response.status(), type: response.headers()["content-type"], redirect: response.headers()["x-action-redirect"] }));
  });
});
test.afterEach(async ({ page }, info) => {
  const violations = await page.evaluate(() => (window as typeof window & { __cspViolations?: string[] }).__cspViolations ?? []).catch(() => ["page unavailable"]);
  console.log("browser-diagnostics", JSON.stringify({ errors: browserErrors, csp: violations }));
  await info.attach("browser-diagnostics", { body: JSON.stringify({ errors: browserErrors, csp: violations }), contentType: "application/json" });
  expect(browserErrors, "No client errors or blocked scripts").toEqual([]);
  expect(violations, "Strict CSP remains valid across navigation and submission").toEqual([]);
});

test("saving equipment twice resolves the action and leaves navigation interactive", async ({ page }) => {
  const response = await page.goto("/equipement");
  expect(response?.headers()["content-security-policy"]).toContain("'strict-dynamic'");
  await expect(page.getByRole("heading", { name: "Équipement des Jōnin", exact: true })).toBeVisible();
  let row = page.locator("article.equipment-row").filter({ has: page.locator(`a[href="/ninjas/${ninjaId}"]`) });
  await row.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(row.locator(".equipment-editor")).toBeVisible();
  for (const tier of ["T1", "T2"]) {
    const editor = row.locator(".equipment-editor");
    if (!await editor.isVisible()) await row.getByRole("button", { name: "Modifier", exact: true }).click();
    await editor.locator('select[name="slot_haut_tier"]').selectOption(tier);
    await editor.locator('select[name="slot_haut_type"]').selectOption("Armure");
    const auditsBefore = await prisma.auditLog.count({ where: { entityType: "NinjaEquipment", entityId: ninjaId } });
    await editor.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(async () => {
      const record = await prisma.ninjaEquipment.findUnique({ where: { ninjaId } });
      return (record?.slots as Record<string, { tier?: string }> | undefined)?.haut?.tier;
    }, { message: "The real server action committed once to the isolated test database" }).toBe(tier);
    await expect(page.getByRole("status").filter({ hasText: "enregistrée" })).toBeVisible();
    await expect(row.locator(".equipment-editor")).toHaveCount(0);
    row = page.locator("article.equipment-row").filter({ has: page.locator(`a[href="/ninjas/${ninjaId}"]`) });
    await expect(row.locator(".equipment-slots .equipment-slot").first()).toContainText(tier);
    expect(await prisma.auditLog.count({ where: { entityType: "NinjaEquipment", entityId: ninjaId } })).toBe(auditsBefore + 1);
  }
  await row.locator(`a[href="/ninjas/${ninjaId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/ninjas/${ninjaId}$`));
  await expect(page.locator("h1")).toContainText("Navigation");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Équipement des Jōnin", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Rechercher un ninja", exact: true }).fill("no-such-person");
  await expect(page.getByText("Aucun ninja trouvé", { exact: true })).toBeVisible();
});

test("a rejected equipment save leaves the editor usable for a corrected retry", async ({ page }) => {
  await page.goto("/equipement");
  const row = page.locator("article.equipment-row").filter({ has: page.locator(`a[href="/ninjas/${ninjaId}"]`) });
  await row.getByRole("button", { name: "Modifier", exact: true }).click();
  const editor = row.locator(".equipment-editor");
  await editor.locator('select[name="slot_haut_tier"]').selectOption("T3");
  await editor.locator('select[name="slot_haut_type"]').selectOption("Armure");
  const previous = await prisma.ninjaEquipment.findUnique({ where: { ninjaId } });
  const auditsBefore = await prisma.auditLog.count({ where: { entityType: "NinjaEquipment", entityId: ninjaId } });
  // Simulate a concurrent administrative change after the editor was opened.
  await prisma.ninjaProfile.update({ where: { id: ninjaId }, data: { status: "INACTIVE" } });
  try {
    await editor.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("inactif");
    await expect(editor.getByRole("button", { name: "Enregistrer", exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/\/equipement$/);
    expect((await prisma.ninjaEquipment.findUnique({ where: { ninjaId } }))?.slots).toEqual(previous?.slots);
    expect(await prisma.auditLog.count({ where: { entityType: "NinjaEquipment", entityId: ninjaId } })).toBe(auditsBefore);
  } finally {
    await prisma.ninjaProfile.update({ where: { id: ninjaId }, data: { status: "ACTIVE" } });
  }
  await editor.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "enregistrée" })).toBeVisible();
  await expect(row.locator(".equipment-editor")).toHaveCount(0);
  await expect(row.locator(".equipment-slots .equipment-slot").first()).toContainText("T3");
  expect(await prisma.auditLog.count({ where: { entityType: "NinjaEquipment", entityId: ninjaId } })).toBe(auditsBefore + 1);
});
