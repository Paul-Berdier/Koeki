import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/auth";

// Real Next/Auth.js/Prisma flow, starting without a session cookie.
// Only Discord's external endpoints are replaced by the local process fixture.
let managerId: string, roleId: string;
const discordId = () => String(100_000_000_000_000_000n + BigInt(`0x${randomBytes(7).toString("hex")}`));
const errors = new WeakMap<Page, string[]>();
function trackBrowserErrors(page: Page) {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /hydration|cannot be a descendant|cannot contain|content security policy/i.test(message.text())) messages.push(message.text()); });
  return messages;
}
test.beforeEach(async ({ page }) => { trackBrowserErrors(page); });
test.afterEach(({ page }) => { expect(errors.get(page) ?? [], "No browser runtime, hydration or CSP errors").toEqual([]); });
test.beforeAll(async () => {
  if (process.env.E2E_EXTERNAL_SERVER === "true") throw new Error("Invitation OAuth tests require the isolated preload fixture server");
  const managerRole = await prisma.role.upsert({ where: { code: "KOEKI_MANAGER" }, create: { code: "KOEKI_MANAGER", label: "Responsable" }, update: {} });
  const role = await prisma.role.upsert({ where: { code: "ECONOMIC_AGENT" }, create: { code: "ECONOMIC_AGENT", label: "Agent" }, update: {} });
  roleId = role.id;
  managerId = (await prisma.user.create({ data: { name: `Invite manager ${randomUUID()}`, roles: { create: { roleId: managerRole.id } } } })).id;
});
test.afterAll(async () => { await prisma.$disconnect(); });
async function invite() {
  const { token, tokenHash } = createInvitationToken(process.env.KOEKI_E2E_INVITE_PEPPER!);
  const row = await prisma.invitation.create({ data: { tokenHash, roleId, createdById: managerId, expiresAt: new Date(Date.now() + 3_600_000) } });
  return { token, row, path: `/invite/${token}` };
}
async function mockDiscord(context: BrowserContext, id: string, options: { guild?: string; loseInvite?: boolean; losePkce?: boolean } = {}) {
  await context.route(/^https:\/\/discord\.com\/(?:api\/)?oauth2\/authorize/, async (route) => {
    const authorization = new URL(route.request().url());
    // A native navigation, not an RSC fetch; no invitation path is leaked to Discord.
    expect(route.request().isNavigationRequest()).toBe(true);
    expect(route.request().headers()["referer"]).toBeUndefined();
    expect(authorization.searchParams.has("_rsc")).toBe(false);
    const callback = authorization.searchParams.get("redirect_uri");
    expect(callback).toBe("http://localhost:3100/api/auth/callback/discord");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    const challenge = authorization.searchParams.get("code_challenge");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (options.loseInvite) await context.clearCookies({ name: "koeki_invite" });
    if (options.losePkce) await context.clearCookies({ name: /pkce/ });
    const encoded = Buffer.from(JSON.stringify({ id, guild: options.guild ?? "member", challenge })).toString("base64url");
    const signature = createHmac("sha256", process.env.KOEKI_E2E_OAUTH_SECRET!).update(encoded).digest("hex");
    const destination = new URL(callback!);
    destination.searchParams.set("code", `koeki-e2e.${encoded}.${signature}`);
    destination.searchParams.set("iss", "https://discord.com");
    const state = authorization.searchParams.get("state");
    if (state) destination.searchParams.set("state", state);
    await route.fulfill({ status: 302, headers: { location: destination.toString() }, body: "" });
  });
}
async function noAccount(id: string) {
  expect(await prisma.account.count({ where: { provider: "discord", providerAccountId: id } })).toBe(0);
}
async function capture(page: Page, name: string, project: string) {
  mkdirSync("../../docs/evidence", { recursive: true });
  await page.screenshot({ path: `../../docs/evidence/invitation-${name}-${project}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("first signup creates a session and consumes once; second visitor cannot reuse; existing account can reconnect", async ({ page, context }, info) => {
  const invitation = await invite();
  const id = discordId();
  await mockDiscord(context, id);
  const response = await page.goto(invitation.path);
  expect(response?.headers()["referrer-policy"]).toBe("strict-origin");
  await expect(page.getByRole("heading", { name: "Rejoindre KŌEKI" })).toBeVisible();
  await expect(page.getByText("Un lien = une personne.", { exact: true })).toBeVisible();
  await capture(page, "ready", info.project.name);
  // A preview and repeated page loads are read-only and cannot burn a valid invitation.
  const preview = await context.request.get(invitation.path, { headers: { "User-Agent": "Discordbot/2.0" } });
  expect(preview.ok()).toBe(true);
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.row.id } })).status).toBe("PENDING");
  expect((await context.cookies()).some((cookie) => cookie.name.includes("session-token"))).toBe(false);
  await page.getByRole("button", { name: "Continuer avec Discord" }).click();
  await expect(page).toHaveURL(/\/profil$/);
  const used = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.row.id } });
  expect(used.status).toBe("USED");
  expect(used.consumedById).not.toBeNull();
  expect(await prisma.userRole.count({ where: { userId: used.consumedById!, roleId } })).toBe(1);
  expect(await prisma.session.count({ where: { userId: used.consumedById! } })).toBe(1);
  expect(await prisma.auditLog.count({ where: { entityId: used.id, action: "INVITATION_CONSUMED" } })).toBe(1);
  expect((await context.cookies()).some((cookie) => cookie.name === "koeki_invite")).toBe(false);

  await context.clearCookies();
  await page.goto(invitation.path);
  await expect(page.getByRole("heading", { name: "Invitation déjà utilisée" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuer avec Discord" })).toHaveCount(0);
  await capture(page, "used", info.project.name);
  await page.goto("/connexion");
  await page.getByRole("button", { name: "Se connecter avec Discord" }).click();
  await expect(page).toHaveURL(/\/profil$/);
  expect(await prisma.auditLog.count({ where: { entityId: used.id, action: "INVITATION_CONSUMED" } })).toBe(1);
});

test("first signup works without JavaScript and without weakening the OAuth checks", async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: "http://localhost:3100", viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const messages = trackBrowserErrors(page);
    const invitation = await invite();
    await mockDiscord(context, discordId());
    await page.goto(invitation.path);
    await expect(page.getByRole("button", { name: "Continuer avec Discord" })).toBeVisible();
    await page.getByRole("button", { name: "Continuer avec Discord" }).click();
    await expect(page).toHaveURL(/\/profil$/);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.row.id } })).status).toBe("USED");
    await capture(page, "no-js-profile", info.project.name);
    expect(messages, "No browser errors without JavaScript").toEqual([]);
  } finally { await context.close(); }
});

test("missing invitation on ordinary login and lost invitation cookie yield actionable refusal without creating a user", async ({ page, context }, info) => {
  const id = discordId();
  await mockDiscord(context, id, { loseInvite: true });
  await page.goto("/connexion");
  await expect(page.getByRole("heading", { name: "Première connexion ?" })).toBeVisible();
  await page.getByRole("button", { name: "Se connecter avec Discord" }).click();
  await expect(page).toHaveURL(/error=InvitationRequired/);
  await expect(page.getByRole("heading", { name: "Lien d’invitation nécessaire" })).toBeVisible();
  await noAccount(id);
  const invitation = await invite();
  await page.goto(invitation.path);
  await page.getByRole("button", { name: "Continuer avec Discord" }).click();
  await expect(page).toHaveURL(/error=InvitationRequired/);
  await noAccount(id);
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.row.id } })).status).toBe("PENDING");
  await capture(page, "missing", info.project.name);
});

test("invalid, expired and revoked links stop before Discord; a stale rendered form is rechecked", async ({ page, context }) => {
  let externalRequests = 0;
  await context.route("https://discord.com/**", async (route) => { externalRequests++; await route.abort(); });
  for (const status of ["EXPIRED", "REVOKED"] as const) {
    const invitation = await invite();
    await prisma.invitation.update({ where: { id: invitation.row.id }, data: status === "EXPIRED" ? { expiresAt: new Date(Date.now() - 1000) } : { status, revokedAt: new Date() } });
    await page.goto(invitation.path);
    await expect(page.getByRole("heading", { name: status === "EXPIRED" ? "Invitation expirée" : "Invitation révoquée" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuer avec Discord" })).toHaveCount(0);
  }
  await page.goto("/invite/incomplete");
  await expect(page.getByRole("heading", { name: "Lien d’invitation invalide" })).toBeVisible();
  const invitation = await invite();
  await page.goto(invitation.path);
  await expect(page.getByRole("button", { name: "Continuer avec Discord" })).toBeVisible();
  await prisma.invitation.update({ where: { id: invitation.row.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  await page.getByRole("button", { name: "Continuer avec Discord" }).click();
  await expect(page).toHaveURL(/error=InvitationRevoked/);
  expect(externalRequests).toBe(0);
  expect((await context.cookies()).some((cookie) => cookie.name === "koeki_invite")).toBe(false);
});

for (const [guild, error] of [["outsider", "DiscordMembershipRequired"], ["unavailable", "DiscordUnavailable"], ["malformed", "DiscordUnavailable"]] as const) {
  test(`Discord ${guild} is refused without consuming the invitation`, async ({ page, context }) => {
    const invitation = await invite();
    const id = discordId();
    await mockDiscord(context, id, { guild });
    await page.goto(invitation.path);
    await page.getByRole("button", { name: "Continuer avec Discord" }).click();
    await expect(page).toHaveURL(new RegExp(`error=${error}`));
    await noAccount(id);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.row.id } })).status).toBe("PENDING");
  });
}

test("missing PKCE cookie is still rejected before a role or session can be granted", async ({ page, context }) => {
  const invitation = await invite();
  const id = discordId();
  await mockDiscord(context, id, { losePkce: true });
  await page.goto(invitation.path);
  await page.getByRole("button", { name: "Continuer avec Discord" }).click();
  await expect(page).toHaveURL(/\/access-denied\?error=/);
  await noAccount(id);
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.row.id } })).status).toBe("PENDING");
  expect((await context.cookies()).some((cookie) => cookie.name.includes("session-token"))).toBe(false);
});
