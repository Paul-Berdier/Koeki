import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { prisma, type RoleCode } from "@koeki/database";
import {
  formatReportDate,
  reportDayBoundary,
  shiftReportDate,
} from "../lib/report-period";

type Identity = { id: string; ninjaId: string; name: string; token: string };
let people: Record<string, Identity>;
let workflowReportId: string;
let workflowTaskId: string;
const run = randomUUID().slice(0, 8);
const note = `CONFIDENTIEL-ENCADREMENT-${run}`;
const today = formatReportDate(new Date());
const sevenDaysFrom = shiftReportDate(today, -6);
const thirtyDaysFrom = shiftReportDate(today, -29);
const paginationGroup = `Relève ${run}`;
let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|cannot be a descendant|cannot contain/i.test(message.text())
    )
      browserErrors.push(message.text());
  });
});
test.afterEach(() => {
  expect(browserErrors, "No runtime or hydration errors").toEqual([]);
});
async function login(context: BrowserContext, person: Identity) {
  await context.clearCookies();
  await context.addCookies([
    {
      name: "koeki.session-token",
      value: person.token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
}
async function screenshot(page: Page, name: string, project: string) {
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({
    path: `../../docs/evidence/front-v3-${name}-${project}.png`,
    fullPage: true,
    caret: "initial",
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
test.beforeAll(async () => {
  mkdirSync(path.resolve("../../docs/evidence"), { recursive: true });
  const grade = await prisma.ninjaGrade.upsert({
    where: { code: "E2E_GENIN" },
    create: { code: "E2E_GENIN", label: "Genin · fixture", sortOrder: 90 },
    update: {},
  });
  people = {};
  for (const [key, firstName, codes] of [
    ["manager", "Responsable", ["KOEKI_MANAGER"]],
    ["agent", "Agent", ["ECONOMIC_AGENT", "NINJA"]],
    ["idle", "Sans activité", ["ECONOMIC_AGENT"]],
    ["auditor", "Auditeur", ["AUDITOR"]],
    ["ninja", "Ninja", ["NINJA"]],
    ["multi", "Multirôle", ["NINJA", "KOEKI_MANAGER"]],
  ] as Array<[string, string, RoleCode[]]>) {
    const user = await prisma.user.create({
      data: { name: `Fixture ${key} ${run}` },
    });
    for (const code of codes) {
      const role = await prisma.role.upsert({
        where: { code },
        create: { code, label: code },
        update: {},
      });
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
    const ninja = await prisma.ninjaProfile.create({
      data: {
        code: `E2E-${key}-${run}`,
        firstName,
        lastName: `Suna ${run}`,
        currentGradeId: grade.id,
        userId: user.id,
      },
    });
    const token = randomUUID() + randomUUID();
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: token,
        sessionVersion: 1,
        expires: new Date(Date.now() + 3600_000),
      },
    });
    people[key] = {
      id: user.id,
      ninjaId: ninja.id,
      name: `${firstName} Suna ${run}`,
      token,
    };
    if (codes.includes("ECONOMIC_AGENT"))
      await prisma.agentParticipation.create({
        data: {
          userId: user.id,
          startsAt: new Date(Date.now() - 40 * 86400_000),
          rankingEligible: true,
          dateSource: "DECLARED",
          serviceRole: "ECONOMIC_AGENT",
        },
      });
  }
  await prisma.ninjaProfile.update({
    where: { id: people.ninja!.ninjaId },
    data: { referenceAgentId: people.agent!.id },
  });
  await prisma.agentNote.create({
    data: {
      userId: people.agent!.id,
      authorId: people.manager!.id,
      body: note,
    },
  });
  const workflowTask = await prisma.followUpTask.create({
    data: {
      title: `Vérifier le dossier ${run}`,
      description: "Contacter le ninja et vérifier le reçu fictif.",
      assigneeId: people.agent!.id,
      createdById: people.manager!.id,
      ninjaId: people.ninja!.ninjaId,
      dueAt: new Date(Date.now() - 86400_000),
      priority: "HIGH",
    },
  });
  workflowTaskId = workflowTask.id;
  const workflowReport = await prisma.agentReport.create({
    data: {
      authorId: people.agent!.id,
      periodStart: new Date("2026-09-01T00:00:00Z"),
      periodEnd: new Date("2026-09-02T00:00:00Z"),
      summary: `Rapport à examiner ${run}`,
      status: "SUBMITTED",
      submittedAt: new Date(),
    },
  });
  workflowReportId = workflowReport.id;
  await prisma.taxPayment.create({
    data: {
      receiptNumber: `E2E-PAY-${run}`,
      ninjaId: people.ninja!.ninjaId,
      recordedById: people.agent!.id,
      amount: 1500n,
      method: "RYO",
      status: "VALIDATED",
      balanceBefore: 1500n,
      balanceAfter: 0n,
      idempotencyKey: `e2e-payment-${run}`,
      validatedAt: new Date(),
      operationOrigin: "BUSINESS",
    },
  });
  await prisma.resourceTransaction.create({
    data: {
      receiptNumber: `E2E-DON-${run}`,
      ninjaId: people.ninja!.ninjaId,
      recordedById: people.agent!.id,
      agentId: people.agent!.id,
      type: "DONATION",
      status: "VALIDATED",
      totalAmount: 500n,
      idempotencyKey: `e2e-donation-${run}`,
      validatedAt: new Date(),
      operationOrigin: "BUSINESS",
    },
  });
  // Real isolated business fixtures give the chart a known history, not synthetic UI data.
  for (const offset of [27, 24, 21, 18, 15, 12, 9, 6, 3, 1]) {
    const validatedAt = new Date(
      reportDayBoundary(shiftReportDate(today, -offset)).getTime() +
        12 * 3600000,
    );
    await prisma.taxPayment.create({
      data: {
        receiptNumber: `E2E-PAY-${run}-${offset}`,
        ninjaId: people.ninja!.ninjaId,
        recordedById: people.agent!.id,
        amount: BigInt(200 + offset * 30),
        method: "RYO",
        status: "VALIDATED",
        balanceBefore: 4000n,
        balanceAfter: 0n,
        idempotencyKey: `e2e-payment-${run}-${offset}`,
        validatedAt,
        operationOrigin: "BUSINESS",
      },
    });
    const type = offset % 2 === 0 ? "DONATION" : "BUYBACK";
    await prisma.resourceTransaction.create({
      data: {
        receiptNumber: `E2E-${type}-${run}-${offset}`,
        ninjaId: people.ninja!.ninjaId,
        recordedById: people.agent!.id,
        agentId: people.manager!.id,
        type,
        status: "VALIDATED",
        totalAmount: BigInt(100 + offset * 10),
        idempotencyKey: `e2e-resource-${run}-${offset}`,
        validatedAt,
        operationOrigin: "BUSINESS",
      },
    });
  }
  const agentRole = await prisma.role.findUniqueOrThrow({
    where: { code: "ECONOMIC_AGENT" },
  });
  for (let index = 1; index <= 14; index++) {
    const firstName = [
      "Akio",
      "Chiyo",
      "Daichi",
      "Emi",
      "Fuyuki",
      "Haru",
      "Izumi",
      "Jun",
      "Kaede",
      "Maki",
      "Natsu",
      "Ren",
      "Sora",
      "Yuki",
    ][index - 1]!;
    const user = await prisma.user.create({
      data: {
        name: `${firstName} ${paginationGroup}`,
        roles: { create: { roleId: agentRole.id } },
        participations: {
          create: {
            startsAt: new Date(Date.now() - 45 * 86400000),
            dateSource: "DECLARED",
            serviceRole: "ECONOMIC_AGENT",
            rankingEligible: true,
          },
        },
      },
    });
    await prisma.ninjaProfile.create({
      data: {
        code: `E2E-REL-${run}-${index}`,
        firstName,
        lastName: paginationGroup,
        currentGradeId: grade.id,
        userId: user.id,
      },
    });
    if (index <= 4) {
      const validatedAt = new Date(
        reportDayBoundary(shiftReportDate(today, -index)).getTime() +
          10 * 3600000,
      );
      await prisma.taxPayment.create({
        data: {
          receiptNumber: `E2E-REL-PAY-${run}-${index}`,
          ninjaId: people.ninja!.ninjaId,
          recordedById: user.id,
          amount: BigInt(index * 350),
          method: "RYO",
          status: "VALIDATED",
          balanceBefore: 2000n,
          balanceAfter: 0n,
          idempotencyKey: `e2e-rel-payment-${run}-${index}`,
          validatedAt,
          operationOrigin: "BUSINESS",
        },
      });
      await prisma.followUpTask.create({
        data: {
          title: `Suivi ${firstName} ${run}`,
          description:
            "Vérifier les justificatifs du dossier de démonstration authentifiée.",
          assigneeId: user.id,
          createdById: people.manager!.id,
          status: index === 2 ? "BLOCKED" : "IN_PROGRESS",
          dueAt: new Date(Date.now() + (index - 2) * 86400000),
        },
      });
    }
  }
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("role restrictions and private data hold through real Auth.js sessions", async ({
  page,
  context,
}) => {
  for (const key of ["agent", "ninja", "auditor"]) {
    await login(context, people[key]!);
    await page.goto("/audit");
    await expect(page).toHaveURL(/access-denied/);
    await page.goto(`/equipe/${people.agent!.id}?vue=accompagnement`);
    await expect(page).toHaveURL(/access-denied/);
    expect(await page.content()).not.toContain(note);
  }
  await login(context, people.multi!);
  await page.goto("/audit");
  await expect(page.locator("h1")).toContainText("audit");
  await login(context, people.agent!);
  await page.goto("/classement");
  await expect(page.locator("h1")).toHaveText("Classement");
  expect(await page.content()).not.toContain(note);
  expect(await page.locator('a[href="/audit"]').count()).toBe(0);
  expect(await page.locator('a[href^="/equipe/"]').count()).toBe(0);
});

test("authenticated screens, responsive reflow and accessible mobile navigation", async ({
  page,
  context,
}, info) => {
  await login(context, people.agent!);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Mon bureau", exact: true }),
  ).toBeVisible();
  await screenshot(page, "agent-home", info.project.name);
  if (info.project.name !== "desktop") {
    const trigger = page.getByRole("button", {
      name: "Ouvrir la navigation",
      includeHidden: true,
    });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  await login(context, people.manager!);
  for (const [route, name] of [
    ["/", "manager-home"],
    ["/equipe", "team"],
    [`/equipe/${people.agent!.id}`, "agent-detail"],
    ["/classement", "ranking"],
    ["/admin/comptes", "accounts"],
  ]) {
    await page.goto(route!);
    await screenshot(page, name!, info.project.name);
  }
  await page
    .getByRole("searchbox", { name: "Rechercher une identité RP" })
    .fill(people.agent!.name);
  await page.getByRole("button", { name: "Filtrer les comptes" }).click();
  await expect(page).toHaveURL(/q=/);
  await page
    .getByRole("button", { name: "Autres actions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Autres actions", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  const button = page.getByRole("button", {
    name: "Désactiver l’accès au site",
    exact: true,
  });
  await button.click();
  await expect(page.getByRole("dialog")).toContainText(people.agent!.name);
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press("Tab");
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.contains(document.activeElement)),
    ).toBe(true);
  }
  // A modal is viewport-bound: full-page capture can displace fixed elements on mobile.
  await page.screenshot({
    path: `../../docs/evidence/front-v3-revoke-dialog-${info.project.name}.png`,
    fullPage: false,
    caret: "initial",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("revocation invalidates the current cookie and reactivation requires a new session", async ({
  page,
  context,
  browser,
}) => {
  await login(context, people.manager!);
  await page.goto(`/admin/comptes?q=${encodeURIComponent(people.idle!.name)}`);
  await page
    .getByRole("button", { name: "Autres actions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Autres actions", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: "Désactiver l’accès au site", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Motif obligatoire" })
    .fill("Fin de service fictive pour le test navigateur");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Désactiver l’accès au site", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const old = await browser.newContext();
  await login(old, people.idle!);
  const oldPage = await old.newPage();
  await oldPage.goto("http://localhost:3100/");
  await expect(oldPage).toHaveURL(/connexion/);
  await page.goto(
    `/admin/comptes?state=disabled&q=${encodeURIComponent(people.idle!.name)}`,
  );
  await page
    .getByRole("button", { name: "Réactiver l’accès", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Motif obligatoire" })
    .fill("Reprise de service fictive pour le test navigateur");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Réactiver l’accès", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await oldPage.goto("http://localhost:3100/");
  await expect(oldPage).toHaveURL(/connexion/);
  await old.close();
  expect(
    await prisma.ninjaProfile.findUnique({
      where: { id: people.idle!.ninjaId },
    }),
  ).not.toBeNull();
});

test("automated accessibility scan and 200 percent layout", async ({
  page,
  context,
}) => {
  await login(context, people.manager!);
  const packages = path.resolve("../../node_modules/.pnpm");
  const axeDir = readdirSync(packages).find((name) => /^axe-core@/.test(name));
  if (!axeDir)
    throw new Error(
      "axe-core bundled with the locked lint dependencies is required",
    );
  for (const route of [
    "/",
    "/equipe",
    `/equipe/${people.agent!.id}`,
    "/classement",
    "/admin/comptes",
    "/taches",
    "/reports",
  ]) {
    await page.goto(route);
    await page.addScriptTag({
      path: path.join(packages, axeDir, "node_modules/axe-core/axe.min.js"),
    });
    const violations = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              options: unknown,
            ) => Promise<{
              violations: Array<{
                id: string;
                impact: string;
                nodes: unknown[];
              }>;
            }>;
          };
        }
      ).axe;
      return (
        await axe.run({
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
          },
        })
      ).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes }));
    });
    expect(violations, `axe at ${route}`).toEqual([]);
  }
  await page.goto("/equipe");
  // CSS zoom actually scales fixed-pixel text and controls; font-size on html alone does not.
  // This complements viewport reflow checks, not a claim about all browser zoom implementations.
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
  await expect(
    page.getByRole("heading", { name: "Pilotage de l’équipe", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("report and task follow-up use motivated reviews and preserve their history", async ({
  page,
  context,
}) => {
  const correction = `Préciser les incidents et le suivi du dossier ${run}.`;
  const revisedSummary = `Rapport corrigé ${run} : incident vérifié, référent contacté et suivi documenté.`;
  const blockage = `En attente de la réponse du ninja concernant le reçu ${run}.`;

  await login(context, people.manager!);
  await page.goto(`/reports/${workflowReportId}`);
  await expect(
    page.getByRole("heading", { name: "Examiner cette version", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Demander une correction", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Expliquez la correction attendue" }),
  ).toBeVisible();
  expect(
    (
      await prisma.agentReport.findUniqueOrThrow({
        where: { id: workflowReportId },
      })
    ).status,
  ).toBe("SUBMITTED");
  await page
    .getByRole("textbox", { name: "Avis du responsable", exact: true })
    .fill(correction);
  await page
    .getByRole("button", { name: "Demander une correction", exact: true })
    .click();
  await expect(page).toHaveURL(/\/reports$/);
  const returned = await prisma.agentReport.findUniqueOrThrow({
    where: { id: workflowReportId },
  });
  expect(returned.status).toBe("RETURNED");
  expect(returned.decidedAt).not.toBeNull();

  await login(context, people.agent!);
  await page.goto(`/reports/${workflowReportId}`);
  await expect(page.getByText(correction, { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Corriger mon rapport", exact: true })
    .click();
  await expect(
    page.getByText(`Avis sur la version 1 : ${correction}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Résumé de la période", exact: false })
    .fill(revisedSummary);
  await page
    .getByRole("button", { name: "Soumettre à nouveau", exact: true })
    .click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.goto(`/reports/${workflowReportId}`);
  await expect(page.getByText(revisedSummary, { exact: true })).toBeVisible();
  await expect(page.getByText(correction, { exact: true })).toBeVisible();
  const resubmitted = await prisma.agentReport.findUniqueOrThrow({
    where: { id: workflowReportId },
    include: { reviews: true },
  });
  expect(resubmitted.status).toBe("SUBMITTED");
  expect(resubmitted.version).toBeGreaterThan(returned.version);
  expect(resubmitted.reviews).toHaveLength(1);
  expect(resubmitted.reviews[0]).toMatchObject({
    decision: "RETURNED",
    comment: correction,
    reviewerId: people.manager!.id,
    reportVersion: 1,
  });
  expect(resubmitted.reviews[0]!.contentSnapshot).toMatchObject({
    summary: `Rapport à examiner ${run}`,
  });

  await page.goto(`/taches?id=${workflowTaskId}`);
  await expect(
    page
      .locator(".task-summary strong")
      .filter({ hasText: `Vérifier le dossier ${run}` }),
  ).toBeVisible();
  await expect(
    page
      .locator(".task-item")
      .filter({
        has: page
          .locator(".task-summary strong")
          .filter({ hasText: `Vérifier le dossier ${run}` }),
      }),
  ).toHaveAttribute("open", "");
  await page
    .getByRole("combobox", { name: "Nouvel état", exact: true })
    .selectOption("IN_PROGRESS");
  await page
    .getByRole("button", { name: "Mettre à jour l’avancement", exact: true })
    .click();
  await expect(page).toHaveURL(/\/taches$/);
  expect(
    (
      await prisma.followUpTask.findUniqueOrThrow({
        where: { id: workflowTaskId },
      })
    ).status,
  ).toBe("IN_PROGRESS");
  await page.goto(`/taches?id=${workflowTaskId}`);
  await page
    .getByRole("combobox", { name: "Nouvel état", exact: true })
    .selectOption("BLOCKED");
  await page
    .getByRole("button", { name: "Mettre à jour l’avancement", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Précisez une justification" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Nouvel état", exact: true }),
  ).toHaveValue("BLOCKED");
  await page
    .getByRole("textbox", {
      name: "Avancement, blocage ou résolution",
      exact: true,
    })
    .fill(blockage);
  await page
    .getByRole("button", { name: "Mettre à jour l’avancement", exact: true })
    .click();
  await expect(page).toHaveURL(/\/taches$/);
  const task = await prisma.followUpTask.findUniqueOrThrow({
    where: { id: workflowTaskId },
    include: { transitions: { orderBy: { createdAt: "asc" } } },
  });
  expect(task.status).toBe("BLOCKED");
  expect(task.transitions).toHaveLength(2);
  expect(task.transitions[0]).toMatchObject({
    actorId: people.agent!.id,
    fromStatus: "TODO",
    toStatus: "IN_PROGRESS",
  });
  expect(task.transitions[1]).toMatchObject({
    actorId: people.agent!.id,
    fromStatus: "IN_PROGRESS",
    toStatus: "BLOCKED",
    reason: blockage,
  });
});

test("manager analytics keep period, chart totals, zero agents and private detail navigation coherent", async ({
  page,
  context,
}, info) => {
  await login(context, people.manager!);
  await page.goto("/equipe");
  await expect(
    page.getByRole("heading", { name: "Pilotage de l’équipe", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "7 jours", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`du=${sevenDaysFrom}.*au=${today}`));
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue(
    sevenDaysFrom,
  );
  await expect(page.getByLabel("Au", { exact: true })).toHaveValue(today);
  await page
    .locator("summary")
    .filter({ hasText: /^Voir les données de la courbe$/ })
    .click();
  const daily = page.getByRole("region", {
    name: "Données quotidiennes",
    exact: true,
  });
  await expect(daily.locator("tbody tr")).toHaveCount(7);
  const teamRows = await daily
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll("td")).map(
          (cell) => cell.textContent?.trim() ?? "",
        ),
      ),
    );
  expect(teamRows[0]![0]).toBe(sevenDaysFrom);
  expect(teamRows[6]![0]).toBe(today);
  for (const [index, label] of [
    [1, "Paiements"],
    [2, "Dons"],
    [3, "Rachats"],
  ] as const) {
    const seriesTotal = teamRows.reduce(
      (sum, row) => sum + Number(row[index]),
      0,
    );
    const button = page
      .locator(".chart-legend")
      .getByRole("button", { name: new RegExp(label) });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button.locator("strong")).toHaveText(String(seriesTotal));
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  expect(
    teamRows.every(
      (row) =>
        Number(row[1]) + Number(row[2]) + Number(row[3]) === Number(row[4]),
    ),
  ).toBe(true);

  await page
    .getByRole("navigation", { name: "Vues de l’équipe", exact: true })
    .getByRole("link", { name: /^Agents / })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`du=${sevenDaysFrom}.*au=${today}.*vue=agents`),
  );
  const search = page.getByRole("searchbox", {
    name: "Rechercher un agent",
    exact: true,
  });
  const table = page.getByRole("region", {
    name: "Suivi des agents",
    exact: true,
  });
  await search.fill(paginationGroup);
  await expect(table.locator("tbody tr")).toHaveCount(12);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Suivant", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Précédent", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(12);
  await search.fill(people.idle!.name);
  await page
    .getByRole("combobox", { name: "Filtrer les agents", exact: true })
    .selectOption("idle");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(
    table.locator("tbody tr").first().locator("td").nth(1).locator("strong"),
  ).toHaveText("0");
  await expect(table.locator("tbody tr").first()).toContainText(
    "0 P · 0 D · 0 R",
  );
  await page
    .getByRole("combobox", { name: "Filtrer les agents", exact: true })
    .selectOption("all");
  await search.fill(people.agent!.name);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(
    table.locator("tbody tr").first().locator("td").nth(1).locator("strong"),
  ).toHaveText("8");
  await page
    .getByRole("link", {
      name: `Ouvrir la fiche de ${people.agent!.name}`,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/equipe/${people.agent!.id}\\?du=${sevenDaysFrom}.*au=${today}`,
    ),
  );
  await expect(
    page.getByRole("heading", { name: people.agent!.name, exact: true }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(note);
  await page
    .locator("summary")
    .filter({ hasText: /^Voir les données de la courbe$/ })
    .click();
  const agentRows = page
    .getByRole("region", { name: "Données quotidiennes", exact: true })
    .locator("tbody tr");
  await expect(agentRows).toHaveCount(7);
  const sums = await agentRows.evaluateAll((rows) =>
    rows.reduce(
      (totals, row) => {
        const cells = row.querySelectorAll("td");
        return totals.map(
          (total, index) => total + Number(cells[index + 1]?.textContent ?? 0),
        );
      },
      [0, 0, 0, 0],
    ),
  );
  expect(sums).toEqual([4, 2, 2, 8]);

  await page.getByLabel("Du", { exact: true }).fill(thirtyDaysFrom);
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`du=${thirtyDaysFrom}.*au=${today}`));
  const chartDisclosure = page
    .locator("details")
    .filter({
      has: page
        .locator("summary")
        .filter({ hasText: /^Voir les données de la courbe$/ }),
    });
  if ((await chartDisclosure.getAttribute("open")) === null)
    await chartDisclosure.locator("summary").click();
  const thirtyRows = page
    .getByRole("region", { name: "Données quotidiennes", exact: true })
    .locator("tbody tr");
  await expect(thirtyRows).toHaveCount(30);
  const thirtyTotal = await thirtyRows.evaluateAll((rows) =>
    rows.reduce(
      (sum, row) =>
        sum + Number(row.querySelectorAll("td")[4]?.textContent ?? 0),
      0,
    ),
  );
  expect(thirtyTotal).toBe(22);
  await expect(
    page
      .locator(".metric-card")
      .filter({ hasText: "Opérations validées" })
      .locator(".metric-value"),
  ).toHaveText("22");
  await screenshot(page, "agent-analytics", info.project.name);
  const agentNavigation = page.getByRole("navigation", {
    name: "Rubriques de la fiche agent",
    exact: true,
  });
  await agentNavigation
    .getByRole("link", { name: "Dossiers", exact: true })
    .click();
  await expect(page).toHaveURL(/vue=dossiers/);
  await page.locator("summary").filter({ hasText: people.ninja!.name }).click();
  await expect(
    page.getByRole("link", { name: "Ouvrir le dossier ninja", exact: true }),
  ).toHaveAttribute("href", `/ninjas/${people.ninja!.ninjaId}`);
  await agentNavigation
    .getByRole("link", { name: "Opérations", exact: true })
    .click();
  await expect(page).toHaveURL(/vue=activite/);
  const operationJournal = page.getByRole("region", {
    name: "Opérations de cet agent",
    exact: true,
  });
  await expect(operationJournal.locator("tbody tr")).toHaveCount(22);
  await expect(
    operationJournal.getByRole("link", {
      name: `Paiement E2E-PAY-${run}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    operationJournal.getByRole("link", {
      name: `Paiement E2E-PAY-${run}-27`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "7 jours", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`du=${sevenDaysFrom}.*au=${today}.*vue=activite`),
  );
  await expect(operationJournal.locator("tbody tr")).toHaveCount(8);
  await expect(
    operationJournal.getByRole("link", {
      name: `Paiement E2E-PAY-${run}-27`,
      exact: true,
    }),
  ).toHaveCount(0);
  await agentNavigation
    .getByRole("link", { name: "Accompagnement", exact: true })
    .click();
  await expect(page).toHaveURL(/vue=accompagnement/);
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  const followUpNote = `Suivi confidentiel du responsable ${run} : vérifier la réponse au prochain entretien.`;
  await page
    .getByRole("textbox", { name: "Nouvelle note", exact: true })
    .fill(followUpNote);
  await page
    .getByRole("button", { name: "Ajouter une note interne", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/equipe/${people.agent!.id}\\?du=${sevenDaysFrom}.*au=${today}.*vue=accompagnement`,
    ),
  );
  await expect(page.getByText(followUpNote, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue(
    sevenDaysFrom,
  );
  expect(
    await prisma.agentNote.count({
      where: {
        userId: people.agent!.id,
        authorId: people.manager!.id,
        body: followUpNote,
      },
    }),
  ).toBe(1);
  await screenshot(page, "agent-accompagnement", info.project.name);
  await page
    .getByRole("link", { name: "Retour à l’équipe", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/equipe\\?du=${sevenDaysFrom}.*au=${today}.*vue=agents`),
  );
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue(
    sevenDaysFrom,
  );
  await login(context, people.agent!);
  await page.goto(
    `/equipe/${people.agent!.id}?vue=accompagnement&du=${thirtyDaysFrom}&au=${today}`,
  );
  await expect(page).toHaveURL(/access-denied/);
  expect(await page.content()).not.toContain(note);
  expect(await page.content()).not.toContain(followUpNote);
});

test("resource entry defaults to buyback and preserves donation mode after a server error", async ({
  page,
  context,
}) => {
  await login(context, people.agent!);
  for (const route of [
    "/resources/transaction",
    "/resources/transaction?type=INVALID",
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: "Nouvelle transaction", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Type d’opération", exact: true }),
    ).toHaveValue("BUYBACK");
    await expect(
      page.getByRole("button", { name: "Enregistrer le rachat", exact: true }),
    ).toBeVisible();
  }
  await page.goto("/resources/transaction?type=DONATION");
  await expect(
    page.getByRole("heading", { name: "Nouvelle transaction", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Type d’opération", exact: true }),
  ).toHaveValue("DONATION");
  const before = await prisma.resourceTransaction.count({
    where: { recordedById: people.agent!.id },
  });
  await page
    .getByPlaceholder("Tapez un nom ou un code NIN-…", { exact: true })
    .fill(people.ninja!.name);
  await page
    .getByPlaceholder("Fer, Bague T4, Plan…", { exact: true })
    .fill(`Ressource inconnue ${run}`);
  await page
    .getByRole("spinbutton", { name: "Quantité", exact: true })
    .fill("1");
  await page
    .getByRole("button", { name: "Enregistrer le don", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/resources\/transaction\?type=DONATION&erreur=/,
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Ajoutez au moins une ressource" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nouvelle transaction", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Type d’opération", exact: true }),
  ).toHaveValue("DONATION");
  expect(
    await prisma.resourceTransaction.count({
      where: { recordedById: people.agent!.id },
    }),
  ).toBe(before);
});
