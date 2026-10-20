import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { prisma } from "@koeki/database";

let ninjaId: string;
let token: string;
const errors: string[] = [];

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const grade = await prisma.ninjaGrade.upsert({ where: { code: "JONIN" }, create: { code: "JONIN", label: "Jōnin", sortOrder: 70 }, update: {} });
  const role = await prisma.role.upsert({ where: { code: "KOEKI_MANAGER" }, create: { code: "KOEKI_MANAGER", label: "Responsable" }, update: {} });
  const user = await prisma.user.create({ data: { name: `Dossier regression ${suffix}`, roles: { create: { roleId: role.id } } } });
  const ninja = await prisma.ninjaProfile.create({ data: { code: `DOSSIER-E2E-${suffix}`, firstName: "Dossier", lastName: suffix, currentGradeId: grade.id, userId: user.id } });
  ninjaId = ninja.id;
  token = randomUUID() + randomUUID();
  await prisma.session.create({ data: { userId: user.id, sessionToken: token, sessionVersion: 1, expires: new Date(Date.now() + 3600_000) } });
});
test.afterAll(async () => { await prisma.$disconnect(); });
test.beforeEach(async ({ context, page }) => {
  errors.length = 0;
  await context.addCookies([{ name: "__Secure-koeki.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  await page.addInitScript(() => {
    const state = window as typeof window & { __cspViolations?: string[] };
    state.__cspViolations = [];
    window.addEventListener("securitypolicyviolation", event => state.__cspViolations!.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
});
test.afterEach(async ({ page }, info) => {
  console.log("dossier-browser-errors", JSON.stringify(errors));
  await info.attach("dossier-browser", { body: JSON.stringify({ errors, url: page.url() }), contentType: "application/json" });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __cspViolations?: string[] }).__cspViolations ?? [])).toEqual([]);
});

test("editing a visited dossier twice shows fresh data and completes the redirect", async ({ page }) => {
  await page.goto(`/ninjas/${ninjaId}`);
  await expect(page.locator("h1")).toContainText("Dossier");
  for (const alias of ["Premier alias", "Deuxième alias"]) {
    const link = page.locator(`a[href="/ninjas/${ninjaId}/modifier"]`).first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await link.click();
    await expect(page.getByRole("heading", { name: "Modifier le dossier", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Pseudonyme", exact: true }).fill(alias);
    const versionBefore = (await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninjaId } })).version;
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(async () => (await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninjaId } })).alias).toBe(alias);
    await expect(page).toHaveURL(new RegExp(`/ninjas/${ninjaId}$`));
    await expect(page.locator("h1")).toContainText("Dossier");
    await expect(page.locator("main")).toContainText(alias);
    expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninjaId } })).version).toBe(versionBefore + 1);
  }
});

test("invalid dossier submission returns an error and a corrected submission can succeed", async ({ page }) => {
  const before = await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninjaId } });
  await page.goto(`/ninjas/${ninjaId}/modifier`);
  await page.locator('select[name="status"]').selectOption("DECEASED");
  await page.locator('input[name="diedAt"]').fill("2099-01-01");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/ninjas/${ninjaId}/modifier$`));
  await expect(page.locator("main").getByRole("alert")).toContainText("futur");
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninjaId } })).version).toBe(before.version);
  await expect(page.getByRole("button", { name: "Enregistrer", exact: true })).toBeEnabled();
  await page.locator('select[name="status"]').selectOption("ACTIVE");
  await page.getByRole("textbox", { name: "Pseudonyme", exact: true }).fill("Après correction");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/ninjas/${ninjaId}$`));
  await expect(page.locator("main")).toContainText("Après correction");
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninjaId } })).version).toBe(before.version + 1);
});
