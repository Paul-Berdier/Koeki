import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@koeki/database";

let gradeId: string;
let managerRoleId: string;
let agentRoleId: string;

test.beforeAll(async () => {
  const grade = await prisma.ninjaGrade.upsert({
    where: { code: "MANAGER_ONBOARDING_E2E" },
    create: { code: "MANAGER_ONBOARDING_E2E", label: "Grade arrivée responsable", sortOrder: 994 },
    update: {},
  });
  gradeId = grade.id;
  const role = async (code: "KOEKI_MANAGER" | "ECONOMIC_AGENT") => (await prisma.role.upsert({
    where: { code }, create: { code, label: code }, update: {},
  })).id;
  managerRoleId = await role("KOEKI_MANAGER");
  agentRoleId = await role("ECONOMIC_AGENT");
});

test.afterAll(async () => { await prisma.$disconnect(); });

async function managerWithoutProfile(context: BrowserContext) {
  const discordId = String(100_000_000_000_000_000n + BigInt(`0x${randomBytes(7).toString("hex")}`));
  const user = await prisma.user.create({ data: {
    name: `Responsable Discord ${randomUUID()}`, discordId,
    roles: { create: [{ roleId: managerRoleId }, { roleId: agentRoleId }] },
    accounts: { create: { type: "oauth", provider: "discord", providerAccountId: discordId } },
  } });
  const token = randomUUID();
  await prisma.session.create({ data: {
    userId: user.id, sessionToken: token, sessionVersion: user.sessionVersion,
    expires: new Date(Date.now() + 3_600_000),
  } });
  await context.addCookies([{ name: "koeki.session-token", value: token, url: "http://localhost:3100", httpOnly: true, sameSite: "Lax" }]);
  return user;
}

async function freeProfile() {
  const sequence = await prisma.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('"NinjaProfile_code_seq"') AS value`;
  return prisma.ninjaProfile.create({ data: {
    code: `NIN-${String(sequence[0]!.value).padStart(6, "0")}`,
    firstName: "Responsable", lastName: `Arrivée ${randomUUID()}`, currentGradeId: gradeId,
  } });
}

async function navigation(page: Page) {
  const toggle = page.getByRole("button", { name: "Ouvrir la navigation" });
  if (await toggle.isVisible()) {
    await toggle.click();
    return page.getByRole("navigation", { name: "Navigation mobile", exact: true });
  }
  return page.getByRole("navigation", { name: "Navigation principale", exact: true });
}

async function verifyAccessAfterLink(page: Page, fullName: string, userId: string) {
  const menu = await navigation(page);
  await expect(page.locator(".sidebar-identity:visible")).toContainText(fullName);
  await expect(page.locator(".sidebar-identity:visible")).toContainText("Responsable Kōeki");
  await expect(page.locator(".sidebar-identity:visible")).not.toContainText("Compte à relier");
  await menu.getByRole("link", { name: "Opérations", exact: true }).click();
  await expect(page).toHaveURL(/\/operations$/);
  await expect(page.getByRole("heading", { name: "Opérations", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Enregistrer un paiement/ })).toBeVisible();
  const nextMenu = await navigation(page);
  await nextMenu.getByRole("link", { name: "Dossiers ninjas", exact: true }).click();
  await expect(page).toHaveURL(/\/ninjas$/);
  await expect(page.getByRole("heading", { name: "Ninjas", exact: true })).toBeVisible();
  const roles = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
  expect(roles.map(({ role }) => role.code).sort()).toEqual(["ECONOMIC_AGENT", "KOEKI_MANAGER"]);
}

test("an unlinked manager sees why access is blocked, claims the exact profile and opens operations through the menu", async ({ page, context }) => {
  const user = await managerWithoutProfile(context);
  const target = await freeProfile();
  await page.goto("/operations");
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByRole("heading", { name: "Liez votre fiche ninja" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Vos rôles et vos droits sont conservés.");
  await expect(page.getByRole("status")).toContainText("Les opérations et les autres rubriques autorisées pour votre compte seront accessibles dès que votre fiche ninja sera liée.");
  const form = page.getByRole("form", { name: "Confirmer ma fiche ninja" });
  await form.getByRole("combobox").selectOption({ label: `${target.firstName} ${target.lastName} · ${target.code}` });
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Confirmer et lier ma fiche" }).click();
  await expect(page).toHaveURL(new RegExp(`/ninjas/${target.id}$`));
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: target.id } })).userId).toBe(user.id);
  expect(await prisma.auditLog.count({ where: { action: "NINJA_CLAIMED", entityId: target.id, actorId: user.id } })).toBe(1);
  await verifyAccessAfterLink(page, `${target.firstName} ${target.lastName}`, user.id);
});

test("a manager creating a new profile immediately gets the updated identity and working menu", async ({ page, context }) => {
  const user = await managerWithoutProfile(context);
  // Keep a free record available so this exercises the explicit new-character confirmation.
  await freeProfile();
  const firstName = "NouvelleFiche";
  const lastName = `Responsable ${randomUUID()}`;
  await page.goto("/operations");
  await expect(page).toHaveURL(/\/profil$/);
  await page.getByText("Mon personnage n’apparaît pas dans la liste — créer une nouvelle fiche", { exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Créer ma fiche" }) });
  await form.getByRole("checkbox", { name: /J’ai cherché dans la liste/ }).check();
  await form.getByRole("textbox", { name: "Prénom *", exact: true }).fill(firstName);
  await form.getByRole("textbox", { name: "Nom *", exact: true }).fill(lastName);
  await form.getByRole("combobox", { name: "Grade *", exact: true }).selectOption(gradeId);
  await form.getByRole("button", { name: "Créer ma fiche" }).click();
  await expect(page).toHaveURL(/\/ninjas\/[^/]+$/);
  const profile = await prisma.ninjaProfile.findUniqueOrThrow({ where: { userId: user.id } });
  expect(profile.firstName).toBe(firstName);
  expect(profile.lastName).toBe(lastName);
  expect(await prisma.auditLog.count({ where: { action: "NINJA_SELF_REGISTERED", entityId: profile.id, actorId: user.id } })).toBe(1);
  await verifyAccessAfterLink(page, `${firstName} ${lastName}`, user.id);
});
