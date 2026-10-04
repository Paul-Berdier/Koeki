import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { prisma, type RoleCode } from "@koeki/database";

type Identity = { id: string; ninjaId: string; name: string; token: string };
let people: Record<string, Identity>;
let workflowReportId: string;
let workflowTaskId: string;
const run = randomUUID().slice(0, 8);
const note = `CONFIDENTIEL-ENCADREMENT-${run}`;
let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|cannot be a descendant|cannot contain/i.test(message.text())) browserErrors.push(message.text());
  });
});
test.afterEach(() => { expect(browserErrors, "No runtime or hydration errors").toEqual([]); });
async function login(context: BrowserContext, person: Identity) {
  await context.clearCookies();
  await context.addCookies([{ name: "koeki.session-token", value: person.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax", secure: false }]);
}
async function screenshot(page: Page, name: string, project: string) {
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: `../../docs/evidence/${name}-${project}.png`, fullPage: true, caret: "initial" });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
test.beforeAll(async () => {
  mkdirSync(path.resolve("../../docs/evidence"), { recursive: true });
  const grade = await prisma.ninjaGrade.upsert({ where: { code: "E2E_GENIN" }, create: { code: "E2E_GENIN", label: "Genin · fixture", sortOrder: 90 }, update: {} });
  people = {};
  for (const [key, firstName, codes] of [
    ["manager", "Responsable", ["KOEKI_MANAGER"]], ["agent", "Agent", ["ECONOMIC_AGENT", "NINJA"]],
    ["idle", "Sans activité", ["ECONOMIC_AGENT"]], ["auditor", "Auditeur", ["AUDITOR"]], ["ninja", "Ninja", ["NINJA"]],
    ["multi", "Multirôle", ["NINJA", "KOEKI_MANAGER"]]
  ] as Array<[string,string,RoleCode[]]>) {
    const user = await prisma.user.create({ data: { name: `Fixture ${key} ${run}` } });
    for (const code of codes) {
      const role = await prisma.role.upsert({ where: { code }, create: { code, label: code }, update: {} });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }
    const ninja = await prisma.ninjaProfile.create({ data: { code: `E2E-${key}-${run}`, firstName, lastName: `Suna ${run}`, currentGradeId: grade.id, userId: user.id } });
    const token = randomUUID()+randomUUID();
    await prisma.session.create({ data: { userId: user.id, sessionToken: token, sessionVersion: 1, expires: new Date(Date.now()+3600_000) } });
    people[key] = { id: user.id, ninjaId: ninja.id, name: `${firstName} Suna ${run}`, token };
    if (codes.includes("ECONOMIC_AGENT")) await prisma.agentParticipation.create({ data: { userId: user.id, startsAt: new Date(Date.now()-14*86400_000), rankingEligible: true, dateSource: "DECLARED" } });
  }
  await prisma.ninjaProfile.update({ where: { id: people.ninja!.ninjaId }, data: { referenceAgentId: people.agent!.id } });
  await prisma.agentNote.create({ data: { userId: people.agent!.id, authorId: people.manager!.id, body: note } });
  const workflowTask = await prisma.followUpTask.create({ data: { title: `Vérifier le dossier ${run}`, description: "Contacter le ninja et vérifier le reçu fictif.", assigneeId: people.agent!.id, createdById: people.manager!.id, ninjaId: people.ninja!.ninjaId, dueAt: new Date(Date.now()-86400_000), priority: "HIGH" } });
  workflowTaskId = workflowTask.id;
  const workflowReport = await prisma.agentReport.create({ data: { authorId: people.agent!.id, periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-02T00:00:00Z"), summary: `Rapport à examiner ${run}`, status: "SUBMITTED", submittedAt: new Date() } });
  workflowReportId = workflowReport.id;
  await prisma.taxPayment.create({ data: { receiptNumber: `E2E-PAY-${run}`, ninjaId: people.ninja!.ninjaId, recordedById: people.agent!.id, amount: 1500n, method: "RYO", status: "VALIDATED", balanceBefore: 1500n, balanceAfter: 0n, idempotencyKey: `e2e-payment-${run}`, validatedAt: new Date(), operationOrigin: "BUSINESS" } });
  await prisma.resourceTransaction.create({ data: { receiptNumber: `E2E-DON-${run}`, ninjaId: people.ninja!.ninjaId, recordedById: people.agent!.id, agentId: people.agent!.id, type: "DONATION", status: "VALIDATED", totalAmount: 500n, idempotencyKey: `e2e-donation-${run}`, validatedAt: new Date(), operationOrigin: "BUSINESS" } });
});
test.afterAll(async()=>{ await prisma.$disconnect(); });

test("role restrictions and private data hold through real Auth.js sessions", async({page,context})=>{
  for(const key of ["agent","ninja","auditor"]) {
    await login(context,people[key]!);
    await page.goto("/audit"); await expect(page).toHaveURL(/access-denied/);
    await page.goto(`/equipe/${people.agent!.id}`); await expect(page).toHaveURL(/access-denied/);
    expect(await page.content()).not.toContain(note);
  }
  await login(context,people.multi!); await page.goto("/audit"); await expect(page.locator("h1")).toContainText("audit");
  await login(context,people.agent!); await page.goto("/classement");
  await expect(page.locator("h1")).toHaveText("Classement hebdomadaire");
  expect(await page.content()).not.toContain(note);
  expect(await page.locator('a[href="/audit"]').count()).toBe(0);
  expect(await page.locator('a[href^="/equipe/"]').count()).toBe(0);
});

test("authenticated screens, responsive reflow and accessible mobile navigation",async({page,context},info)=>{
  await login(context,people.agent!); await page.goto("/");
  await expect(page.getByRole("heading",{name:"Mon activité",exact:true})).toBeVisible();
  await screenshot(page,"agent-home",info.project.name);
  if(info.project.name!=="desktop"){
    const trigger=page.getByRole("button",{name:"Ouvrir la navigation",includeHidden:true});
    await trigger.click(); await expect(page.getByRole("dialog")).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded","true");
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(trigger).toBeFocused();
  }
  await login(context,people.manager!);
  for(const [route,name] of [["/","manager-home"],["/equipe","team"],[`/equipe/${people.agent!.id}`,"agent-detail"],["/classement","ranking"],["/admin/comptes","accounts"]]){
    await page.goto(route!); await screenshot(page,name!,info.project.name);
  }
  await page.getByRole("searchbox",{name:"Rechercher une identité RP"}).fill(people.agent!.name);
  await page.getByRole("button",{name:"Filtrer les comptes"}).click();
  await expect(page).toHaveURL(/q=/);
  const button=page.getByRole("button",{name:"Désactiver l’accès au site",exact:true});
  await button.click(); await expect(page.getByRole("dialog")).toContainText(people.agent!.name);
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press("Tab");
    expect(await page.getByRole("dialog").evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  // A modal is viewport-bound: full-page capture can displace fixed elements on mobile.
  await page.screenshot({path:`../../docs/evidence/revoke-dialog-${info.project.name}.png`,fullPage:false,caret:"initial",animations:"disabled"});
  await page.keyboard.press("Escape"); await expect(button).toBeFocused();
});

test("revocation invalidates the current cookie and reactivation requires a new session",async({page,context,browser})=>{
  await login(context,people.manager!); await page.goto(`/admin/comptes?q=${encodeURIComponent(people.idle!.name)}`);
  await page.getByRole("button",{name:"Désactiver l’accès au site",exact:true}).click();
  await page.getByRole("textbox",{name:"Motif obligatoire"}).fill("Fin de service fictive pour le test navigateur");
  await page.getByRole("dialog").getByRole("button",{name:"Désactiver l’accès au site",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const old=await browser.newContext(); await login(old,people.idle!); const oldPage=await old.newPage();
  await oldPage.goto("http://localhost:3100/"); await expect(oldPage).toHaveURL(/connexion/);
  await page.goto(`/admin/comptes?state=disabled&q=${encodeURIComponent(people.idle!.name)}`);
  await page.getByRole("button",{name:"Réactiver l’accès",exact:true}).click();
  await page.getByRole("textbox",{name:"Motif obligatoire"}).fill("Reprise de service fictive pour le test navigateur");
  await page.getByRole("dialog").getByRole("button",{name:"Réactiver l’accès",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await oldPage.goto("http://localhost:3100/"); await expect(oldPage).toHaveURL(/connexion/); await old.close();
  expect(await prisma.ninjaProfile.findUnique({where:{id:people.idle!.ninjaId}})).not.toBeNull();
});

test("automated accessibility scan and 200 percent layout", async({page,context})=>{
  await login(context,people.manager!);
  const packages=path.resolve("../../node_modules/.pnpm");
  const axeDir=readdirSync(packages).find(name=>/^axe-core@/.test(name));
  if(!axeDir) throw new Error("axe-core bundled with the locked lint dependencies is required");
  for (const route of ["/", "/equipe", `/equipe/${people.agent!.id}`, "/classement", "/admin/comptes", "/taches", "/reports"]) {
  await page.goto(route);
  await page.addScriptTag({path:path.join(packages,axeDir,"node_modules/axe-core/axe.min.js")});
  const violations=await page.evaluate(async()=>{
    const axe=(window as unknown as {axe:{run:(options:unknown)=>Promise<{violations:Array<{id:string;impact:string;nodes:unknown[]}>}>}}).axe;
    return (await axe.run({runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes}));
  });
  expect(violations, `axe at ${route}`).toEqual([]);
  }
  await page.goto("/equipe");
  // CSS zoom actually scales fixed-pixel text and controls; font-size on html alone does not.
  // This complements viewport reflow checks, not a claim about all browser zoom implementations.
  await page.evaluate(()=>document.documentElement.style.zoom="2");
  await expect(page.getByRole("heading",{name:"Équipe",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("report and task follow-up use motivated reviews and preserve their history", async ({ page, context }) => {
  const correction = `Préciser les incidents et le suivi du dossier ${run}.`;
  const revisedSummary = `Rapport corrigé ${run} : incident vérifié, référent contacté et suivi documenté.`;
  const blockage = `En attente de la réponse du ninja concernant le reçu ${run}.`;

  await login(context, people.manager!);
  await page.goto(`/reports/${workflowReportId}`);
  await expect(page.getByRole("heading", { name: "Examiner cette version", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Demander une correction", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Expliquez la correction attendue" })).toBeVisible();
  expect((await prisma.agentReport.findUniqueOrThrow({ where: { id: workflowReportId } })).status).toBe("SUBMITTED");
  await page.getByRole("textbox", { name: "Avis du responsable", exact: true }).fill(correction);
  await page.getByRole("button", { name: "Demander une correction", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);
  const returned = await prisma.agentReport.findUniqueOrThrow({ where: { id: workflowReportId } });
  expect(returned.status).toBe("RETURNED");
  expect(returned.decidedAt).not.toBeNull();

  await login(context, people.agent!);
  await page.goto(`/reports/${workflowReportId}`);
  await expect(page.getByText(correction, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Corriger mon rapport", exact: true }).click();
  await expect(page.getByText(`Avis sur la version 1 : ${correction}`, { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Résumé de la période", exact: false }).fill(revisedSummary);
  await page.getByRole("button", { name: "Soumettre à nouveau", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.goto(`/reports/${workflowReportId}`);
  await expect(page.getByText(revisedSummary, { exact: true })).toBeVisible();
  await expect(page.getByText(correction, { exact: true })).toBeVisible();
  const resubmitted = await prisma.agentReport.findUniqueOrThrow({ where: { id: workflowReportId }, include: { reviews: true } });
  expect(resubmitted.status).toBe("SUBMITTED");
  expect(resubmitted.version).toBeGreaterThan(returned.version);
  expect(resubmitted.reviews).toHaveLength(1);
  expect(resubmitted.reviews[0]).toMatchObject({ decision: "RETURNED", comment: correction, reviewerId: people.manager!.id, reportVersion: 1 });
  expect(resubmitted.reviews[0]!.contentSnapshot).toMatchObject({ summary: `Rapport à examiner ${run}` });

  await page.goto(`/taches?id=${workflowTaskId}`);
  await expect(page.getByRole("heading", { name: `Vérifier le dossier ${run}`, exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Nouvel état", exact: true }).selectOption("IN_PROGRESS");
  await page.getByRole("button", { name: "Mettre à jour l’avancement", exact: true }).click();
  await expect(page).toHaveURL(/\/taches$/);
  expect((await prisma.followUpTask.findUniqueOrThrow({ where: { id: workflowTaskId } })).status).toBe("IN_PROGRESS");
  await page.goto(`/taches?id=${workflowTaskId}`);
  await page.getByRole("combobox", { name: "Nouvel état", exact: true }).selectOption("BLOCKED");
  await page.getByRole("button", { name: "Mettre à jour l’avancement", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Précisez une justification" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Nouvel état", exact: true })).toHaveValue("BLOCKED");
  await page.getByRole("textbox", { name: "Avancement, blocage ou résolution", exact: true }).fill(blockage);
  await page.getByRole("button", { name: "Mettre à jour l’avancement", exact: true }).click();
  await expect(page).toHaveURL(/\/taches$/);
  const task = await prisma.followUpTask.findUniqueOrThrow({ where: { id: workflowTaskId }, include: { transitions: { orderBy: { createdAt: "asc" } } } });
  expect(task.status).toBe("BLOCKED");
  expect(task.transitions).toHaveLength(2);
  expect(task.transitions[0]).toMatchObject({ actorId: people.agent!.id, fromStatus: "TODO", toStatus: "IN_PROGRESS" });
  expect(task.transitions[1]).toMatchObject({ actorId: people.agent!.id, fromStatus: "IN_PROGRESS", toStatus: "BLOCKED", reason: blockage });
});
