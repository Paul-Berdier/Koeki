import { Prisma, prisma } from "@koeki/database";
import { calculateNextPenalty, createRpTimeService, defaultRpTimeConfig, ryo } from "@koeki/domain";

async function generateTaxes() {
  const service = createRpTimeService(defaultRpTimeConfig), rpYear = service.currentRpYear();
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
  const service = createRpTimeService(defaultRpTimeConfig);
  const assessments = await prisma.taxAssessment.findMany({ where: { status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] }, dueAt: { lt: new Date() } }, include: { penalties: true, allocations: true, adjustments: true } });
  let created = 0;
  for (const assessment of assessments) {
    const paid = assessment.allocations.reduce((sum, item) => sum + item.amount, 0n);
    const adjustments = assessment.adjustments.reduce((sum, item) => sum + item.amount, 0n);
    const penaltyTotal = assessment.penalties.reduce((sum, item) => sum + item.amount, 0n);
    const remainingPrincipal = assessment.originalAmount > paid ? assessment.originalAmount - paid : 0n;
    const currentDebt = remainingPrincipal + penaltyTotal + adjustments;
    const decision = calculateNextPenalty({ originalTax: ryo(assessment.originalAmount), remainingPrincipal: ryo(remainingPrincipal), currentDebt: ryo(currentDebt), appliedPenaltyIndexes: assessment.penalties.map((item) => item.applicationIndex), completeLateYears: service.completeLateYears(assessment.dueAt) }, { latePenaltyPercentBps: config.latePenaltyPercentBps, latePenaltyBasis: config.latePenaltyBasis ?? "ORIGINAL_TAX", latePenaltyFrequencyRpYears: config.latePenaltyFrequencyRpYears ?? 1, maxPenaltyApplications: config.maxPenaltyApplications ?? 4, maxAssessmentDebt: ryo(config.maxAssessmentDebt ?? "32000"), isPenaltyAutomationEnabled: true, isRateValidated: true });
    if (!decision || decision.amount === 0n) continue;
    try { await prisma.taxPenalty.create({ data: { assessmentId: assessment.id, applicationIndex: decision.index, rpYearApplied: service.currentRpYear(), percentBps: config.latePenaltyPercentBps, basis: config.latePenaltyBasis ?? "ORIGINAL_TAX", basisAmount: assessment.originalAmount, amount: decision.amount } }); created++; }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error; }
  }
  return { command: "penalties:apply", created, disabled: false };
}

async function sendReminders() { return { command: "reminders:send", eligible: await prisma.taxAssessment.count({ where: { status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID"] } } }) }; }
async function checkInventory() { return { command: "inventory:check", checked: await prisma.resource.count({ where: { isActive: true } }) }; }
async function refreshStats() { await prisma.appSetting.upsert({ where: { key: "statsLastRefreshedAt" }, create: { key: "statsLastRefreshedAt", value: { at: new Date().toISOString() } }, update: { value: { at: new Date().toISOString() }, version: { increment: 1 } } }); return { command: "stats:refresh", refreshed: true }; }
const commands: Record<string, () => Promise<unknown>> = { "taxes:generate": generateTaxes, "penalties:apply": applyPenalties, "reminders:send": sendReminders, "inventory:check": checkInventory, "stats:refresh": refreshStats };
async function main() { const command = process.argv[2] ?? "all"; const selected = command === "all" ? Object.values(commands) : [commands[command]]; if (selected.some((item) => !item)) throw new Error(`Unknown worker command: ${command}`); for (const run of selected) console.log(JSON.stringify(await run!())); }
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
