import { test, expect } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/auth";

test.afterAll(async () => { await prisma.$disconnect(); });

test("a confirmed targeted invitation never silently signs in a different existing character", async ({ page, context }) => {
  if (process.env.E2E_EXTERNAL_SERVER === "true") throw new Error("Identity OAuth test requires the isolated preload fixture");
  const role = async (code: "NINJA" | "ECONOMIC_AGENT" | "KOEKI_MANAGER") => (await prisma.role.upsert({ where: { code }, create: { code, label: code }, update: {} })).id;
  const manager = await prisma.user.create({ data: { name: `Mismatch manager ${randomUUID()}`, roles: { create: { roleId: await role("KOEKI_MANAGER") } } } });
  const id = String(100_000_000_000_000_000n + BigInt(`0x${randomBytes(7).toString("hex")}`));
  const other = await prisma.user.create({ data: { name: `Other Discord ${randomUUID()}`, discordId: id, roles: { create: { roleId: await role("ECONOMIC_AGENT") } }, accounts: { create: { provider: "discord", providerAccountId: id, type: "oauth" } } } });
  const grade = await prisma.ninjaGrade.upsert({ where: { code: "IDENTITY_MISMATCH_E2E" }, create: { code: "IDENTITY_MISMATCH_E2E", label: "Fixture identité ciblée", sortOrder: 993 }, update: {} });
  const sheet = async (prefix: string, userId: string | null) => {
    const sequence = await prisma.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('"NinjaProfile_code_seq"') AS value`;
    return prisma.ninjaProfile.create({ data: { code: `NIN-${String(sequence[0]!.value).padStart(6, "0")}`, firstName: prefix, lastName: randomUUID(), currentGradeId: grade.id, userId } });
  };
  const previous = await sheet("AncienPersonnage", other.id), expected = await sheet("PersonnageAttendu", null);
  const { token, tokenHash } = createInvitationToken(process.env.KOEKI_E2E_INVITE_PEPPER!);
  const invitation = await prisma.invitation.create({ data: { tokenHash, roleId: await role("NINJA"), createdById: manager.id, ninjaProfileId: expected.id, expiresAt: new Date(Date.now() + 3_600_000) } });
  const usersBefore = await prisma.user.count();
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const cdp = await context.newCDPSession(page);
  cdp.on("Fetch.requestPaused", (event: { requestId: string; request: { url: string }; resourceType: string }) => {
    void (async () => {
      const request = new URL(event.request.url);
      expect(request.origin).toBe("https://discord.com");
      expect(["/oauth2/authorize", "/api/oauth2/authorize"]).toContain(request.pathname);
      expect(event.resourceType).toBe("Document");
      expect(request.searchParams.get("redirect_uri")).toBe("http://localhost:3100/api/auth/callback/discord");
      expect(request.searchParams.get("code_challenge_method")).toBe("S256");
      const challenge = request.searchParams.get("code_challenge");
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const payload = Buffer.from(JSON.stringify({ id, guild: "member", challenge })).toString("base64url");
      const signature = createHmac("sha256", process.env.KOEKI_E2E_OAUTH_SECRET!).update(payload).digest("hex");
      const callback = new URL("http://localhost:3100/api/auth/callback/discord");
      callback.searchParams.set("code", `koeki-e2e.${payload}.${signature}`);
      callback.searchParams.set("iss", "https://discord.com");
      const state = request.searchParams.get("state");
      if (state) callback.searchParams.set("state", state);
      await cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 302, responseHeaders: [{ name: "Location", value: callback.toString() }, { name: "Cache-Control", value: "no-store" }], body: "" });
    })().catch(async (error: unknown) => {
      failures.push(error instanceof Error ? error.message : String(error));
      await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }).catch(() => {});
    });
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*://discord.com/*", requestStage: "Request" }] });
  await page.goto(`/invite/${token}`);
  await expect(page.getByText(`Personnage réservé : ${expected.firstName} ${expected.lastName}`, { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /Je confirme que/ }).check();
  await page.getByRole("button", { name: "Continuer avec Discord" }).click();
  await expect(page).toHaveURL(/error=AccountIdentityMismatch/);
  await expect(page.getByRole("heading", { name: "Identité du compte à vérifier" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(previous.code);
  const session = await (await context.request.get("/api/auth/session")).json();
  expect(session?.user).toBeFalsy();
  expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("PENDING");
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: expected.id } })).userId).toBeNull();
  expect((await prisma.ninjaProfile.findUniqueOrThrow({ where: { id: previous.id } })).userId).toBe(other.id);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).discordId).toBe(id);
  expect(await prisma.account.count({ where: { userId: other.id } })).toBe(1);
  expect(await prisma.user.count()).toBe(usersBefore);
  expect(failures).toEqual([]);
});
