import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/auth";

const newDiscordId = () => String(100_000_000_000_000_000n + BigInt(`0x${randomBytes(7).toString("hex")}`));
let ninjaRoleId: string, agentRoleId: string, managerId: string, gradeId: string;

test.beforeAll(async () => {
  if (process.env.E2E_EXTERNAL_SERVER === "true") throw new Error("Identity OAuth tests require the isolated preload fixture");
  const role = async (code: "NINJA" | "ECONOMIC_AGENT" | "KOEKI_MANAGER") => (await prisma.role.upsert({ where: { code }, create: { code, label: code }, update: {} })).id;
  ninjaRoleId = await role("NINJA"); agentRoleId = await role("ECONOMIC_AGENT");
  managerId = (await prisma.user.create({ data: { name: `Identity manager ${randomUUID()}`, roles: { create: { roleId: await role("KOEKI_MANAGER") } } } })).id;
  gradeId = (await prisma.ninjaGrade.upsert({ where: { code: "IDENTITY_E2E" }, create: { code: "IDENTITY_E2E", label: "Fixture identité E2E", sortOrder: 992 }, update: {} })).id;
});
test.afterAll(async () => { await prisma.$disconnect(); });

async function sheet(prefix: string, userId?: string) {
  const sequence = await prisma.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('"NinjaProfile_code_seq"') AS value`;
  return prisma.ninjaProfile.create({ data: { firstName: prefix, lastName: randomUUID(), code: `NIN-${String(sequence[0]!.value).padStart(6, "0")}`, currentGradeId: gradeId, ...(userId ? { userId } : {}) } });
}
async function account(prefix: string, roleId = ninjaRoleId, linked = true) {
  const discordId = newDiscordId();
  const user = await prisma.user.create({ data: { name: `${prefix} Discord`, discordId, roles: { create: { roleId } }, accounts: { create: { type: "oauth", provider: "discord", providerAccountId: discordId } } } });
  return { user, discordId, profile: linked ? await sheet(prefix, user.id) : null };
}
async function browserSession(context: BrowserContext, userId: string) {
  const token = randomUUID();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.session.create({ data: { userId, sessionToken: token, sessionVersion: user.sessionVersion, expires: new Date(Date.now() + 3_600_000) } });
  await context.addCookies([{ name: "koeki.session-token", value: token, url: "http://localhost:3100", httpOnly: true, sameSite: "Lax" }]);
  return token;
}
async function invitation(ninjaProfileId?: string) {
  const { token, tokenHash } = createInvitationToken(process.env.KOEKI_E2E_INVITE_PEPPER!);
  const row = await prisma.invitation.create({ data: { tokenHash, roleId: ninjaRoleId, createdById: managerId, ninjaProfileId: ninjaProfileId ?? null, expiresAt: new Date(Date.now() + 3_600_000) } });
  return { token, row };
}

/** Only the external Discord hop is simulated; native POST, PKCE, callback,
 * application session and SQL effects are real. Never fall through to Discord. */
async function discord(context: BrowserContext, page: Page, id: string) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const cdp = await context.newCDPSession(page);
  cdp.on("Fetch.requestPaused", (event: { requestId: string; request: { url: string }; resourceType: string }) => {
    void (async () => {
      const auth = new URL(event.request.url);
      expect(auth.origin).toBe("https://discord.com");
      expect(["/api/oauth2/authorize", "/oauth2/authorize"]).toContain(auth.pathname);
      expect(event.resourceType).toBe("Document");
      expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
      const callback = auth.searchParams.get("redirect_uri");
      expect(callback).toBe("http://localhost:3100/api/auth/callback/discord");
      const challenge = auth.searchParams.get("code_challenge");
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const encoded = Buffer.from(JSON.stringify({ id, guild: "member", challenge })).toString("base64url");
      const signature = createHmac("sha256", process.env.KOEKI_E2E_OAUTH_SECRET!).update(encoded).digest("hex");
      const destination = new URL(callback!);
      destination.searchParams.set("code", `koeki-e2e.${encoded}.${signature}`);
      destination.searchParams.set("iss", "https://discord.com");
      const state = auth.searchParams.get("state");
      if (state) destination.searchParams.set("state", state);
      await cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 302, responseHeaders: [{ name: "Location", value: destination.toString() }, { name: "Cache-Control", value: "no-store" }, { name: "Referrer-Policy", value: "no-referrer" }], body: "" });
    })().catch(async (error: unknown) => {
      failures.push(error instanceof Error ? error.message : String(error));
      await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }).catch(() => {});
    });
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*://discord.com/*", requestStage: "Request" }] });
  return failures;
}

test("switching Discord identities in the same browser never merges accounts or inherits the old role", async ({ page, context }, info) => {
  const old = await account("AncienneIdentité", agentRoleId), next = await account("NouvelleIdentité");
  const oldToken = await browserSession(context, old.user.id);
  const anotherDevice = randomUUID();
  await prisma.session.create({ data: { userId: old.user.id, sessionToken: anotherDevice, sessionVersion: old.user.sessionVersion, expires: new Date(Date.now() + 3_600_000) } });
  const failures = await discord(context, page, next.discordId);
  await page.goto("/connexion");
  // A same-origin native form exercises account switching with a live old cookie.
  await page.evaluate(() => {
    const form = document.createElement("form"); form.method = "post"; form.action = "/api/connexion/discord";
    const input = document.createElement("input"); input.name = "intent"; input.value = "connexion"; form.append(input); document.body.append(form); form.submit();
  });
  await expect(page).toHaveURL(new RegExp(`/ninjas/${next.profile!.id}$`));
  expect(await prisma.session.findUnique({ where: { sessionToken: oldToken } })).toBeNull();
  expect(await prisma.session.findUnique({ where: { sessionToken: anotherDevice } })).not.toBeNull();
  expect(await prisma.account.count({ where: { userId: old.user.id } })).toBe(1);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: old.user.id } })).discordId).toBe(old.discordId);
  const session = await (await context.request.get("/api/auth/session")).json();
  expect(session?.user?.id).toBe(next.user.id);
  expect(session.user.roles).toEqual(["NINJA"]);
  await page.goto("/profil?identite=1");
  await expect(page.getByRole("heading", { name: "Vérifier mon identité" })).toBeVisible();
  await expect(page.locator("main")).toContainText(next.profile!.code);
  await expect(page.locator("main")).not.toContainText(old.profile!.code);
  mkdirSync("../../docs/evidence", { recursive: true });
  await page.screenshot({ path: `../../docs/evidence/identity-switch-${info.project.name}.png`, fullPage: true });
  expect(failures).toEqual([]);
});

test("ordinary login discards a stale invitation instead of silently granting its account or character", async ({ page, context }) => {
  const stale = await invitation(), id = newDiscordId();
  await context.addCookies([{ name: "koeki_invite", value: stale.token, url: "http://localhost:3100", httpOnly: true, sameSite: "Lax" }]);
  const failures = await discord(context, page, id);
  await page.goto("/connexion");
  await page.getByRole("button", { name: "Se connecter avec Discord" }).click();
  await expect(page).toHaveURL(/error=InvitationRequired/);
  expect(await prisma.account.count({ where: { provider: "discord", providerAccountId: id } })).toBe(0);
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: stale.row.id } })).status).toBe("PENDING");
  expect((await context.cookies()).some((cookie) => cookie.name === "koeki_invite")).toBe(false);
  expect(failures).toEqual([]);
});

test("a new targeted invite creates its own identity even when another account is still signed in", async ({ page, context }) => {
  const target = await sheet("PersonnageRéservé"), invite = await invitation(target.id), id = newDiscordId();
  const previous = await account("SessionPrécédente", agentRoleId);
  const previousToken = await browserSession(context, previous.user.id);
  const failures = await discord(context, page, id);
  await page.goto(`/invite/${invite.token}`);
  await expect(page.getByText(`Personnage réservé : ${target.firstName} ${target.lastName}`, { exact: true })).toBeVisible();
  for (const form of [
    { intent: "invitation", token: invite.token },
    { intent: "invitation", token: invite.token, confirmIdentity: "on", confirmedNinjaId: "incorrect-fixture" },
  ]) {
    const response = await context.request.post("/api/connexion/discord", { form, headers: { Origin: "http://localhost:3100", "Sec-Fetch-Site": "same-origin" }, maxRedirects: 0 });
    expect(response.status()).toBe(400);
  }
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invite.row.id } })).status).toBe("PENDING");
  expect(await prisma.session.findUnique({ where: { sessionToken: previousToken } })).not.toBeNull();
  await page.getByRole("checkbox", { name: /Je confirme que/ }).check();
  await page.getByRole("button", { name: "Continuer avec Discord" }).click();
  await expect(page).toHaveURL(new RegExp(`/ninjas/${target.id}$`));
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invite.row.id } })).status).toBe("USED");
  const oauth = await prisma.account.findUniqueOrThrow({ where: { provider_providerAccountId: { provider: "discord", providerAccountId: id } } });
  expect(oauth.userId).not.toBe(previous.user.id);
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: target.id } })).userId).toBe(oauth.userId);
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invite.row.id } })).consumedById).toBe(oauth.userId);
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: previous.profile!.id } })).userId).toBe(previous.user.id);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: previous.user.id } })).discordId).toBe(previous.discordId);
  expect(await prisma.account.count({ where: { userId: previous.user.id } })).toBe(1);
  expect(await prisma.session.findUnique({ where: { sessionToken: previousToken } })).toBeNull();
  const roles = await prisma.userRole.findMany({ where: { userId: oauth.userId }, include: { role: true } });
  expect(roles.map(({ role }) => role.code)).toEqual(["NINJA"]);
  expect(failures).toEqual([]);
});

test("profile selection has no default and changing it clears confirmation before linking exactly once", async ({ page, context }) => {
  const person = await account("NouvelArrivant", ninjaRoleId, false), first = await sheet("PremierChoix"), chosen = await sheet("ChoixConfirmé");
  await browserSession(context, person.user.id);
  await page.goto("/profil");
  const form = page.getByRole("form", { name: "Confirmer ma fiche ninja" });
  const select = form.getByRole("combobox"), confirm = form.getByRole("checkbox");
  await expect(select).toHaveValue("");
  const label = (p: typeof first) => `${p.firstName} ${p.lastName} · ${p.code}`;
  await select.selectOption({ label: label(first) }); await confirm.check();
  await select.selectOption({ label: label(chosen) }); await expect(confirm).not.toBeChecked();
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: chosen.id } })).userId).toBeNull();
  await confirm.check(); await form.getByRole("button", { name: "Confirmer et lier ma fiche" }).click();
  await expect(page).toHaveURL(new RegExp(`/ninjas/${chosen.id}$`));
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: chosen.id } })).userId).toBe(person.user.id);
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: first.id } })).userId).toBeNull();
  expect(await prisma.auditLog.count({ where: { action: "NINJA_CLAIMED", entityId: chosen.id } })).toBe(1);
});
