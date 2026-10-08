import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/auth";

// Real Next/Auth.js/Prisma flow, starting without a session cookie.
// Only Discord's browser consent and external endpoints are simulated.
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

type PausedRequest = {
  requestId: string;
  resourceType: string;
  request: { url: string; method: string; headers: Record<string, string> };
};

async function mockDiscord(context: BrowserContext, id: string, options: { guild?: string; loseInvite?: boolean; losePkce?: boolean; rejectAuthorization?: boolean } = {}) {
  // Playwright route handlers only see the first URL in a redirected request.
  // The first URL is now our real native POST, not Discord. Intercept the
  // external hop with Chromium Fetch instead, keeping the original HTTP 303,
  // browser cookies, CSP, and subsequent Auth.js callback entirely unchanged.
  // All projects in playwright.auth.config.ts explicitly use Chromium.
  expect(context.browser()?.browserType().name()).toBe("chromium");
  const pages = context.pages();
  expect(pages).toHaveLength(1);
  const page = pages[0]!;
  const messages = errors.get(page) ?? trackBrowserErrors(page);
  const session = await context.newCDPSession(page);
  const observed = { authorizations: 0 };
  async function intercept(event: PausedRequest) {
    const authorization = new URL(event.request.url);
    expect(authorization.origin, "Never contact a real Discord endpoint in this fixture").toBe("https://discord.com");
    expect(["/api/oauth2/authorize", "/oauth2/authorize"]).toContain(authorization.pathname);
    observed.authorizations++;
    expect(options.rejectAuthorization ?? false, "This invalid invitation must not start OAuth").toBe(false);
    expect(event.resourceType, "OAuth must use document navigation, not an RSC fetch").toBe("Document");
    expect(event.request.method).toBe("GET");
    const headers = Object.fromEntries(Object.entries(event.request.headers).map(([key, value]) => [key.toLowerCase(), value]));
    expect(headers.referer, "The invitation URL must not leak to Discord").toBeUndefined();
    expect(authorization.searchParams.has("_rsc")).toBe(false);
    expect(authorization.searchParams.get("client_id")).toBe("999999999999999998");
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
    await session.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: 302,
      responseHeaders: [
        { name: "Location", value: destination.toString() },
        { name: "Cache-Control", value: "no-store" },
        { name: "Referrer-Policy", value: "no-referrer" },
      ],
      body: "",
    });
  }
  session.on("Fetch.requestPaused", (event: PausedRequest) => {
    // An asynchronous CDP listener must report failures to the test explicitly.
    // Abort instead of continuing on failure: no fallback to the real service.
    void intercept(event).catch(async (error: unknown) => {
      messages.push(`Discord fixture: ${error instanceof Error ? error.message : String(error)}`);
      await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }).catch(() => {});
    });
  });
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*://discord.com/*", requestStage: "Request" }] });
  return observed;
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
  const observed = await mockDiscord(context, id);
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
  const startResponse = page.waitForResponse((entry) => new URL(entry.url()).pathname === "/api/connexion/discord" && entry.request().method() === "POST");
  await page.getByRole("button", { name: "Continuer avec Discord" }).click();
  expect((await startResponse).status(), "The real server must issue a native 303").toBe(303);
  await expect(page).toHaveURL(/\/profil$/);
  expect(observed.authorizations).toBe(1);
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
  expect(observed.authorizations).toBe(1);
  await capture(page, "used", info.project.name);
  await page.goto("/connexion");
  await page.getByRole("button", { name: "Se connecter avec Discord" }).click();
  await expect(page).toHaveURL(/\/profil$/);
  expect(observed.authorizations).toBe(2);
  expect(await prisma.auditLog.count({ where: { entityId: used.id, action: "INVITATION_CONSUMED" } })).toBe(1);
});

test("first signup works without JavaScript and without weakening the OAuth checks", async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", baseURL: "http://localhost:3100", viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const messages = trackBrowserErrors(page);
    const invitation = await invite();
    const observed = await mockDiscord(context, discordId());
    await page.goto(invitation.path);
    await expect(page.getByRole("button", { name: "Continuer avec Discord" })).toBeVisible();
    await page.getByRole("button", { name: "Continuer avec Discord" }).click();
    await expect(page).toHaveURL(/\/profil$/);
    expect(observed.authorizations).toBe(1);
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
  const observed = await mockDiscord(context, discordId(), { rejectAuthorization: true });
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
  expect(observed.authorizations).toBe(0);
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
