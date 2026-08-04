// One-shot migration of the old register (export of 2026-07-30): purges every test
// record, then imports the resource catalog, 349 ninjas and 2 279 historical donations.
// Guarded by an AppSetting flag so redeploys never replay it.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public" }) });
const FLAG = "legacyImport2026-07-30";

interface CatalogEntry { name: string; key: string; category: string; price: number | null; description: string }
interface NinjaEntry { id: number; firstName: string; lastName: string; points: number; exemptions: number; createdAt: string; taxSummary: { paid: number; advance: number; unpaid: number } }
interface DonEntry { id: number; ninjaId: number; resource: string; quantity: number; points: number; value: number; date: string }
interface TaxEntry { id: number; ninjaId: number; sunday: string; paid: boolean }

const loadJson = <T>(file: string): T => JSON.parse(readFileSync(join(__dirname, "..", "data", "import", file), "utf8")) as T;
const codeBase = (name: string) => name.normalize("NFD").replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");

async function importCore() {
  if (await prisma.appSetting.findUnique({ where: { key: FLAG } })) { console.log("import-legacy : déjà appliqué — rien à faire"); return; }
  const [genin, categories, unit, systemUser] = await Promise.all([
    prisma.ninjaGrade.findUnique({ where: { code: "GENIN" } }),
    prisma.resourceCategory.findMany(),
    prisma.resourceUnit.findUnique({ where: { code: "UNIT" } }),
    prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } })
  ]);
  if (!genin || !unit || !systemUser || !categories.length) { console.log("import-legacy : référentiels absents — exécutez d’abord le bootstrap"); return; }
  const categoryByCode = new Map(categories.map((category) => [category.code, category.id]));
  const catalog = loadJson<{ resources: CatalogEntry[]; equipment: CatalogEntry[] }>("catalog.json");
  const ninjas = loadJson<NinjaEntry[]>("ninjas.json");
  const dons = loadJson<DonEntry[]>("dons.json");

  // Atomic: either the whole migration lands, or the base stays untouched.
  const stats = await prisma.$transaction(async (tx) => {
    // Purge: everything ninja/transaction-related in the current base is test data.
    await tx.invitation.updateMany({ where: { ninjaProfileId: { not: null } }, data: { ninjaProfileId: null } });
    await tx.taxPaymentAllocation.deleteMany({});
    await tx.taxAdjustment.deleteMany({});
    await tx.taxExemption.deleteMany({});
    await tx.taxPenalty.deleteMany({});
    await tx.taxPayment.deleteMany({});
    await tx.taxAssessment.deleteMany({});
    await tx.pointLedgerEntry.deleteMany({});
    await tx.inventoryMovement.deleteMany({ where: { transactionId: { not: null } } });
    await tx.resourceTransactionItem.deleteMany({});
    await tx.resourceTransaction.deleteMany({});
    await tx.ninjaGradeHistory.deleteMany({});
    await tx.ninjaProfile.deleteMany({});

    // Resource catalog (kept if already present with the same name).
    const resourceIdByKey = new Map<string, string>();
    const usedCodes = new Set((await tx.resource.findMany({ select: { code: true } })).map((resource) => resource.code));
    for (const entry of [...catalog.resources, ...catalog.equipment]) {
      const existing = await tx.resource.findFirst({ where: { name: entry.name } });
      if (existing) { resourceIdByKey.set(entry.key, existing.id); continue; }
      const base = codeBase(entry.name);
      let code = "", suffix = 1;
      do { code = `RES-${base}-${String(suffix++).padStart(2, "0")}`; } while (usedCodes.has(code));
      usedCodes.add(code);
      const resource = await tx.resource.create({ data: {
        code, name: entry.name, description: entry.description, categoryId: categoryByCode.get(entry.category) ?? categoryByCode.get("OTHER")!,
        unitId: unit.id, minimumStock: new Prisma.Decimal(0), criticalStock: new Prisma.Decimal(0)
      } });
      if (entry.price !== null && entry.price > 0) await tx.resourcePriceHistory.create({ data: { resourceId: resource.id, pricePerUnit: BigInt(entry.price), effectiveFrom: new Date("2026-07-30T00:00:00Z"), createdById: systemUser.id } });
      resourceIdByKey.set(entry.key, resource.id);
    }

    // Ninjas.
    const profileIdByExternal = new Map<number, string>();
    let totalPoints = 0;
    for (const ninja of ninjas) {
      const createdAt = new Date(ninja.createdAt);
      const notes: string[] = [];
      if (ninja.exemptions !== 0) notes.push(`exonérations cumulées : ${ninja.exemptions.toLocaleString("fr-FR")} ¥`);
      if (ninja.taxSummary.paid || ninja.taxSummary.unpaid) notes.push(`taxes hebdomadaires : ${ninja.taxSummary.paid} payées${ninja.taxSummary.advance ? ` (dont ${ninja.taxSummary.advance} d’avance)` : ""}, ${ninja.taxSummary.unpaid} impayées`);
      const profile = await tx.ninjaProfile.create({ data: {
        code: `NIN-${String(ninja.id).padStart(6, "0")}`, firstName: ninja.firstName, lastName: ninja.lastName,
        currentGradeId: genin.id, createdAt, notes: notes.length ? `Import de l’ancien registre (30/07/2026) — ${notes.join(" · ")}` : null
      } });
      await tx.ninjaGradeHistory.create({ data: { ninjaId: profile.id, gradeId: genin.id, effectiveFrom: createdAt, reason: "Import de l’ancien registre (grade à confirmer)" } });
      if (ninja.points !== 0) { await tx.pointLedgerEntry.create({ data: { ninjaId: profile.id, eventType: "MANUAL_ADJUSTMENT", points: ninja.points, sourceType: "Import", sourceId: `${FLAG}:${ninja.id}`, reason: "Reprise du solde de points de l’ancien registre" } }); totalPoints += ninja.points; }
      profileIdByExternal.set(ninja.id, profile.id);
    }

    // Historical donations: validated transactions with their original dates. No inventory
    // movements (the goods were consumed long ago) and no point ledger entries (the imported
    // balance already includes them) — points stay visible on each receipt.
    const donRows = dons.filter((don) => profileIdByExternal.has(don.ninjaId) && resourceIdByKey.has(don.resource));
    await tx.resourceTransaction.createMany({ data: donRows.map((don) => ({
      id: `imp-don-${don.id}`, receiptNumber: `DON-IMP-${String(don.id).padStart(6, "0")}`, type: "DONATION" as const, status: "VALIDATED" as const,
      ninjaId: profileIdByExternal.get(don.ninjaId)!, agentId: systemUser.id, totalAmount: BigInt(Math.max(0, don.value)), totalPoints: don.points,
      idempotencyKey: `imp-don-${don.id}`, validatedAt: new Date(don.date), createdAt: new Date(don.date)
    })), skipDuplicates: true });
    await tx.resourceTransactionItem.createMany({ data: donRows.map((don) => ({
      transactionId: `imp-don-${don.id}`, resourceId: resourceIdByKey.get(don.resource)!, quantity: new Prisma.Decimal(don.quantity),
      unitPriceSnapshot: don.quantity > 0 ? BigInt(Math.max(0, Math.round(don.value / don.quantity))) : 0n, lineTotal: BigInt(Math.max(0, don.value))
    })) });

    await tx.appSetting.create({ data: { key: FLAG, value: { importedAt: new Date().toISOString(), ninjas: ninjas.length, dons: donRows.length } } });
    await tx.auditLog.create({ data: { action: "LEGACY_IMPORT", entityType: "NinjaProfile", entityId: FLAG, requestId: randomUUID(), reason: `Import de l’ancien registre : ${ninjas.length} ninjas, ${donRows.length} dons, ${resourceIdByKey.size} ressources — données de test purgées`, newValues: { ninjas: ninjas.length, dons: donRows.length, resources: resourceIdByKey.size, totalPoints } } });
    return { dons: donRows.length, resources: resourceIdByKey.size };
  }, { timeout: 300_000, maxWait: 30_000 });
  console.log(`import-legacy : ${ninjas.length} ninjas, ${stats.dons} dons, ${stats.resources} ressources importés — grades par défaut Genin simple, à corriger`);
}

/** Weekly tax history from the old register: zero-amount assessments under a dedicated
 *  inactive policy — paid weeks show as "Payée", missed weeks as "En retard", without
 *  creating any monetary debt (the export has no amounts). */
async function importTaxHistory() {
  const FLAG_TAXES = "legacyTaxes2026-07-30";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_TAXES } })) { console.log("import-legacy/taxes : déjà appliqué"); return; }
  const taxes = loadJson<TaxEntry[]>("taxes.json");
  const profiles = await prisma.ninjaProfile.findMany({ select: { id: true, code: true } });
  const byExternal = new Map(profiles.filter((profile) => /^NIN-\d{6}$/.test(profile.code)).map((profile) => [Number(profile.code.slice(4)), profile.id]));
  const anchor = Date.UTC(2026, 0, 4, 23, 0, 0);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const policy = await tx.taxPolicy.upsert({ where: { name_version: { name: "Ancien registre", version: 1 } }, create: { name: "Ancien registre", version: 1, effectiveFromRpYear: 0, isActive: false }, update: {} });
    const weekBySunday = new Map<string, { yearId: string; dueAt: Date }>();
    for (const sunday of [...new Set(taxes.map((tax) => tax.sunday))].sort()) {
      const dueAt = new Date(`${sunday}T22:00:00.000Z`);
      const rpYear = 20 + Math.round((dueAt.getTime() - 604_800_000 - anchor) / 604_800_000);
      const existing = await tx.taxYear.findUnique({ where: { rpYear } });
      const year = existing ?? await tx.taxYear.create({ data: { rpYear, taxPolicyId: policy.id, startsAt: new Date(dueAt.getTime() - 604_800_000), endsAt: new Date(dueAt.getTime() - 1), dueAt } });
      weekBySunday.set(sunday, { yearId: year.id, dueAt });
    }
    const result = await tx.taxAssessment.createMany({ data: taxes.filter((tax) => byExternal.has(tax.ninjaId) && weekBySunday.has(tax.sunday)).map((tax) => {
      const week = weekBySunday.get(tax.sunday)!;
      return {
        ninjaId: byExternal.get(tax.ninjaId)!, taxYearId: week.yearId, taxPolicyId: policy.id,
        gradeCodeSnapshot: "ANCIEN", gradeLabelSnapshot: "Ancien registre", originalAmount: 0n, dueAt: week.dueAt,
        status: tax.paid ? ("PAID" as const) : week.dueAt < now ? ("OVERDUE" as const) : ("UPCOMING" as const)
      };
    }), skipDuplicates: true });
    await tx.appSetting.create({ data: { key: FLAG_TAXES, value: { importedAt: new Date().toISOString(), rows: result.count } } });
    await tx.auditLog.create({ data: { action: "LEGACY_TAX_HISTORY_IMPORT", entityType: "TaxAssessment", entityId: FLAG_TAXES, requestId: randomUUID(), reason: `${result.count} semaines fiscales de l’ancien registre importées (montants à zéro, historique uniquement)` } });
    console.log(`import-legacy/taxes : ${result.count} semaines importées sur ${taxes.length}`);
  }, { timeout: 300_000, maxWait: 30_000 });
}

/** The two finished tournaments from the old register. */
async function importEvents() {
  const FLAG_EVENTS = "legacyEvents2026-07-30";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_EVENTS } })) { console.log("import-legacy/événements : déjà appliqué"); return; }
  const tournaments = [
    { name: "Tournoi récolte #1", startsAt: "2026-07-04T15:27:59Z", endsAt: "2026-07-13T22:12:10Z", resourceFocus: "Toutes (hors Ryō)", winner: ["Kagemoto", "Shuni"], participants: 116 },
    { name: "Tournoi Lavande", startsAt: "2026-07-20T16:16:51Z", endsAt: "2026-07-29T10:22:29Z", resourceFocus: "Lavande", winner: ["Doma", "Nua"], participants: 15 }
  ];
  let created = 0;
  for (const tournament of tournaments) {
    const winner = await prisma.ninjaProfile.findFirst({ where: { firstName: tournament.winner[0], lastName: tournament.winner[1] } });
    await prisma.event.create({ data: {
      name: tournament.name, kind: "TOURNOI", status: "FINISHED", resourceFocus: tournament.resourceFocus,
      startsAt: new Date(tournament.startsAt), endsAt: new Date(tournament.endsAt), participantCount: tournament.participants,
      winnerId: winner?.id ?? null, description: "Importé depuis l’ancien registre", createdAt: new Date(tournament.startsAt)
    } });
    created++;
  }
  await prisma.appSetting.create({ data: { key: FLAG_EVENTS, value: { importedAt: new Date().toISOString(), count: created } } });
  await prisma.auditLog.create({ data: { action: "LEGACY_EVENTS_IMPORT", entityType: "Event", entityId: FLAG_EVENTS, requestId: randomUUID(), reason: `${created} tournois de l’ancien registre importés` } });
  console.log(`import-legacy/événements : ${created} tournois importés`);
}

async function main() {
  await importCore();
  await importTaxHistory();
  await importEvents();
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
