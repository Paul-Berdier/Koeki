import { Prisma, prisma } from "@koeki/database";
import { calculateNextPenalty, createRpTimeService, defaultRpTimeConfig, rpTimeConfigSchema, ryo } from "@koeki/domain";

async function rpService() {
  const setting = await prisma.appSetting.findUnique({ where: { key: "rpTime" } });
  const parsed = setting ? rpTimeConfigSchema.safeParse(setting.value) : null;
  return createRpTimeService(parsed?.success ? parsed.data : defaultRpTimeConfig);
}

async function generateTaxes() {
  const service = await rpService(), rpYear = service.currentRpYear();
  const policy = await prisma.taxPolicy.findFirst({ where: { isActive: true }, include: { rates: { include: { grade: true } } } });
  if (!policy) throw new Error("No active tax policy");
  const taxYear = await prisma.taxYear.upsert({ where: { rpYear }, create: { rpYear, taxPolicyId: policy.id, startsAt: service.startOfRpYear(rpYear), endsAt: service.endOfRpYear(rpYear), dueAt: service.dueAt(rpYear), generatedAt: new Date() }, update: {} });
  const ninjas = await prisma.ninjaProfile.findMany({ where: { status: "ACTIVE" }, include: { currentGrade: true } });
  const rates = new Map(policy.rates.map((rate) => [rate.gradeId, rate.amount]));
  const result = await prisma.taxAssessment.createMany({ data: ninjas.map((ninja) => ({ ninjaId: ninja.id, taxYearId: taxYear.id, taxPolicyId: policy.id, gradeCodeSnapshot: ninja.currentGrade.code, gradeLabelSnapshot: ninja.currentGrade.label, originalAmount: rates.get(ninja.currentGradeId) ?? 0n, dueAt: taxYear.dueAt, status: taxYear.dueAt > new Date() ? "UPCOMING" : "DUE" })), skipDuplicates: true });
  return { command: "taxes:generate", rpYear, created: result.count };
}

async function applyPenalties() {
  const setting = await prisma.appSetting.findUnique({ where: { key: "latePenalty" } });
  const config = setting?.value as { latePenaltyPercentBps?: number; latePenaltyBasis?: "ORIGINAL_TAX"|"REMAINING_PRINCIPAL"|"CURRENT_DEBT"; latePenaltyFrequencyRpYears?: number; maxPenaltyApplications?: number; maxAssessmentDebt?: string; isPenaltyAutomationEnabled?: boolean; isRateValidated?: boolean } | undefined;
  if (!config?.isPenaltyAutomationEnabled || !config.isRateValidated || !config.latePenaltyPercentBps) return { command: "penalties:apply", created: 0, disabled: true };
  const service = await rpService();
  const assessments = await prisma.taxAssessment.findMany({ where: { status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] }, dueAt: { lt: new Date() } }, include: { penalties: true, allocations: { include: { payment: { select: { status: true } } } }, adjustments: true } });
  let created = 0;
  for (const assessment of assessments) {
    const paid = assessment.allocations.filter((item) => item.payment.status === "VALIDATED").reduce((sum, item) => sum + item.amount, 0n);
    const adjustments = assessment.adjustments.reduce((sum, item) => sum + item.amount, 0n);
    const penaltyTotal = assessment.penalties.reduce((sum, item) => sum + item.amount, 0n);
    const remainingPrincipal = assessment.originalAmount > paid ? assessment.originalAmount - paid : 0n;
    const currentDebt = remainingPrincipal + penaltyTotal + adjustments;
    const decision = calculateNextPenalty({ originalTax: ryo(assessment.originalAmount), remainingPrincipal: ryo(remainingPrincipal), currentDebt: ryo(currentDebt < 0n ? 0n : currentDebt), appliedPenaltyIndexes: assessment.penalties.map((item) => item.applicationIndex), completeLateYears: service.completeLateYears(assessment.dueAt) }, { latePenaltyPercentBps: config.latePenaltyPercentBps, latePenaltyBasis: config.latePenaltyBasis ?? "ORIGINAL_TAX", latePenaltyFrequencyRpYears: config.latePenaltyFrequencyRpYears ?? 1, maxPenaltyApplications: config.maxPenaltyApplications ?? 4, maxAssessmentDebt: ryo(config.maxAssessmentDebt ?? "32000"), isPenaltyAutomationEnabled: true, isRateValidated: true });
    if (!decision || decision.amount === 0n) continue;
    try { await prisma.taxPenalty.create({ data: { assessmentId: assessment.id, applicationIndex: decision.index, rpYearApplied: service.currentRpYear(), percentBps: config.latePenaltyPercentBps, basis: config.latePenaltyBasis ?? "ORIGINAL_TAX", basisAmount: assessment.originalAmount, amount: decision.amount } }); created++; }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error; }
  }
  return { command: "penalties:apply", created, disabled: false };
}

const assessmentStatusLabels: Record<string, string> = { DUE: "à payer", OVERDUE: "en retard", PARTIALLY_PAID: "partiellement payée" };

async function sendReminders() {
  const swept = await prisma.taxAssessment.updateMany({ where: { dueAt: { lt: new Date() }, status: { in: ["UPCOMING", "DUE"] } }, data: { status: "OVERDUE" } });
  const assessments = await prisma.taxAssessment.findMany({ where: { status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID"] } }, include: { ninja: { select: { userId: true, firstName: true, lastName: true } }, taxYear: { select: { rpYear: true } } } });
  let sent = 0;
  for (const assessment of assessments) {
    if (!assessment.ninja.userId) continue;
    const title = `Taxe année RP ${assessment.taxYear.rpYear} ${assessmentStatusLabels[assessment.status] ?? "à traiter"}`;
    const existing = await prisma.notification.findFirst({ where: { userId: assessment.ninja.userId, title, status: "UNREAD" } });
    if (existing) continue;
    await prisma.notification.create({ data: { userId: assessment.ninja.userId, title, body: `Le service économique de Suna vous rappelle votre taxe de l’année RP ${assessment.taxYear.rpYear} (échéance ${assessment.dueAt.toISOString().slice(0, 10)}).` } });
    sent++;
  }
  return { command: "reminders:send", eligible: assessments.length, sent, statusSweep: swept.count };
}

async function checkInventory() {
  const resources = await prisma.resource.findMany({ where: { isActive: true }, include: { unit: true } });
  const grouped = await prisma.inventoryMovement.groupBy({ by: ["resourceId"], _sum: { quantity: true } });
  const stocks = new Map(grouped.map((entry) => [entry.resourceId, Number(entry._sum.quantity ?? 0)]));
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const managers = await prisma.user.findMany({ where: { revokedAt: null, roles: { some: { role: { code: { in: ["SUPER_ADMIN", "KOEKI_MANAGER"] } } } } }, select: { id: true } });
  const alerts: Array<{ resource: string; stock: number; level: string }> = [];
  for (const resource of resources) {
    const stock = stocks.get(resource.id) ?? 0;
    const level = stock <= Number(resource.criticalStock) ? "critical" : stock <= Number(resource.minimumStock) ? "low" : null;
    if (!level) continue;
    alerts.push({ resource: resource.code, stock, level });
    const already = await prisma.auditLog.findFirst({ where: { action: "INVENTORY_ALERT", entityType: "Resource", entityId: resource.id, createdAt: { gte: startOfDay } } });
    if (already) continue;
    await prisma.auditLog.create({ data: { action: "INVENTORY_ALERT", entityType: "Resource", entityId: resource.id, reason: `Seuil ${level === "critical" ? "critique" : "bas"} atteint : ${stock} ${resource.unit.symbol}`, requestId: crypto.randomUUID() } });
    for (const manager of managers) await prisma.notification.create({ data: { userId: manager.id, title: `Stock ${level === "critical" ? "critique" : "bas"} : ${resource.name}`, body: `${resource.name} — ${stock} ${resource.unit.symbol} restants (seuil ${level === "critical" ? "critique" : "bas"} : ${Number(level === "critical" ? resource.criticalStock : resource.minimumStock)}).` } });
  }
  return { command: "inventory:check", checked: resources.length, alerts };
}

async function refreshStats() {
  const service = await rpService(), rpYear = service.currentRpYear();
  const assessments = await prisma.taxAssessment.findMany({ where: { taxYear: { rpYear }, status: { notIn: ["EXEMPT", "WAIVED", "SUSPENDED", "CANCELLED", "DRAFT"] } }, include: { penalties: true, adjustments: true, exemptions: true, allocations: { include: { payment: { select: { status: true } } } } } });
  let expected = 0n, collected = 0n;
  for (const assessment of assessments) {
    expected += assessment.originalAmount + assessment.penalties.reduce((sum, item) => sum + item.amount, 0n) + assessment.adjustments.reduce((sum, item) => sum + item.amount, 0n) - assessment.exemptions.reduce((sum, item) => sum + item.amount, 0n);
    collected += assessment.allocations.filter((item) => item.payment.status === "VALIDATED").reduce((sum, item) => sum + item.amount, 0n);
  }
  const [payments, transactions] = await Promise.all([
    prisma.taxPayment.count({ where: { status: "VALIDATED" } }),
    prisma.resourceTransaction.count({ where: { status: "VALIDATED" } })
  ]);
  const value = { refreshedAt: new Date().toISOString(), rpYear, expected: String(expected), collected: String(collected), recoveryRateBps: expected > 0n ? Number((collected * 10_000n) / expected) : 0, payments, transactions };
  await prisma.appSetting.upsert({ where: { key: "statsSnapshot" }, create: { key: "statsSnapshot", value }, update: { value, version: { increment: 1 } } });
  return { command: "stats:refresh", ...value };
}

const commands: Record<string, () => Promise<unknown>> = { "taxes:generate": generateTaxes, "penalties:apply": applyPenalties, "reminders:send": sendReminders, "inventory:check": checkInventory, "stats:refresh": refreshStats };
async function main() { const command = process.argv[2] ?? "all"; const selected = command === "all" ? Object.values(commands) : [commands[command]]; if (selected.some((item) => !item)) throw new Error(`Unknown worker command: ${command}`); for (const run of selected) console.log(JSON.stringify(await run!())); }
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
