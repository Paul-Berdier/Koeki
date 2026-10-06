import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma, type RoleCode } from "@koeki/database";
import { ensureReferential, createTestResource, createTestNinja } from "../lib/test-fixtures";

// playwright.auth.config.ts independently enforces a disposable local database.
type Identity = { id: string; name: string; token: string };
const run = randomUUID().slice(0, 8);
let manager: Identity, first: Identity, second: Identity;
let resourceId: string, resourceName: string, ninjaId: string, ninjaName: string;
const day = "2026-06-10";
let browserErrors: string[] = [];

async function identity(label: string, role: RoleCode): Promise<Identity> {
  const name = `${label} ${run}`;
  const user = await prisma.user.create({ data: { name } });
  const record = await prisma.role.upsert({ where: { code: role }, create: { code: role, label: role }, update: {} });
  await prisma.userRole.create({ data: { userId: user.id, roleId: record.id } });
  const token = randomUUID() + randomUUID();
  await prisma.session.create({ data: { userId: user.id, sessionToken: token, sessionVersion: 1, expires: new Date(Date.now() + 3600_000) } });
  return { id: user.id, name, token };
}
async function login(context: BrowserContext, user: Identity) {
  await context.clearCookies();
  await context.addCookies([{ name: "koeki.session-token", value: user.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax", secure: false }]);
}
async function screenshot(page: Page, label: string, project: string) {
  mkdirSync("../../docs/evidence", { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `../../docs/evidence/shared-register-${label}-${project}.png`, fullPage: true });
}
test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /hydration|cannot be a descendant|cannot contain/i.test(message.text())) browserErrors.push(message.text()); });
});
test.afterEach(() => { expect(browserErrors, "No browser runtime or hydration errors").toEqual([]); });
test.beforeAll(async () => {
  const refs = await ensureReferential();
  manager = await identity("Gestionnaire barème", "KOEKI_MANAGER");
  first = await identity("Collecteur Alpha", "ECONOMIC_AGENT");
  second = await identity("Collecteur Beta", "ECONOMIC_AGENT");
  resourceName = `Cuivre barème ${run}`;
  const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.unite.id, name: resourceName });
  resourceId = resource.id;
  await prisma.resourcePriceHistory.create({ data: { resourceId, pricePerUnit: 100n, effectiveFrom: new Date("2020-01-01"), createdById: manager.id } });
  const ninja = await createTestNinja(refs.grade.id, "Partagé", run);
  ninjaId = ninja.id; ninjaName = `${ninja.firstName} ${ninja.lastName}`;
  await prisma.ninjaProfile.update({ where: { id: ninjaId }, data: { referenceAgentId: second.id } });
  const at = new Date(`${day}T12:00:00Z`);
  for (let index = 0; index < 27; index++) {
    await prisma.taxPayment.create({ data: { receiptNumber: `TAX-ALPHA-${run}-${index}`, ninjaId, recordedById: first.id, amount: 100n, method: "RYO", operationOrigin: "BUSINESS", status: "VALIDATED", validatedAt: at, createdAt: at, balanceBefore: 100n, balanceAfter: 0n, idempotencyKey: randomUUID() } });
  }
  for (const [author, amount, method, origin] of [[second.id, 900n, "RYO", "BUSINESS"], [first.id, 125n, "RYO", "UNKNOWN"], [first.id, 500n, "EXEMPTION", "BUSINESS"]] as const) {
    await prisma.taxPayment.create({ data: { receiptNumber: `TAX-OTHER-${randomUUID()}`, ninjaId, recordedById: author, amount, method, operationOrigin: origin, status: "VALIDATED", validatedAt: at, createdAt: at, balanceBefore: amount, balanceAfter: 0n, idempotencyKey: randomUUID() } });
  }
});

test("a manager changes resource values without changing stock or old prices", async ({ page, context }, info) => {
  await login(context, manager);
  await page.goto(`/resources/valeurs?ressource=${resourceId}`);
  await expect(page.getByRole("heading", { name: "Valeurs & tarifs", exact: true })).toBeVisible();
  const section = page.getByRole("region", { name: `Valeurs de ${resourceName}`, exact: true });
  await section.getByRole("spinbutton", { name: /^Prix de rachat/ }).fill("240");
  await section.getByRole("spinbutton", { name: "Points par unité donnée", exact: true }).fill("7");
  await section.getByRole("spinbutton", { name: "Crédit d’exonération par unité (Ryō)", exact: true }).fill("19");
  await section.getByRole("combobox", { name: "Besoin du village", exact: true }).selectOption("CRITICAL");
  await section.getByRole("textbox", { name: "Motif du changement", exact: true }).fill(`Barème de test navigateur ${run}`);
  await section.getByRole("button", { name: `Enregistrer les valeurs de ${resourceName}`, exact: true }).click();
  await expect(page).toHaveURL(/\/resources\/valeurs\?info=/);
  const updated = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
  expect(updated).toMatchObject({ pointsPerUnit: 7, exemptionPerUnit: 19n, demand: "CRITICAL" });
  expect(updated.currentQuantity.toString()).toBe("0");
  const history = await prisma.resourcePriceHistory.findMany({ where: { resourceId }, orderBy: { effectiveFrom: "asc" } });
  expect(history).toHaveLength(2);
  expect(history[0]?.pricePerUnit).toBe(100n);
  expect(history[1]?.pricePerUnit).toBe(240n);
  await page.goto(`/resources/valeurs?ressource=${resourceId}`);
  await expect(section.getByRole("spinbutton", { name: /^Prix de rachat/ })).toHaveValue("240");
  await screenshot(page, "resource-values", info.project.name);
});

test("the tax journal credits the recorder and keeps totals across receipt pages", async ({ page, context }, info) => {
  await login(context, manager);
  await page.goto(`/equipe/taxes?du=${day}&au=${day}&agent=${first.id}&q=${run}`);
  await expect(page.getByRole("heading", { name: "Taxes par agent", exact: true })).toBeVisible();
  const metric = page.locator(".metric-card").filter({ hasText: "Taxes encaissées par cet agent" }).locator(".metric-value");
  expect((await metric.innerText()).replace(/\D/g, "")).toBe("2700");
  const table = page.getByRole("region", { name: "Taxes recouvrées par agent", exact: true });
  const beta = table.locator("tr").filter({ hasText: second.name });
  expect((await beta.locator("td").first().innerText()).replace(/\D/g, "")).toBe("900");
  const receipts = page.getByRole("region", { name: "Reçus fiscaux de l’agent", exact: true });
  await expect(receipts.locator("tbody tr")).toHaveCount(25);
  const originalIds = await receipts.locator("tbody tr th a").allTextContents();
  await page.locator("#recus").getByRole("link", { name: "Suivant", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(receipts.locator("tbody tr")).toHaveCount(4);
  expect((await metric.innerText()).replace(/\D/g, "")).toBe("2700");
  const nextIds = await receipts.locator("tbody tr th a").allTextContents();
  expect(new Set([...originalIds, ...nextIds]).size).toBe(29);
  await expect(receipts.locator("a").first()).toHaveAttribute("href", `/ninjas/${ninjaId}`);
  await screenshot(page, "tax-receipts", info.project.name);
});

test("an agent sees the shared register but cannot edit scales or read manager tax reports", async ({ page, context }, info) => {
  await login(context, first);
  await page.goto(`/ninjas?mesDossiers=1&q=${run}`);
  await expect(page.getByRole("heading", { name: "Ninjas", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Mes dossiers/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(ninjaName) }).first()).toBeVisible();
  await screenshot(page, "shared-ninjas", info.project.name);
  for (const route of ["/resources/valeurs", "/equipe/taxes"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/access-denied/);
  }
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: ninjaId } })).referenceAgentId).toBe(second.id);
});
