// Production bootstrap: reference data only — no fictional ninjas, taxes or stocks.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, RoleCode } from "@prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public" }) });
const gradeSeed = [
  ["UNKNOWN", "Non renseigné", 0],
  ["GENIN_APPRENTICE", "Genin apprenti", 0], ["GENIN", "Genin simple", 0], ["GENIN_CONFIRMED", "Genin confirmé", 10_000],
  ["CHUNIN", "Chunin", 15_000], ["KONIN", "Konin", 20_000], ["TOKUBETSU_JONIN", "Tokubetsu Jonin", 25_000],
  ["JONIN", "Jonin", 25_000], ["JONIN_COMMANDER", "Commandant Jonin", 25_000], ["KAGE", "Kage", 0], ["SANIN", "Sanin", 0]
] as const;
const categorySeed = [
  ["MINERALS", "Minerais"], ["METALS", "Métaux"], ["WOOD", "Bois"], ["PLANTS", "Plantes"], ["MEDICAL", "Composants médicaux"],
  ["TEXTILES", "Tissus"], ["LEATHER", "Cuirs"], ["CRYSTALS", "Cristaux"], ["POISONS", "Poisons"], ["SCROLLS", "Parchemins"],
  ["WEAPONS", "Armes"], ["EQUIPMENT", "Équipement"], ["RARE", "Objets rares"], ["FOOD", "Ressources alimentaires"], ["CONSTRUCTION", "Matériaux de construction"], ["OTHER", "Autres"]
] as const;

async function main() {
  const roles = new Map<RoleCode, string>();
  for (const code of Object.values(RoleCode)) { const role = await prisma.role.upsert({ where: { code }, create: { code, label: code.replaceAll("_", " ") }, update: {} }); roles.set(code, role.id); }
  const admin = await prisma.user.upsert({ where: { email: "systeme@koeki.local" }, create: { email: "systeme@koeki.local", name: "Administration Kōeki" }, update: {} });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: roles.get("SUPER_ADMIN")! } }, create: { userId: admin.id, roleId: roles.get("SUPER_ADMIN")! }, update: {} });
  const grades = new Map<string, { id: string; amount: bigint }>();
  for (const [code, label, amount] of gradeSeed) { const grade = await prisma.ninjaGrade.upsert({ where: { code }, create: { code, label, sortOrder: grades.size }, update: { label } }); grades.set(code, { id: grade.id, amount: BigInt(amount) }); }
  const policy = await prisma.taxPolicy.upsert({ where: { name_version: { name: "Barème initial", version: 1 } }, create: { name: "Barème initial", version: 1, effectiveFromRpYear: 1, isActive: true }, update: {} });
  for (const grade of grades.values()) await prisma.taxPolicyGradeRate.upsert({ where: { taxPolicyId_gradeId: { taxPolicyId: policy.id, gradeId: grade.id } }, create: { taxPolicyId: policy.id, gradeId: grade.id, amount: grade.amount }, update: {} });
  for (const [code, label] of categorySeed) await prisma.resourceCategory.upsert({ where: { code }, create: { code, label }, update: { label } });
  await prisma.appSetting.upsert({ where: { key: "latePenalty" }, create: { key: "latePenalty", value: { latePenaltyPercentBps: null, latePenaltyBasis: "ORIGINAL_TAX", latePenaltyFrequencyRpYears: 1, maxPenaltyApplications: 4, maxAssessmentDebt: "32000", isPenaltyAutomationEnabled: false, isRateValidated: false } }, update: {} });
  // Cadence RP : 1 jour réel = 1 mois RP, 1 semaine réelle = 1 année RP. L'année bascule le
  // dimanche à minuit (Europe/Paris) — c'est aussi l'échéance de paiement (dueDelay = année entière).
  const sundayMidnightConfig = { realAnchorAt: "2026-01-04T23:00:00.000Z", rpAnchorYear: 20, realMillisecondsPerRpYear: 604800000, timezone: "Europe/Paris", fiscalYearStartOffsetMs: 0, dueDelayMs: 604800000 };
  const currentRp = await prisma.appSetting.findUnique({ where: { key: "rpTime" } });
  const legacyRp = currentRp?.value as { realAnchorAt?: string; dueDelayMs?: number } | undefined;
  if (!currentRp) await prisma.appSetting.create({ data: { key: "rpTime", value: sundayMidnightConfig } });
  else if (legacyRp?.realAnchorAt === "2026-01-05T00:00:00.000Z" && legacyRp?.dueDelayMs === 259200000) await prisma.appSetting.update({ where: { key: "rpTime" }, data: { value: sundayMidnightConfig, version: { increment: 1 } } });
  await prisma.appSetting.upsert({ where: { key: "approvalThreshold" }, create: { key: "approvalThreshold", value: { amount: "50000", isValidated: false } }, update: {} });
  // Inactive templates: managers must review and activate point rules explicitly — no silent game-balance defaults.
  const pointRuleSeed = [
    { name: "Points de paiement de taxe", eventType: "TAX_PAYMENT", mode: "PER_AMOUNT", amountStep: 1000n, pointsPerStep: 10 },
    { name: "Bonus de paiement dans les délais", eventType: "ON_TIME_PAYMENT", mode: "FIXED", fixedPoints: 100 },
    { name: "Points de don", eventType: "DONATION", mode: "PER_AMOUNT", amountStep: 1000n, pointsPerStep: 15 },
    { name: "Points de vente de ressources", eventType: "RESOURCE_SALE", mode: "PER_AMOUNT", amountStep: 1000n, pointsPerStep: 5 }
  ] as const;
  for (const rule of pointRuleSeed) {
    const existing = await prisma.pointRule.findFirst({ where: { name: rule.name } });
    if (!existing) await prisma.pointRule.create({ data: { name: rule.name, eventType: rule.eventType, mode: rule.mode, fixedPoints: "fixedPoints" in rule ? rule.fixedPoints : null, amountStep: "amountStep" in rule ? rule.amountStep : null, pointsPerStep: "pointsPerStep" in rule ? rule.pointsPerStep : null, startsAt: new Date("2026-01-01T00:00:00Z"), isActive: false } });
  }
  console.log("Kōeki production bootstrap complete", { roles: roles.size, grades: grades.size });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
