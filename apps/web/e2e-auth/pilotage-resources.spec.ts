import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "@koeki/database";

let managerId: string, agentId: string, receipt: string, metalName: string;
const period = "du=2026-10-19&au=2026-10-25";

async function login(context: BrowserContext, userId: string) {
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId, expires: new Date(Date.now() + 3_600_000) } });
  await context.clearCookies();
  await context.addCookies([{ name: "koeki.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

test.beforeAll(async () => {
  const key = randomUUID();
  const grade = await prisma.ninjaGrade.upsert({ where: { code: "GENIN" }, create: { code: "GENIN", label: "Genin", sortOrder: 2 }, update: {} });
  const managerRole = await prisma.role.upsert({ where: { code: "KOEKI_MANAGER" }, create: { code: "KOEKI_MANAGER", label: "Responsable" }, update: {} });
  const agentRole = await prisma.role.upsert({ where: { code: "ECONOMIC_AGENT" }, create: { code: "ECONOMIC_AGENT", label: "Agent" }, update: {} });
  managerId = (await prisma.user.create({ data: { name: `Manager ${key}`, roles: { create: { roleId: managerRole.id } }, ninjaProfile: { create: { code: `M-${key}`, firstName: "Responsable", lastName: "Pilotage", currentGradeId: grade.id } } } })).id;
  agentId = (await prisma.user.create({ data: { name: `Agent ${key}`, roles: { create: { roleId: agentRole.id } }, ninjaProfile: { create: { code: `A-${key}`, firstName: "Agent", lastName: "Pilotage", currentGradeId: grade.id } }, participations: { create: { startsAt: new Date("2026-10-01T00:00:00Z"), dateSource: "DECLARED", rankingEligible: true } } } })).id;
  const ninja = await prisma.ninjaProfile.create({ data: { code: `N-${key}`, firstName: "Donateur", lastName: "Pilotage", currentGradeId: grade.id } });
  const category = await prisma.resourceCategory.create({ data: { code: key, label: "Fixture pilotage" } });
  const unit = await prisma.resourceUnit.create({ data: { code: key, label: "unité", decimals: 0 } });
  metalName = `Métal de chakra ${key.slice(0, 8)}`;
  const metal = await prisma.resource.create({ data: { code: `METAL-${key}`, name: metalName, categoryId: category.id, unitId: unit.id, minimumStock: 0, criticalStock: 0, exemptionPerUnit: 99999n } });
  const wood = await prisma.resource.create({ data: { code: `BOIS-${key}`, name: `Bois ${key.slice(0, 8)}`, categoryId: category.id, unitId: unit.id, minimumStock: 0, criticalStock: 0 } });
  receipt = `DON-PILOTAGE-${key}`;
  const transaction = await prisma.resourceTransaction.create({ data: {
    receiptNumber: receipt, ninjaId: ninja.id, agentId, recordedById: agentId, type: "DONATION", status: "VALIDATED", totalAmount: 246n,
    operationOrigin: "BUSINESS", validatedAt: new Date("2026-10-20T12:00:00Z"), idempotencyKey: randomUUID(),
    items: { create: [{ resourceId: metal.id, quantity: 2, unitPriceSnapshot: 123n, lineTotal: 246n }, { resourceId: wood.id, quantity: 5, unitPriceSnapshot: 0n, lineTotal: 0n }] },
  } });
  await prisma.inventoryMovement.create({ data: { resourceId: metal.id, transactionId: transaction.id, agentId, type: "DONATION_IN", quantity: 2, quantityBefore: 0, quantityAfter: 2, reason: "Fixture pilotage", idempotencyKey: randomUUID(), occurredAt: new Date("2026-10-20T12:00:00Z") } });
});
test.afterAll(async () => { await prisma.$disconnect(); });

test("manager sees exact donated objects and their saved equivalent in the pilotage and agent journal", async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(context, managerId);
  await page.goto(`/equipe?${period}&vue=ressources&q=${encodeURIComponent(receipt)}`);
  await expect(page.getByRole("heading", { name: "Dons et rachats — objets enregistrés" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: receipt });
  await expect(row).toHaveCount(1);
  await expect(row.getByText(`2 × ${metalName}`, { exact: true })).toBeVisible();
  await expect(row.getByText(/5 × Bois/)).toBeVisible();
  await expect(row.getByText("Équivalent du don", { exact: true })).toBeVisible();
  await expect(row.getByText("Valorisation, pas un encaissement en Ryō.", { exact: true })).toBeVisible();
  await row.getByText("Valeurs enregistrées par objet", { exact: true }).click();
  await expect(row).toContainText("123");
  await expect(row).not.toContainText("99 999");
  await row.getByText(/Mouvements de stock liés/).click();
  await expect(row.getByText(`Entrée : 2 × ${metalName}`, { exact: true })).toBeVisible();
  await page.getByLabel("Objet, code, reçu ou ninja").fill(metalName);
  await page.getByRole("button", { name: "Filtrer les objets" }).click();
  await expect(page.getByRole("row").filter({ hasText: receipt }).getByText(/5 × Bois/)).toBeVisible();
  mkdirSync("../../docs/evidence", { recursive: true });
  await page.screenshot({ path: `../../docs/evidence/pilotage-resources-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.goto(`/equipe/${agentId}?${period}&vue=activite`);
  const agentRow = page.getByRole("row").filter({ hasText: receipt });
  await expect(agentRow.getByText(`2 × ${metalName}`, { exact: true })).toBeVisible();
  await expect(agentRow.getByText(/5 × Bois/)).toBeVisible();
  await expect(agentRow).toContainText("Donateur Pilotage");
  await expect(agentRow).toContainText("Équivalent du don");
  expect(errors).toEqual([]);
});

test("ordinary agents cannot open the management resource journal", async ({ page, context }) => {
  await login(context, agentId);
  await page.goto(`/equipe?${period}&vue=ressources&q=${encodeURIComponent(receipt)}`);
  await expect(page).toHaveURL(/\/access-denied/);
  await expect(page.getByText(receipt, { exact: false })).toHaveCount(0);
});
