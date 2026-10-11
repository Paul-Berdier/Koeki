import { randomUUID } from "node:crypto";
import { closeCompletedRankings, prisma, sendReportReminders, type Prisma } from "@koeki/database";
import { assessmentSettlementBreakdown, calculateNextPenalty, createRpTimeService, defaultRpTimeConfig, deriveStockState, deriveTaxAssessmentStatus, exemptionUse, parseExemptionPolicy, rpTimeConfigSchema, ryo } from "@koeki/domain";
import { generateTaxWeeks } from "../../../packages/database/src/tax-generation";
import { refreshTaxStatuses } from "../../../packages/database/src/tax-status-sweep";

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

/** Serializes lifecycle-sensitive writes with administrative status changes. */
async function lockNinja(tx: Prisma.TransactionClient, ninjaId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string; userId: string | null }>>`
    SELECT "status", "userId" FROM "NinjaProfile" WHERE "id" = ${ninjaId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function rpService() {
  const setting = await prisma.appSetting.findUnique({ where: { key: "rpTime" } });
  return createRpTimeService(setting ? rpTimeConfigSchema.parse(setting.value) : defaultRpTimeConfig);
}

async function generateTaxes() {
  const generation = await generateTaxWeeks(prisma);
  const exempted = await autoApplyExemptions(generation.rpYear);
  return { command: "taxes:generate", ...generation, exempted };
}

/** Recovery is read-only unless both an explicit apply and reviewed RP year are supplied. */
async function recoverTaxes() {
  const args = process.argv.slice(3);
  if (args.some((arg) => arg !== "--apply" && arg !== "--dry-run" && !/^--(?:from-rp-year|expect-rp-year)=-?\d+$/.test(arg))) throw new Error("Unknown tax recovery argument");
  const read = (name: string) => {
    const values = args.filter((arg) => arg.startsWith(`--${name}=`));
    if (values.length > 1) throw new Error(`Duplicate ${name}`);
    return values[0] === undefined ? undefined : Number(values[0].split("=")[1]);
  };
  const fromRpYear = read("from-rp-year"), expectedRpYear = read("expect-rp-year");
  const apply = args.includes("--apply");
  if (apply && (args.includes("--dry-run") || fromRpYear === undefined || expectedRpYear === undefined)) throw new Error("Apply requires --from-rp-year=N --expect-rp-year=N and no --dry-run");
  // No automatic penalty or exemption is applied by a historical repair.
  return { command: "taxes:recover", ...await generateTaxWeeks(prisma, { dryRun: !apply, ...(fromRpYear === undefined ? {} : { fromRpYear }), ...(expectedRpYear === undefined ? {} : { expectedRpYear }) }) };
}

/** Applies stored exemption credit only up to the administrative weekly ceiling.
 * At 0 % it performs no write; nominal ninja balances remain untouched. */
async function autoApplyExemptions(rpYear: number) {
  const policySetting = await prisma.appSetting.findUnique({ where: { key: "exemptionPolicy" } });
  const policy = parseExemptionPolicy(policySetting?.value);
  if (policy.weeklyTaxCoverageBps <= 0) return 0;
  const systemUser = await prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } });
  if (!systemUser) return 0;
  const assessments = await prisma.taxAssessment.findMany({
    where: { ninja: { status: "ACTIVE" }, taxYear: { rpYear }, originalAmount: { gt: 0 }, status: { in: ["UPCOMING", "DUE", "PARTIALLY_PAID", "OVERDUE"] } },
    include: { penalties: { select: { amount: true } }, adjustments: { select: { amount: true } }, exemptions: { select: { amount: true } }, allocations: { select: { amount: true, payment: { select: { status: true } } } } }
  });
  let applied = 0;
  for (const candidate of assessments) {
    try {
      const committed = await prisma.$transaction(async (tx) => {
        const ninja = await lockNinja(tx, candidate.ninjaId);
        if (ninja?.status !== "ACTIVE") return false;
        const lockedSettings = await tx.$queryRaw<Array<{ value: Prisma.JsonValue; version: number }>>`
          SELECT "value", "version" FROM "AppSetting" WHERE "key" = 'exemptionPolicy' FOR SHARE
        `;
        const lockedPolicy = parseExemptionPolicy(lockedSettings[0]?.value);
        if (lockedPolicy.weeklyTaxCoverageBps <= 0) return false;
        const assessment = await tx.taxAssessment.findFirst({
          where: { id: candidate.id, ninjaId: candidate.ninjaId, status: { in: ["UPCOMING", "DUE", "PARTIALLY_PAID", "OVERDUE"] } },
          include: { penalties: { select: { amount: true } }, adjustments: { select: { amount: true } }, exemptions: { select: { amount: true } }, allocations: { select: { amount: true, payment: { select: { status: true } } } } }
        });
        if (!assessment) return false;
        const first = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "TaxAssessment", sourceId: assessment.id } } });
        const ledgerSourceId = first ? `${assessment.id}:worker:v${lockedSettings[0]?.version ?? 1}` : assessment.id;
        const already = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "TaxAssessment", sourceId: ledgerSourceId } } });
        if (already) return false;
        const balance = (await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId: assessment.ninjaId }, _sum: { amount: true } }))._sum.amount ?? 0n;
        if (balance <= 0n) return false;
        const paid = assessment.allocations.filter((item) => item.payment.status === "VALIDATED").reduce((sum, item) => sum + item.amount, 0n);
        const gross = assessment.originalAmount + assessment.penalties.reduce((sum, item) => sum + item.amount, 0n) + assessment.adjustments.reduce((sum, item) => sum + item.amount, 0n);
        const alreadyExempted = assessment.exemptions.reduce((sum, item) => sum + item.amount, 0n);
        const remaining = gross - alreadyExempted - paid;
        if (remaining <= 0n) return false;
        const use = exemptionUse({ availableCredit: balance, remainingDebt: remaining, gross, alreadyExempted, coverageBps: lockedPolicy.weeklyTaxCoverageBps });
        if (use <= 0n) return false;
        await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: -use, sourceType: "TaxAssessment", sourceId: ledgerSourceId, reason: `Exonération automatique — taxe année RP ${rpYear}` } });
        await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: use, reason: "Exonération automatique (crédit de dons/rachats)", grantedById: systemUser.id } });
        const status = deriveTaxAssessmentStatus({ storedStatus: assessment.status, remaining: remaining - use, settled: paid + alreadyExempted + use, preserveLegacyOverdue: false, dueAt: assessment.dueAt, now: new Date(), assessmentRpYear: rpYear, currentRpYear: rpYear });
        if (status !== assessment.status) await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status, version: { increment: 1 } } });
        await tx.auditLog.create({ data: { action: "TAX_AUTO_EXEMPTED", entityType: "TaxAssessment", entityId: assessment.id, requestId: randomUUID(), reason: `${use.toLocaleString("fr-FR")} ¥ de crédit appliqués (année RP ${rpYear}, plafond ${(lockedPolicy.weeklyTaxCoverageBps / 100).toLocaleString("fr-FR")} %)` } });
        return true;
      });
      if (committed) applied++;
    } catch (error) { if (!isUniqueViolation(error)) throw error; }
  }
  return applied;
}

async function applyPenalties() {
  const setting = await prisma.appSetting.findUnique({ where: { key: "latePenalty" } });
  const config = setting?.value as { latePenaltyPercentBps?: number; latePenaltyBasis?: "ORIGINAL_TAX"|"REMAINING_PRINCIPAL"|"CURRENT_DEBT"; latePenaltyFrequencyRpYears?: number; maxPenaltyApplications?: number; maxAssessmentDebt?: string; isPenaltyAutomationEnabled?: boolean; isRateValidated?: boolean } | undefined;
  if (!config?.isPenaltyAutomationEnabled || !config.isRateValidated || !config.latePenaltyPercentBps) return { command: "penalties:apply", created: 0, disabled: true };
  const service = await rpService();
  const assessments = await prisma.taxAssessment.findMany({ where: { ninja: { status: "ACTIVE" }, originalAmount: { gt: 0 }, status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] }, dueAt: { lt: new Date() } }, include: { penalties: true, allocations: { include: { payment: { select: { status: true } } } }, adjustments: true, exemptions: true } });
  let created = 0;
  for (const candidate of assessments) {
    try {
      const committed = await prisma.$transaction(async (tx) => {
        const ninja = await lockNinja(tx, candidate.ninjaId);
        if (ninja?.status !== "ACTIVE") return false;
        const assessment = await tx.taxAssessment.findFirst({ where: { id: candidate.id, originalAmount: { gt: 0 }, status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] }, dueAt: { lt: new Date() } }, include: { penalties: true, allocations: { include: { payment: { select: { status: true } } } }, adjustments: true, exemptions: true } });
        if (!assessment) return false;
        const paid = assessment.allocations.filter((item) => item.payment.status === "VALIDATED").reduce((sum, item) => sum + item.amount, 0n);
        const adjustments = assessment.adjustments.reduce((sum, item) => sum + item.amount, 0n);
        const penaltyTotal = assessment.penalties.reduce((sum, item) => sum + item.amount, 0n);
        const exempted = assessment.exemptions.reduce((sum, item) => sum + item.amount, 0n);
        const { currentDebt, remainingPrincipal } = assessmentSettlementBreakdown({ original: assessment.originalAmount, penalties: penaltyTotal, adjustments, exemptions: exempted, paid });
        if (currentDebt <= 0n) {
          if (assessment.status !== "PAID") await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID", version: { increment: 1 } } });
          return false;
        }
        const basisAmount = config.latePenaltyBasis === "REMAINING_PRINCIPAL" ? remainingPrincipal : config.latePenaltyBasis === "CURRENT_DEBT" ? currentDebt : assessment.originalAmount;
        const decision = calculateNextPenalty({ originalTax: ryo(assessment.originalAmount), remainingPrincipal: ryo(remainingPrincipal), currentDebt: ryo(currentDebt < 0n ? 0n : currentDebt), appliedPenaltyIndexes: assessment.penalties.map((item) => item.applicationIndex), completeLateYears: service.completeLateYears(assessment.dueAt) }, { latePenaltyPercentBps: config.latePenaltyPercentBps!, latePenaltyBasis: config.latePenaltyBasis ?? "ORIGINAL_TAX", latePenaltyFrequencyRpYears: config.latePenaltyFrequencyRpYears ?? 1, maxPenaltyApplications: config.maxPenaltyApplications ?? 4, maxAssessmentDebt: ryo(config.maxAssessmentDebt ?? "32000"), isPenaltyAutomationEnabled: true, isRateValidated: true });
        if (!decision || decision.amount === 0n) return false;
        await tx.taxPenalty.create({ data: { assessmentId: assessment.id, applicationIndex: decision.index, rpYearApplied: service.currentRpYear(), percentBps: config.latePenaltyPercentBps!, basis: config.latePenaltyBasis ?? "ORIGINAL_TAX", basisAmount, amount: decision.amount } });
        return true;
      });
      if (committed) created++;
    } catch (error) { if (!isUniqueViolation(error)) throw error; }
  }
  return { command: "penalties:apply", created, disabled: false };
}

const assessmentStatusLabels: Record<string, string> = { DUE: "à payer", OVERDUE: "en retard", PARTIALLY_PAID: "partiellement payée" };

async function sendReminders() {
  const reportReminders = await sendReportReminders(prisma);
  const service = await rpService();
  const taskReminderSetting = await prisma.appSetting.findUnique({ where: { key: "taskReminders" } });
  let taskReminders = 0;
  if ((taskReminderSetting?.value as { enabled?: boolean } | undefined)?.enabled !== false) {
    const tasks = await prisma.followUpTask.findMany({ where: { dueAt: { lte: new Date() }, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] }, assigneeId: { not: null } }, select: { id: true } });
    for (const candidate of tasks) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "FollowUpTask" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const task = await tx.followUpTask.findUnique({ where: { id: candidate.id } });
        if (!task?.assigneeId || !task.dueAt || task.dueAt > new Date() || !["TODO", "IN_PROGRESS", "BLOCKED"].includes(task.status)) return;
        const user = await tx.user.findUnique({ where: { id: task.assigneeId }, select: { revokedAt: true } });
        if (!user || user.revokedAt) return;
        const dedupeKey = `task-due:${task.id}:${task.assigneeId}:${task.dueAt.toISOString()}`;
        if (await tx.notification.findUnique({ where: { dedupeKey }, select: { id: true } })) return;
        await tx.notification.create({ data: { userId: task.assigneeId, title: "Échéance de tâche dépassée", body: task.title, href: `/taches?id=${task.id}`, dedupeKey } });
        taskReminders++;
      });
    }
  }
  const assessments = await prisma.taxAssessment.findMany({ where: { ninja: { status: "ACTIVE" }, status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID"] } }, select: { id: true, ninjaId: true } });
  let sent = 0;
  for (const assessment of assessments) {
    const notified = await prisma.$transaction(async (tx) => {
      const ninja = await lockNinja(tx, assessment.ninjaId);
      if (ninja?.status !== "ACTIVE" || !ninja.userId) return false;
      const current = await tx.taxAssessment.findFirst({ where: { id: assessment.id, ninjaId: assessment.ninjaId, status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID"] } }, include: { taxYear: { select: { rpYear: true } } } });
      if (!current) return false;
      const title = `Taxe année RP ${current.taxYear.rpYear} ${assessmentStatusLabels[current.status] ?? "à traiter"}`;
      // At most one reminder per assessment/recipient/RP week, even after reading it.
      const dedupeKey = `tax-due:${current.id}:${ninja.userId}:${service.currentRpYear()}`;
      const existing = await tx.notification.findFirst({ where: { OR: [{ dedupeKey }, { userId: ninja.userId, title, status: "UNREAD" }] } });
      if (existing) return false;
      await tx.notification.create({ data: { userId: ninja.userId, title, dedupeKey, body: `Le service économique de Suna vous rappelle votre taxe de l’année RP ${current.taxYear.rpYear} (échéance ${current.dueAt.toISOString().slice(0, 10)}).` } });
      return true;
    });
    if (notified) sent++;
  }
  return { command: "reminders:send", eligible: assessments.length, sent, taskReminders, reportReminders };
}

async function checkInventory() {
  const resources = await prisma.resource.findMany({ where: { isActive: true } });
  const grouped = await prisma.inventoryMovement.groupBy({ by: ["resourceId"], _sum: { quantity: true } });
  const stocks = new Map(grouped.map((entry) => [entry.resourceId, Number(entry._sum.quantity ?? 0)]));
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const managers = await prisma.user.findMany({ where: { revokedAt: null, roles: { some: { role: { code: { in: ["SUPER_ADMIN", "KOEKI_MANAGER"] } } } } }, select: { id: true } });
  const alerts: Array<{ resource: string; stock: number; level: string }> = [];
  for (const resource of resources) {
    const stock = stocks.get(resource.id) ?? 0;
    const state = deriveStockState({ inventoryStatus: resource.inventoryStatus, quantity: stock, minimumStock: Number(resource.minimumStock), criticalStock: Number(resource.criticalStock) });
    const level = state === "CRITICAL" || state === "OUT_OF_STOCK" ? "critical" : state === "LOW" ? "low" : null;
    if (!level) continue;
    alerts.push({ resource: resource.code, stock, level });
    const already = await prisma.auditLog.findFirst({ where: { action: "INVENTORY_ALERT", entityType: "Resource", entityId: resource.id, createdAt: { gte: startOfDay } } });
    if (already) continue;
    await prisma.auditLog.create({ data: { action: "INVENTORY_ALERT", entityType: "Resource", entityId: resource.id, reason: `Seuil ${level === "critical" ? "critique" : "bas"} atteint : ${stock} u`, requestId: randomUUID() } });
    for (const manager of managers) await prisma.notification.create({ data: { userId: manager.id, title: `Stock ${level === "critical" ? "critique" : "bas"} : ${resource.name}`, body: `${resource.name} — ${stock} restants (seuil ${level === "critical" ? "critique" : "bas"} : ${Number(level === "critical" ? resource.criticalStock : resource.minimumStock)}).` } });
  }
  return { command: "inventory:check", checked: resources.length, alerts };
}

async function refreshStats() {
  const service = await rpService(), rpYear = service.currentRpYear();
  const assessments = await prisma.taxAssessment.findMany({ where: { ninja: { status: "ACTIVE" }, taxYear: { rpYear }, status: { notIn: ["EXEMPT", "WAIVED", "SUSPENDED", "CANCELLED", "DRAFT"] } }, include: { penalties: true, adjustments: true, exemptions: true, allocations: { include: { payment: { select: { status: true } } } } } });
  let expected = 0n, collected = 0n, exempted = 0n;
  for (const assessment of assessments) {
    expected += assessment.originalAmount + assessment.penalties.reduce((sum, item) => sum + item.amount, 0n) + assessment.adjustments.reduce((sum, item) => sum + item.amount, 0n);
    collected += assessment.allocations.filter((item) => item.payment.status === "VALIDATED").reduce((sum, item) => sum + item.amount, 0n);
    exempted += assessment.exemptions.reduce((sum, item) => sum + item.amount, 0n);
  }
  const [payments, transactions] = await Promise.all([
    prisma.taxPayment.count({ where: { ninja: { status: "ACTIVE" }, status: "VALIDATED" } }),
    prisma.resourceTransaction.count({ where: { ninja: { status: "ACTIVE" }, status: "VALIDATED" } })
  ]);
  const value = { refreshedAt: new Date().toISOString(), rpYear, expected: String(expected), collected: String(collected), exempted: String(exempted), recoveryRateBps: expected > 0n ? Number(((collected + exempted) * 10_000n) / expected) : 0, payments, transactions };
  await prisma.appSetting.upsert({ where: { key: "statsSnapshot" }, create: { key: "statsSnapshot", value }, update: { value, version: { increment: 1 } } });
  return { command: "stats:refresh", ...value };
}

/** Ledger truth versus cached stock. Never silently correct inventory. */
async function reconcileInventory() {
  const mismatches = await prisma.$queryRaw<Array<{ id: string; code: string; name: string; ledger: number; cache: number }>>`
    SELECT r."id", r."code", r."name", COALESCE(SUM(m."quantity"), 0)::float8 AS "ledger", r."currentQuantity"::float8 AS "cache"
    FROM "Resource" r LEFT JOIN "InventoryMovement" m ON m."resourceId" = r."id"
    GROUP BY r."id", r."code", r."name", r."currentQuantity"
    HAVING COALESCE(SUM(m."quantity"), 0) <> r."currentQuantity" ORDER BY r."name"
  `;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const managers = mismatches.length ? await prisma.user.findMany({ where: { revokedAt: null, roles: { some: { role: { code: { in: ["SUPER_ADMIN", "KOEKI_MANAGER"] } } } } }, select: { id: true } }) : [];
  let alerted = 0;
  for (const row of mismatches) {
    const already = await prisma.auditLog.findFirst({ where: { action: "INVENTORY_RECONCILIATION_MISMATCH", entityType: "Resource", entityId: row.id, createdAt: { gte: startOfDay } } });
    if (already) continue;
    await prisma.auditLog.create({ data: { action: "INVENTORY_RECONCILIATION_MISMATCH", entityType: "Resource", entityId: row.id, requestId: randomUUID(), reason: `${row.code} : ledger ${row.ledger} ≠ stock affiché ${row.cache}`, newValues: { ledger: row.ledger, cache: row.cache } } });
    for (const manager of managers) await prisma.notification.create({ data: { userId: manager.id, title: `Inventaire incohérent : ${row.name}`, body: `La somme des mouvements (${row.ledger}) diffère du stock affiché (${row.cache}). Vérifiez et réalignez depuis la page Inventaire.` } });
    alerted++;
  }
  return { command: "inventory:reconcile", mismatches: mismatches.map((row) => ({ code: row.code, ledger: row.ledger, cache: row.cache })), alerted };
}

const commands: Record<string, () => Promise<unknown>> = {
  "taxes:generate": generateTaxes,
  "taxes:statuses": () => refreshTaxStatuses(prisma),
  "penalties:apply": applyPenalties,
  "reminders:send": sendReminders,
  "inventory:check": checkInventory,
  "inventory:reconcile": reconcileInventory,
  "stats:refresh": refreshStats,
  "ranking:close": () => closeCompletedRankings(prisma)
};
async function main() {
  const command = process.argv[2] ?? "all";
  if (command === "taxes:recover") { console.log(JSON.stringify(await recoverTaxes())); return; }
  if (process.argv.length > 3) throw new Error("Unexpected worker arguments");
  const selected = command === "all" ? Object.entries(commands) : [[command, commands[command]] as const];
  if (selected.some(([, run]) => !run)) throw new Error(`Unknown worker command: ${command}`);
  const startedAt = new Date().toISOString(), failures: string[] = [];
  console.log(JSON.stringify({ command: "worker:started", requested: command, startedAt }));
  for (const [name, run] of selected) {
    try { console.log(JSON.stringify(await run!())); }
    catch (error) { failures.push(name); console.error(JSON.stringify({ command: name, failed: true, message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
  }
  const value = { startedAt, finishedAt: new Date().toISOString(), requested: command, success: failures.length === 0, failures };
  if (command === "all") await prisma.appSetting.upsert({ where: { key: "workerHealth" }, create: { key: "workerHealth", value }, update: { value, version: { increment: 1 } } });
  console.log(JSON.stringify({ command: "worker:finished", ...value }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
