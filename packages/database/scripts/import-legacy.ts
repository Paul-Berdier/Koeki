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

/** Catalog correction: each equipment row of the old register is really TWO items —
 *  the collectable PLAN (bought at plan price) and the crafted EQUIPMENT (bought at
 *  craft price). Also applies the three-level village demand (Non besoin / Besoin /
 *  Besoin primaire) to equipment, plans and primary resources. */
async function fixCatalog() {
  const FLAG_FIX = "legacyCatalogFix2026-08-05";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_FIX } })) { console.log("import-legacy/catalogue : déjà corrigé"); return; }
  const fix = loadJson<{ equipment: Array<{ name: string; tier: string; planPrice: number; craftPrice: number; demand: string }>; resources: Array<{ name: string; demand: string }> }>("catalog-fix.json");
  const [scrolls, unit, systemUser] = await Promise.all([
    prisma.resourceCategory.findUnique({ where: { code: "SCROLLS" } }),
    prisma.resourceUnit.findUnique({ where: { code: "UNIT" } }),
    prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } })
  ]);
  if (!scrolls || !unit || !systemUser) { console.log("import-legacy/catalogue : référentiels absents"); return; }
  await prisma.$transaction(async (tx) => {
    const usedCodes = new Set((await tx.resource.findMany({ select: { code: true } })).map((resource) => resource.code));
    const nextCode = (name: string) => { const base = codeBase(name); let code = "", suffix = 1; do { code = `RES-${base}-${String(suffix++).padStart(2, "0")}`; } while (usedCodes.has(code)); usedCodes.add(code); return code; };
    const now = new Date();
    let plansCreated = 0, pricesFixed = 0;
    for (const item of fix.equipment) {
      const equip = await tx.resource.findFirst({ where: { name: item.name }, include: { prices: { where: { effectiveTo: null } } } });
      if (equip) {
        await tx.resource.update({ where: { id: equip.id }, data: { demand: item.demand, description: `Équipement ${item.tier} — se fabrique avec son plan et les ressources adéquates (prix craft ${item.craftPrice.toLocaleString("fr-FR")} ¥)` } });
        const current = equip.prices[0]?.pricePerUnit ?? null;
        if (item.craftPrice > 0 && (current === null || Number(current) !== item.craftPrice)) {
          await tx.resourcePriceHistory.updateMany({ where: { resourceId: equip.id, effectiveTo: null }, data: { effectiveTo: now } });
          await tx.resourcePriceHistory.create({ data: { resourceId: equip.id, pricePerUnit: BigInt(item.craftPrice), effectiveFrom: now, createdById: systemUser.id } });
          pricesFixed++;
        }
      }
      const planName = `Plan ${item.name}`;
      const existingPlan = await tx.resource.findFirst({ where: { name: planName } });
      if (!existingPlan) {
        const plan = await tx.resource.create({ data: { code: nextCode(planName), name: planName, categoryId: scrolls.id, unitId: unit.id, demand: item.demand, minimumStock: new Prisma.Decimal(0), criticalStock: new Prisma.Decimal(0), description: `Plan ramassable ${item.tier} — permet de fabriquer ${item.name}` } });
        if (item.planPrice > 0) await tx.resourcePriceHistory.create({ data: { resourceId: plan.id, pricePerUnit: BigInt(item.planPrice), effectiveFrom: now, createdById: systemUser.id } });
        plansCreated++;
      }
    }
    for (const item of fix.resources) await tx.resource.updateMany({ where: { name: { equals: item.name, mode: "insensitive" } }, data: { demand: item.demand } });
    await tx.appSetting.create({ data: { key: FLAG_FIX, value: { fixedAt: now.toISOString(), plansCreated, pricesFixed } } });
    await tx.auditLog.create({ data: { action: "LEGACY_CATALOG_FIX", entityType: "Resource", entityId: FLAG_FIX, requestId: randomUUID(), reason: `Catalogue corrigé : ${plansCreated} plans créés, ${pricesFixed} prix d’équipement passés au prix craft, niveaux de besoin appliqués` } });
    console.log(`import-legacy/catalogue : ${plansCreated} plans créés, ${pricesFixed} prix corrigés`);
  }, { timeout: 300_000, maxWait: 30_000 });
}

/** Fresh-start amnesty on the imported weekly history: ninjas whose last two Sundays
 *  (or more, consecutively) were unpaid keep those weeks late and get a note to settle;
 *  everyone else has their old missed weeks waived. */
async function taxAmnesty() {
  const FLAG_AMNESTY = "legacyTaxAmnesty2026-08-05";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_AMNESTY } })) { console.log("import-legacy/amnistie : déjà appliquée"); return; }
  const policy = await prisma.taxPolicy.findUnique({ where: { name_version: { name: "Ancien registre", version: 1 } } });
  if (!policy) { console.log("import-legacy/amnistie : historique absent"); return; }
  const lastSunday = new Date("2026-07-26T22:00:00.000Z");
  const previousSunday = new Date("2026-07-19T22:00:00.000Z");
  const legacy = await prisma.taxAssessment.findMany({ where: { taxPolicyId: policy.id }, select: { id: true, ninjaId: true, dueAt: true, status: true } });
  const byNinja = new Map<string, typeof legacy>();
  for (const row of legacy) { const list = byNinja.get(row.ninjaId) ?? []; list.push(row); byNinja.set(row.ninjaId, list); }
  let inDebt = 0, waived = 0;
  await prisma.$transaction(async (tx) => {
    for (const [ninjaId, rows] of byNinja) {
      const past = rows.filter((row) => row.dueAt <= lastSunday).sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime());
      const isUnpaid = (due: Date) => past.some((row) => row.dueAt.getTime() === due.getTime() && row.status === "OVERDUE");
      const streakIds: string[] = [];
      if (isUnpaid(lastSunday) && isUnpaid(previousSunday)) {
        for (let due = lastSunday.getTime(); ; due -= 604_800_000) {
          const row = past.find((entry) => entry.dueAt.getTime() === due && entry.status === "OVERDUE");
          if (!row) break;
          streakIds.push(row.id);
        }
      }
      const toWaive = past.filter((row) => row.status === "OVERDUE" && !streakIds.includes(row.id)).map((row) => row.id);
      if (toWaive.length) { await tx.taxAssessment.updateMany({ where: { id: { in: toWaive } }, data: { status: "WAIVED" } }); waived += toWaive.length; }
      if (streakIds.length) {
        inDebt++;
        const profile = await tx.ninjaProfile.findUnique({ where: { id: ninjaId }, select: { notes: true } });
        const marker = `Reprise du 30/07/2026 : ${streakIds.length} dimanche${streakIds.length > 1 ? "s" : ""} consécutif${streakIds.length > 1 ? "s" : ""} impayé${streakIds.length > 1 ? "s" : ""} — dette à régulariser`;
        if (!profile?.notes?.includes("dette à régulariser")) await tx.ninjaProfile.update({ where: { id: ninjaId }, data: { notes: profile?.notes ? `${profile.notes}\n${marker}` : marker } });
      }
    }
    await tx.appSetting.create({ data: { key: FLAG_AMNESTY, value: { appliedAt: new Date().toISOString(), inDebt, waived } } });
    await tx.auditLog.create({ data: { action: "LEGACY_TAX_AMNESTY", entityType: "TaxAssessment", entityId: FLAG_AMNESTY, requestId: randomUUID(), reason: `Reprise : ${inDebt} ninjas gardent leur retard (2+ dimanches consécutifs), ${waived} semaines amnistiées (Remise)` } });
    console.log(`import-legacy/amnistie : ${inDebt} ninjas en tort conservés, ${waived} semaines amnistiées`);
  }, { timeout: 300_000, maxWait: 30_000 });
}

/** Exemption economy of the old register: per-unit exemption rates on donatable
 *  resources, and each ninja's cumulative exemption balance as an opening credit. */
async function importExemptions() {
  const FLAG_EXO = "legacyExemptions2026-08-05";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_EXO } })) { console.log("import-legacy/exonérations : déjà appliqué"); return; }
  const RATES: Array<[string, number]> = [["Bois", 800], ["Laine", 1000], ["Plastique", 300], ["Cuivre", 1000], ["Fer", 10000], ["Titane", 10000], ["Chakra Métal", 50000], ["Jade", 10000], ["T1", 200], ["T2", 6000], ["T3", 25000], ["T4", 200000], ["Lavande", 10]];
  const ninjas = loadJson<NinjaEntry[]>("ninjas.json");
  await prisma.$transaction(async (tx) => {
    for (const [name, rate] of RATES) await tx.resource.updateMany({ where: { name: { equals: name, mode: "insensitive" } }, data: { exemptionPerUnit: BigInt(rate) } });
    let credited = 0; let total = 0n;
    for (const ninja of ninjas) {
      if (ninja.exemptions === 0) continue;
      const profile = await tx.ninjaProfile.findUnique({ where: { code: `NIN-${String(ninja.id).padStart(6, "0")}` }, select: { id: true } });
      if (!profile) continue;
      await tx.exemptionLedgerEntry.create({ data: { ninjaId: profile.id, amount: BigInt(ninja.exemptions), sourceType: "Import", sourceId: `${FLAG_EXO}:${ninja.id}`, reason: "Reprise du crédit d’exonération de l’ancien registre" } });
      credited++; total += BigInt(ninja.exemptions);
    }
    await tx.appSetting.create({ data: { key: FLAG_EXO, value: { importedAt: new Date().toISOString(), credited, total: String(total) } } });
    await tx.auditLog.create({ data: { action: "LEGACY_EXEMPTIONS_IMPORT", entityType: "ExemptionLedgerEntry", entityId: FLAG_EXO, requestId: randomUUID(), reason: `Crédit d’exonération repris pour ${credited} ninjas (${total.toLocaleString("fr-FR")} ¥), barèmes par unité appliqués sur ${RATES.length} ressources` } });
    console.log(`import-legacy/exonérations : ${credited} soldes repris (${total.toLocaleString("fr-FR")} ¥), ${RATES.length} barèmes appliqués`);
  }, { timeout: 300_000, maxWait: 30_000 });
}

async function main() {
  await importCore();
  await importTaxHistory();
  await importEvents();
  await fixCatalog();
  await taxAmnesty();
  await importExemptions();
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
