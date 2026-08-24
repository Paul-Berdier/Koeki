import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, RoleCode, TaxAssessmentStatus } from "@prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public" }) });
const gradeSeed = [
  ["UNKNOWN", "Non renseigné", 0],
  ["GENIN_APPRENTICE", "Genin apprenti", 0], ["GENIN", "Genin simple", 0], ["GENIN_CONFIRMED", "Genin confirmé", 10_000],
  ["CHUNIN", "Chunin", 15_000], ["KONIN", "Konin", 20_000], ["TOKUBETSU_JONIN", "Tokubetsu Jonin", 25_000],
  ["JONIN", "Jonin", 25_000], ["JONIN_COMMANDER", "Commandant Jonin", 25_000], ["KAGE", "Kage", 0], ["SANIN", "Sanin", 0]
] as const;
const ninjaSeed = [
  ["NIN-000041", "Aoki", "Hoki", "CHUNIN", "La Cigale"], ["NIN-000058", "Araki", "Hoki", "JONIN", null],
  ["NIN-000063", "Inao", "Hoki", "GENIN_CONFIRMED", "Sirocco"], ["NIN-000072", "Izen", "Hoki", "TOKUBETSU_JONIN", null],
  ["NIN-000087", "Kagami", "Hoki", "KONIN", "L’Œil du désert"], ["NIN-000094", "Tao", "Hoki", "JONIN", null],
  ["NIN-000109", "Yukiro", "Hoki", "CHUNIN", null]
] as const;

async function main() {
  const roles = new Map<RoleCode, string>();
  for (const code of Object.values(RoleCode)) { const role = await prisma.role.upsert({ where: { code }, create: { code, label: code.replaceAll("_", " ") }, update: {} }); roles.set(code, role.id); }
  const admin = await prisma.user.upsert({ where: { email: "admin.dev@koeki.local" }, create: { email: "admin.dev@koeki.local", name: "Sonemi Hakumei" }, update: {} });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: roles.get("SUPER_ADMIN")! } }, create: { userId: admin.id, roleId: roles.get("SUPER_ADMIN")! }, update: {} });
  const grades = new Map<string, { id: string; amount: bigint; label: string }>();
  for (const [code, label, amount] of gradeSeed) { const grade = await prisma.ninjaGrade.upsert({ where: { code }, create: { code, label, sortOrder: grades.size }, update: { label } }); grades.set(code, { id: grade.id, amount: BigInt(amount), label }); }
  const policy = await prisma.taxPolicy.upsert({ where: { name_version: { name: "Barème initial", version: 1 } }, create: { name: "Barème initial", version: 1, effectiveFromRpYear: 1, isActive: true }, update: { isActive: true } });
  for (const grade of grades.values()) await prisma.taxPolicyGradeRate.upsert({ where: { taxPolicyId_gradeId: { taxPolicyId: policy.id, gradeId: grade.id } }, create: { taxPolicyId: policy.id, gradeId: grade.id, amount: grade.amount }, update: { amount: grade.amount } });
  const ninjas = new Map<string, string>();
  for (const [code, firstName, lastName, gradeCode, alias] of ninjaSeed) { const ninja = await prisma.ninjaProfile.upsert({ where: { code }, create: { code, firstName, lastName, alias, currentGradeId: grades.get(gradeCode)!.id }, update: { firstName, lastName, alias, currentGradeId: grades.get(gradeCode)!.id } }); ninjas.set(code, ninja.id); }
  for (const rpYear of [46, 47, 48]) {
    const taxYear = await prisma.taxYear.upsert({ where: { rpYear }, create: { rpYear, taxPolicyId: policy.id, startsAt: new Date(`2026-0${rpYear - 45}-01T00:00:00Z`), endsAt: new Date(`2026-0${rpYear - 45}-07T23:59:59Z`), dueAt: new Date(`2026-0${rpYear - 45}-04T00:00:00Z`), generatedAt: new Date() }, update: {} });
    for (const [code,,, gradeCode] of ninjaSeed) {
      const overdue = rpYear < 48 && ["NIN-000058", "NIN-000087", "NIN-000094"].includes(code);
      await prisma.taxAssessment.upsert({ where: { ninjaId_taxYearId: { ninjaId: ninjas.get(code)!, taxYearId: taxYear.id } }, create: { ninjaId: ninjas.get(code)!, taxYearId: taxYear.id, taxPolicyId: policy.id, gradeCodeSnapshot: gradeCode, gradeLabelSnapshot: grades.get(gradeCode)!.label, originalAmount: grades.get(gradeCode)!.amount, dueAt: taxYear.dueAt, status: overdue ? TaxAssessmentStatus.OVERDUE : TaxAssessmentStatus.PAID }, update: {} });
    }
  }
  const mineral = await prisma.resourceCategory.upsert({ where: { code: "MINERALS" }, create: { code: "MINERALS", label: "Minerais" }, update: {} });
  const textile = await prisma.resourceCategory.upsert({ where: { code: "TEXTILES" }, create: { code: "TEXTILES", label: "Textiles" }, update: {} });
  const copper = await prisma.resource.upsert({ where: { code: "RES-CUI-01" }, create: { code: "RES-CUI-01", name: "Minerai de cuivre", categoryId: mineral.id, minimumStock: 25, criticalStock: 10 }, update: {} });
  const fabric = await prisma.resource.upsert({ where: { code: "RES-TIS-03" }, create: { code: "RES-TIS-03", name: "Tissu renforcé", categoryId: textile.id, minimumStock: 20, criticalStock: 12 }, update: {} });
  for (const [resource, price] of [[copper, 180n], [fabric, 320n]] as const) await prisma.resourcePriceHistory.upsert({ where: { resourceId_effectiveFrom: { resourceId: resource.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") } }, create: { resourceId: resource.id, pricePerUnit: price, effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdById: admin.id }, update: {} });
  await prisma.inventoryMovement.upsert({ where: { idempotencyKey: "seed-copper-opening" }, create: { resourceId: copper.id, type: "MANUAL_ADJUSTMENT", quantity: 82, agentId: admin.id, justification: "Stock initial fictif", idempotencyKey: "seed-copper-opening" }, update: {} });
  await prisma.inventoryMovement.upsert({ where: { idempotencyKey: "seed-fabric-opening" }, create: { resourceId: fabric.id, type: "MANUAL_ADJUSTMENT", quantity: 9, agentId: admin.id, justification: "Stock initial fictif", idempotencyKey: "seed-fabric-opening" }, update: {} });
  await prisma.appSetting.upsert({ where: { key: "latePenalty" }, create: { key: "latePenalty", value: { latePenaltyPercentBps: null, latePenaltyBasis: "ORIGINAL_TAX", latePenaltyFrequencyRpYears: 1, maxPenaltyApplications: 4, maxAssessmentDebt: "32000", isPenaltyAutomationEnabled: false, isRateValidated: false } }, update: {} });
  await prisma.appSetting.upsert({ where: { key: "exemptionPolicy" }, create: { key: "exemptionPolicy", value: { weeklyTaxCoverageBps: 0 } }, update: {} });
  await prisma.appSetting.upsert({ where: { key: "rpTime" }, create: { key: "rpTime", value: { realAnchorAt: "2026-01-05T00:00:00.000Z", rpAnchorYear: 20, realMillisecondsPerRpYear: 604800000, timezone: "Europe/Paris", fiscalYearStartOffsetMs: 0, dueDelayMs: 259200000 } }, update: {} });
  console.log("Kōeki demo seed complete", { ninjas: ninjas.size, grades: grades.size });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
