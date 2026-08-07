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
  const [genin, categories, systemUser] = await Promise.all([
    prisma.ninjaGrade.findUnique({ where: { code: "GENIN" } }),
    prisma.resourceCategory.findMany(),
    prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } })
  ]);
  if (!genin || !systemUser || !categories.length) { console.log("import-legacy : référentiels absents — exécutez d’abord le bootstrap"); return; }
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
        minimumStock: new Prisma.Decimal(0), criticalStock: new Prisma.Decimal(0)
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
  const [scrolls, systemUser] = await Promise.all([
    prisma.resourceCategory.findUnique({ where: { code: "SCROLLS" } }),
    prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } })
  ]);
  if (!scrolls || !systemUser) { console.log("import-legacy/catalogue : référentiels absents"); return; }
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
        const plan = await tx.resource.create({ data: { code: nextCode(planName), name: planName, categoryId: scrolls.id, demand: item.demand, minimumStock: new Prisma.Decimal(0), criticalStock: new Prisma.Decimal(0), description: `Plan ramassable ${item.tier} — permet de fabriquer ${item.name}` } });
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

/** The Excel gives one exemption rate per tier (T1..T4): every equipment piece and
 *  every plan of a tier covers that tier's value when donated. */
async function fixTierExemptions() {
  const FLAG_TIERS = "legacyTierExemptions2026-08-05";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_TIERS } })) { console.log("import-legacy/barèmes tiers : déjà appliqué"); return; }
  const TIERS: Array<[string, bigint]> = [["T1", 200n], ["T2", 6000n], ["T3", 25000n], ["T4", 200000n]];
  let updated = 0;
  for (const [tier, rate] of TIERS) {
    const result = await prisma.resource.updateMany({ where: { OR: [{ name: { endsWith: ` ${tier}` } }, { name: tier }] }, data: { exemptionPerUnit: rate } });
    updated += result.count;
  }
  await prisma.appSetting.create({ data: { key: FLAG_TIERS, value: { appliedAt: new Date().toISOString(), updated } } });
  await prisma.auditLog.create({ data: { action: "LEGACY_TIER_EXEMPTIONS", entityType: "Resource", entityId: FLAG_TIERS, requestId: randomUUID(), reason: `Barème d’exonération par tier appliqué à ${updated} équipements et plans (T1 200, T2 6 000, T3 25 000, T4 200 000 ¥/u)` } });
  console.log(`import-legacy/barèmes tiers : ${updated} équipements et plans mis à jour`);
}

/** Second catalog pass from the Excel's "Ressources" sheet: per-unit ranking points
 *  on every donatable item (tier rates cover equipment pieces AND plans, like the
 *  exemptions), built equipment moves to the new "Équipement" category (plans stay
 *  in Parchemins), and Ryō leaves the catalog — it is money, not a resource. */
async function updateCatalogPointsAndCategories() {
  const FLAG_POINTS = "legacyCatalogPoints2026-08-07";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_POINTS } })) { console.log("import-legacy/points : déjà appliqué"); return; }
  const POINT_RATES: Array<[string, number]> = [["Bois", 5], ["Laine", 10], ["Plastique", 5], ["Cuivre", 10], ["Fer", 125], ["Titane", 125], ["Chakra Métal", 500], ["Jade", 125], ["Lavande", 2]];
  const TIER_POINTS: Array<[string, number]> = [["T1", 5], ["T2", 75], ["T3", 150], ["T4", 500]];
  const equipment = await prisma.resourceCategory.findUnique({ where: { code: "EQUIPMENT" } });
  if (!equipment) { console.log("import-legacy/points : catégorie Équipement absente — exécutez d’abord le bootstrap"); return; }
  await prisma.$transaction(async (tx) => {
    let pointsApplied = 0;
    for (const [name, rate] of POINT_RATES) { const result = await tx.resource.updateMany({ where: { name: { equals: name, mode: "insensitive" } }, data: { pointsPerUnit: rate } }); pointsApplied += result.count; }
    for (const [tier, rate] of TIER_POINTS) { const result = await tx.resource.updateMany({ where: { OR: [{ name: { endsWith: ` ${tier}` } }, { name: tier }] }, data: { pointsPerUnit: rate } }); pointsApplied += result.count; }
    let moved = 0;
    for (const [tier] of TIER_POINTS) {
      const result = await tx.resource.updateMany({ where: { OR: [{ name: { endsWith: ` ${tier}` } }, { name: tier }], NOT: { name: { startsWith: "Plan " } } }, data: { categoryId: equipment.id } });
      moved += result.count;
    }
    const ryo = await tx.resource.updateMany({ where: { name: { in: ["Ryo", "Ryō"], mode: "insensitive" } }, data: { isActive: false, pointsPerUnit: 0, exemptionPerUnit: 0n, demand: "NONE" } });
    await tx.appSetting.create({ data: { key: FLAG_POINTS, value: { appliedAt: new Date().toISOString(), pointsApplied, moved, ryoDeactivated: ryo.count } } });
    await tx.auditLog.create({ data: { action: "LEGACY_CATALOG_POINTS", entityType: "Resource", entityId: FLAG_POINTS, requestId: randomUUID(), reason: `Barème de points par unité appliqué à ${pointsApplied} objets, ${moved} équipements construits reclassés en « Équipement », Ryō retiré du catalogue (${ryo.count} désactivé)` } });
    console.log(`import-legacy/points : ${pointsApplied} barèmes appliqués, ${moved} équipements reclassés, ${ryo.count} Ryō désactivé`);
  }, { timeout: 300_000, maxWait: 30_000 });
}

/** Until real grades are collected, every ninja is a Genin confirmé (10 000 ¥/semaine).
 *  The current RP week is rebilled at the new grade with the same rules as a scale
 *  change: untouched lines are regenerated, anything already paid/exempted/penalized
 *  stays, and fresh taxes are auto-covered by available exemption credit. */
async function setAllGradesGeninConfirmed() {
  const FLAG_GRADES = "legacyGradesGeninConfirmed2026-08-07";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_GRADES } })) { console.log("import-legacy/grades : déjà appliqué"); return; }
  const [grade, policy, rpSetting, systemUser] = await Promise.all([
    prisma.ninjaGrade.findUnique({ where: { code: "GENIN_CONFIRMED" } }),
    prisma.taxPolicy.findFirst({ where: { isActive: true }, include: { rates: true } }),
    prisma.appSetting.findUnique({ where: { key: "rpTime" } }),
    prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } })
  ]);
  if (!grade || !policy || !systemUser) { console.log("import-legacy/grades : référentiels absents — exécutez d’abord le bootstrap"); return; }
  const rp = rpSetting?.value as { realAnchorAt?: string; rpAnchorYear?: number; realMillisecondsPerRpYear?: number } | undefined;
  const anchor = Date.parse(rp?.realAnchorAt ?? "2026-01-04T23:00:00.000Z");
  const duration = rp?.realMillisecondsPerRpYear ?? 604_800_000;
  const now = new Date();
  const rpYear = (rp?.rpAnchorYear ?? 20) + Math.floor((now.getTime() - anchor) / duration);
  const rates = new Map(policy.rates.map((rate) => [rate.gradeId, rate.amount]));
  await prisma.$transaction(async (tx) => {
    const toChange = await tx.ninjaProfile.findMany({ where: { status: { not: "ARCHIVED" }, currentGradeId: { not: grade.id } }, select: { id: true } });
    const ids = toChange.map((ninja) => ninja.id);
    if (ids.length) {
      await tx.ninjaGradeHistory.updateMany({ where: { ninjaId: { in: ids }, effectiveTo: null }, data: { effectiveTo: now } });
      await tx.ninjaGradeHistory.createMany({ data: ids.map((ninjaId) => ({ ninjaId, gradeId: grade.id, effectiveFrom: now, reason: "Passage collectif en Genin confirmé — grades réels à attribuer", changedById: systemUser.id })) });
      await tx.ninjaProfile.updateMany({ where: { id: { in: ids } }, data: { currentGradeId: grade.id } });
    }
    // Rebill the current week at the new grade (same guardrails as updateTaxRates).
    let rebilled = 0, exempted = 0;
    const year = await tx.taxYear.findUnique({ where: { rpYear } });
    if (year) {
      const untouched = await tx.taxAssessment.findMany({ where: {
        taxYearId: year.id, taxPolicy: { name: { not: "Ancien registre" } },
        allocations: { none: {} }, exemptions: { none: {} }, penalties: { none: {} }, adjustments: { none: {} }
      }, select: { id: true } });
      if (untouched.length) await tx.taxAssessment.deleteMany({ where: { id: { in: untouched.map((entry) => entry.id) } } });
      const ninjas = await tx.ninjaProfile.findMany({ where: { status: "ACTIVE" }, include: { currentGrade: true } });
      const result = await tx.taxAssessment.createMany({ data: ninjas.map((ninja) => ({
        ninjaId: ninja.id, taxYearId: year.id, taxPolicyId: policy.id, gradeCodeSnapshot: ninja.currentGrade.code, gradeLabelSnapshot: ninja.currentGrade.label,
        originalAmount: rates.get(ninja.currentGradeId) ?? 0n, dueAt: year.dueAt, status: year.dueAt > now ? "UPCOMING" as const : "DUE" as const
      })), skipDuplicates: true });
      rebilled = result.count;
      const fresh = await tx.taxAssessment.findMany({ where: { taxYearId: year.id, originalAmount: { gt: 0 }, status: { in: ["UPCOMING", "DUE"] } }, select: { id: true, ninjaId: true, originalAmount: true } });
      for (const assessment of fresh) {
        const already = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "TaxAssessment", sourceId: assessment.id } } });
        if (already) continue;
        const balance = (await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId: assessment.ninjaId }, _sum: { amount: true } }))._sum.amount ?? 0n;
        if (balance <= 0n) continue;
        const use = balance < assessment.originalAmount ? balance : assessment.originalAmount;
        await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: -use, sourceType: "TaxAssessment", sourceId: assessment.id, reason: `Exonération automatique — taxe semaine RP ${rpYear}` } });
        await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: use, reason: "Exonération automatique (crédit de dons/rachats)", grantedById: systemUser.id } });
        if (use >= assessment.originalAmount) await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID" } });
        exempted++;
      }
    }
    await tx.appSetting.create({ data: { key: FLAG_GRADES, value: { appliedAt: now.toISOString(), regraded: ids.length, rebilled, exempted, rpYear } } });
    await tx.auditLog.create({ data: { action: "LEGACY_GRADES_GENIN_CONFIRMED", entityType: "NinjaProfile", entityId: FLAG_GRADES, requestId: randomUUID(), reason: `${ids.length} ninjas passés en Genin confirmé (grades réels à attribuer) — semaine RP ${rpYear} refacturée (${rebilled} taxes, ${exempted} couvertes par crédit)` } });
    console.log(`import-legacy/grades : ${ids.length} ninjas en Genin confirmé, ${rebilled} taxes refacturées, ${exempted} couvertes par crédit`);
  }, { timeout: 300_000, maxWait: 30_000 });
}

interface KvNinja { id: number; firstName: string; lastName: string; points: number; exo: number; grade: string | null; taxes: Array<{ week: string; paid: boolean }> }
interface KvDonation { id: string; ninjaId: number; date: string; points: number; by: string; items: Array<{ quantity: number; name: string }> }
interface KvRecipe { id: string; name: string; tier: string; materials: Array<{ key: string; qty: number }> }
interface KvPayload { ninjas: KvNinja[]; donations: KvDonation[]; recipes: KvRecipe[]; resourcePoints: Record<string, number>; removedExternalIds: number[] }

const KV_RESOURCE_NAMES: Record<string, string> = { bois: "Bois", laine: "Laine", plastique: "Plastique", cuivre: "Cuivre", fer: "Fer", titane: "Titane", chakra: "Chakra Métal", jade: "Jade", t1: "T1", t2: "T2", t3: "T3", t4: "T4", ryo: "Ryo", lavande: "Lavande" };
const normalizeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Cutover on the bot's KV export of 2026-08-07 — the bot is the source of truth up to that
 *  moment. Unknown grades become "Non renseigné" (0 tax), known grades use the highest of the
 *  explicit grade and the gradeStatus flags, balances are reconciled to the export, the wrongly
 *  billed current week is refunded and regenerated, advance-paid weeks are honoured, the new
 *  point scale and the closed buyback prices are applied, and the 31 real recipes come in. */
async function mergeKvExport20260807() {
  const FLAG_KV = "kvMerge2026-08-07";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_KV } })) { console.log("import-legacy/kv : déjà appliqué"); return; }
  const kv = loadJson<KvPayload>("kv-2026-08-07.json");
  const [gradeRows, policy, legacyPolicy, rpSetting, systemUser] = await Promise.all([
    prisma.ninjaGrade.findMany(),
    prisma.taxPolicy.findFirst({ where: { isActive: true }, include: { rates: true } }),
    prisma.taxPolicy.findUnique({ where: { name_version: { name: "Ancien registre", version: 1 } } }),
    prisma.appSetting.findUnique({ where: { key: "rpTime" } }),
    prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } })
  ]);
  if (!policy || !systemUser) { console.log("import-legacy/kv : référentiels absents — exécutez d’abord le bootstrap"); return; }
  const rp = rpSetting?.value as { realAnchorAt?: string; rpAnchorYear?: number; realMillisecondsPerRpYear?: number } | undefined;
  const anchor = Date.parse(rp?.realAnchorAt ?? "2026-01-04T23:00:00.000Z");
  const duration = rp?.realMillisecondsPerRpYear ?? 604_800_000;
  const anchorYear = rp?.rpAnchorYear ?? 20;
  const now = new Date();
  const currentRpYear = anchorYear + Math.floor((now.getTime() - anchor) / duration);
  const rpYearOfWeek = (week: string) => anchorYear + Math.round((Date.parse(`${week}T22:00:00.000Z`) - duration - anchor) / duration);
  await prisma.$transaction(async (tx) => {
    // Referentials: the "Non renseigné" grade is billed at zero until real grades are set.
    const unknown = await tx.ninjaGrade.upsert({ where: { code: "UNKNOWN" }, create: { code: "UNKNOWN", label: "Non renseigné", sortOrder: 0 }, update: { label: "Non renseigné" } });
    await tx.taxPolicyGradeRate.upsert({ where: { taxPolicyId_gradeId: { taxPolicyId: policy.id, gradeId: unknown.id } }, create: { taxPolicyId: policy.id, gradeId: unknown.id, amount: 0n }, update: { amount: 0n } });
    const gradeByCode = new Map(gradeRows.map((grade) => [grade.code, grade]));
    gradeByCode.set("UNKNOWN", unknown);
    const rates = new Map(policy.rates.map((rate) => [rate.gradeId, rate.amount]));
    rates.set(unknown.id, 0n);

    // Ninjas: regrade everyone from the export (unknown -> Non renseigné), create the new ones.
    const codeOf = (id: number) => `NIN-${String(id).padStart(6, "0")}`;
    const profiles = await tx.ninjaProfile.findMany({ select: { id: true, code: true, currentGradeId: true, notes: true } });
    const profileByCode = new Map(profiles.map((profile) => [profile.code, profile]));
    let regraded = 0, created = 0;
    for (const ninja of kv.ninjas) {
      const target = gradeByCode.get(ninja.grade ?? "UNKNOWN") ?? unknown;
      const existing = profileByCode.get(codeOf(ninja.id));
      if (existing) {
        if (existing.currentGradeId !== target.id) {
          await tx.ninjaGradeHistory.updateMany({ where: { ninjaId: existing.id, effectiveTo: null }, data: { effectiveTo: now } });
          await tx.ninjaGradeHistory.create({ data: { ninjaId: existing.id, gradeId: target.id, effectiveFrom: now, reason: ninja.grade ? "Fusion du registre du 07/08/2026 — grade réel" : "Fusion du registre du 07/08/2026 — grade non renseigné (taxe 0)", changedById: systemUser.id } });
          await tx.ninjaProfile.update({ where: { id: existing.id }, data: { currentGradeId: target.id } });
          regraded++;
        }
      } else {
        const profile = await tx.ninjaProfile.create({ data: { code: codeOf(ninja.id), firstName: ninja.firstName, lastName: ninja.lastName, currentGradeId: target.id, notes: "Importé du registre du bot (07/08/2026)" } });
        await tx.ninjaGradeHistory.create({ data: { ninjaId: profile.id, gradeId: target.id, effectiveFrom: now, reason: "Import du registre du 07/08/2026", changedById: systemUser.id } });
        profileByCode.set(profile.code, { id: profile.id, code: profile.code, currentGradeId: target.id, notes: null });
        created++;
      }
    }
    for (const removedId of kv.removedExternalIds) {
      const gone = profileByCode.get(codeOf(removedId));
      if (gone) await tx.ninjaProfile.update({ where: { id: gone.id }, data: { status: "ARCHIVED", notes: `${gone.notes ? `${gone.notes}\n` : ""}Supprimé du registre du bot avant le 07/08/2026 — archivé` } });
    }

    // Current week: refund the automatic credit spent on the wrong 10 000 ¥ bills, then rebill
    // untouched lines at each ninja's (possibly zero) new rate.
    let refunded = 0n, rebilled = 0;
    const year = await tx.taxYear.findUnique({ where: { rpYear: currentRpYear } });
    if (year) {
      const candidates = await tx.taxAssessment.findMany({ where: {
        taxYearId: year.id, taxPolicy: { name: { not: "Ancien registre" } },
        allocations: { none: {} }, penalties: { none: {} }, adjustments: { none: {} }
      }, include: { exemptions: true } });
      for (const assessment of candidates) {
        const exempted = assessment.exemptions.reduce((sum, entry) => sum + entry.amount, 0n);
        if (exempted > 0n) {
          await tx.taxExemption.deleteMany({ where: { assessmentId: assessment.id } });
          await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: exempted, sourceType: "TaxAssessmentRefund", sourceId: assessment.id, reason: "Refacturation du 07/08/2026 — crédit restitué" } });
          refunded += exempted;
        }
      }
      if (candidates.length) await tx.taxAssessment.deleteMany({ where: { id: { in: candidates.map((entry) => entry.id) } } });
      const active = await tx.ninjaProfile.findMany({ where: { status: "ACTIVE" }, include: { currentGrade: true } });
      const result = await tx.taxAssessment.createMany({ data: active.map((ninja) => ({
        ninjaId: ninja.id, taxYearId: year.id, taxPolicyId: policy.id, gradeCodeSnapshot: ninja.currentGrade.code, gradeLabelSnapshot: ninja.currentGrade.label,
        originalAmount: rates.get(ninja.currentGradeId) ?? 0n, dueAt: year.dueAt, status: year.dueAt > now ? "UPCOMING" as const : "DUE" as const
      })), skipDuplicates: true });
      rebilled = result.count;
    }

    // Tax history: regularised weeks flip to paid, unknown past weeks and advance-paid future
    // weeks land as zero-amount history rows; the already-billed current week is settled with a
    // "paid in advance" exemption line.
    const history = legacyPolicy ?? await tx.taxPolicy.create({ data: { name: "Ancien registre", version: 1, effectiveFromRpYear: 0, isActive: false } });
    const currentWeekKey = year ? year.dueAt.toISOString().slice(0, 10) : null;
    const kvNinjaIds = kv.ninjas.map((ninja) => profileByCode.get(codeOf(ninja.id))?.id).filter((id): id is string => Boolean(id));
    const appAssessments = await tx.taxAssessment.findMany({ where: { ninjaId: { in: kvNinjaIds } }, select: { id: true, ninjaId: true, status: true, originalAmount: true, taxYear: { select: { rpYear: true } } } });
    const assessmentByKey = new Map(appAssessments.map((entry) => [`${entry.ninjaId}:${entry.taxYear.rpYear}`, entry]));
    const yearByRp = new Map((await tx.taxYear.findMany({ select: { id: true, rpYear: true } })).map((entry) => [entry.rpYear, entry.id]));
    let regularised = 0, advanceRows = 0, advanceSettled = 0;
    for (const ninja of kv.ninjas) {
      const profile = profileByCode.get(codeOf(ninja.id));
      if (!profile) continue;
      for (const record of ninja.taxes) {
        const weekRpYear = rpYearOfWeek(record.week);
        if (currentWeekKey && record.week === currentWeekKey) {
          if (!record.paid) continue;
          const assessment = await tx.taxAssessment.findUnique({ where: { ninjaId_taxYearId: { ninjaId: profile.id, taxYearId: year!.id } }, include: { exemptions: true, penalties: true, adjustments: true, allocations: { select: { amount: true, payment: { select: { status: true } } } } } });
          if (!assessment) continue;
          const paid = assessment.allocations.filter((entry) => entry.payment.status === "VALIDATED").reduce((sum, entry) => sum + entry.amount, 0n);
          const remaining = assessment.originalAmount + assessment.penalties.reduce((sum, entry) => sum + entry.amount, 0n) + assessment.adjustments.reduce((sum, entry) => sum + entry.amount, 0n) - assessment.exemptions.reduce((sum, entry) => sum + entry.amount, 0n) - paid;
          if (remaining > 0n) {
            await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: remaining, reason: "Payée d’avance à l’ancien registre (07/08/2026)", grantedById: systemUser.id } });
            await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID", version: { increment: 1 } } });
            advanceSettled++;
          }
          continue;
        }
        const existing = assessmentByKey.get(`${profile.id}:${weekRpYear}`);
        if (existing) {
          if (record.paid && existing.status === "OVERDUE") { await tx.taxAssessment.update({ where: { id: existing.id }, data: { status: "PAID", version: { increment: 1 } } }); regularised++; }
          continue;
        }
        const dueAt = new Date(`${record.week}T22:00:00.000Z`);
        let yearId = yearByRp.get(weekRpYear);
        if (!yearId) {
          const createdYear = await tx.taxYear.create({ data: { rpYear: weekRpYear, taxPolicyId: history.id, startsAt: new Date(dueAt.getTime() - duration), endsAt: new Date(dueAt.getTime() - 1), dueAt } });
          yearId = createdYear.id;
          yearByRp.set(weekRpYear, yearId);
        }
        await tx.taxAssessment.create({ data: {
          ninjaId: profile.id, taxYearId: yearId, taxPolicyId: history.id, gradeCodeSnapshot: "ANCIEN", gradeLabelSnapshot: record.week > (currentWeekKey ?? "") ? "Payée d’avance (ancien registre)" : "Ancien registre",
          originalAmount: 0n, dueAt, status: record.paid ? "PAID" : dueAt < now ? "OVERDUE" : "UPCOMING"
        } });
        advanceRows++;
        assessmentByKey.set(`${profile.id}:${weekRpYear}`, { id: "", ninjaId: profile.id, status: "PAID", originalAmount: 0n, taxYear: { rpYear: weekRpYear } });
      }
    }

    // Balances: the export is the truth — realign every point and exemption balance with a
    // single explicable adjustment entry per ninja.
    let pointAdjustments = 0, exoAdjustments = 0;
    for (const ninja of kv.ninjas) {
      const profile = profileByCode.get(codeOf(ninja.id));
      if (!profile) continue;
      const pointsNow = (await tx.pointLedgerEntry.aggregate({ where: { ninjaId: profile.id }, _sum: { points: true } }))._sum.points ?? 0;
      const pointsDelta = ninja.points - pointsNow;
      if (pointsDelta !== 0) { await tx.pointLedgerEntry.create({ data: { ninjaId: profile.id, eventType: "MANUAL_ADJUSTMENT", points: pointsDelta, sourceType: "Import", sourceId: `${FLAG_KV}:points:${ninja.id}`, reason: "Recalage sur le registre du 07/08/2026" } }); pointAdjustments++; }
      const exoNow = (await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId: profile.id }, _sum: { amount: true } }))._sum.amount ?? 0n;
      const exoDelta = BigInt(ninja.exo) - exoNow;
      if (exoDelta !== 0n) { await tx.exemptionLedgerEntry.create({ data: { ninjaId: profile.id, amount: exoDelta, sourceType: "Import", sourceId: `${FLAG_KV}:exo:${ninja.id}`, reason: "Recalage sur le registre du 07/08/2026" } }); exoAdjustments++; }
    }

    // Current week again: with correct balances, spend available credit on whoever still owes.
    let covered = 0;
    if (year) {
      const fresh = await tx.taxAssessment.findMany({ where: { taxYearId: year.id, originalAmount: { gt: 0 }, status: { in: ["UPCOMING", "DUE"] } }, select: { id: true, ninjaId: true, originalAmount: true } });
      for (const assessment of fresh) {
        const already = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "TaxAssessment", sourceId: assessment.id } } });
        if (already) continue;
        const balance = (await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId: assessment.ninjaId }, _sum: { amount: true } }))._sum.amount ?? 0n;
        if (balance <= 0n) continue;
        const use = balance < assessment.originalAmount ? balance : assessment.originalAmount;
        await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: -use, sourceType: "TaxAssessment", sourceId: assessment.id, reason: `Exonération automatique — taxe semaine RP ${currentRpYear}` } });
        await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: use, reason: "Exonération automatique (crédit de dons/rachats)", grantedById: systemUser.id } });
        if (use >= assessment.originalAmount) await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID", version: { increment: 1 } } });
        covered++;
      }
    }

    // The 49 donations recorded at the bot since 03/08 — receipts only, balances already carry them.
    const resources = await tx.resource.findMany({ select: { id: true, name: true } });
    const resourceByNorm = new Map(resources.map((resource) => [normalizeName(resource.name), resource]));
    let donsImported = 0, donIndex = 0;
    for (const don of kv.donations) {
      donIndex++;
      const profile = profileByCode.get(codeOf(don.ninjaId));
      if (!profile) continue;
      const items = don.items.map((item) => ({ quantity: item.quantity, resource: resourceByNorm.get(normalizeName(item.name)) })).filter((item): item is { quantity: number; resource: { id: string; name: string } } => Boolean(item.resource));
      const when = new Date(don.date);
      await tx.resourceTransaction.create({ data: {
        id: `kv-don-${don.id}`, receiptNumber: `DON-BOT-${String(donIndex).padStart(6, "0")}`, type: "DONATION", status: "VALIDATED",
        ninjaId: profile.id, agentId: systemUser.id, totalAmount: 0n, totalPoints: don.points, idempotencyKey: `kv-don-${don.id}`, validatedAt: when, createdAt: when,
        ...(items.length ? { items: { createMany: { data: items.map((item) => ({ resourceId: item.resource.id, quantity: new Prisma.Decimal(item.quantity), unitPriceSnapshot: 0n, lineTotal: 0n })) } } } : {})
      } });
      donsImported++;
    }

    // New point scale of 03/08 (tier rates cover the generic rows, equipment pieces and plans).
    const points = kv.resourcePoints;
    let scaleApplied = 0;
    for (const [key, value] of Object.entries(points)) {
      const name = KV_RESOURCE_NAMES[key];
      if (!name || ["t1", "t2", "t3", "t4"].includes(key)) continue;
      const result = await tx.resource.updateMany({ where: { name: { equals: name, mode: "insensitive" } }, data: { pointsPerUnit: value } });
      scaleApplied += result.count;
    }
    for (const tier of ["T1", "T2", "T3", "T4"] as const) {
      const result = await tx.resource.updateMany({ where: { OR: [{ name: { endsWith: ` ${tier}` } }, { name: tier }] }, data: { pointsPerUnit: points[tier.toLowerCase()] ?? 0 } });
      scaleApplied += result.count;
    }

    // Buyback closed on 06/08: every active price ends now — no buyback until prices are set again.
    const closedPrices = await tx.resourcePriceHistory.updateMany({ where: { effectiveTo: null }, data: { effectiveTo: now } });

    // The 31 real workshop recipes, output linked to the matching equipment piece when it exists.
    const usedCodes = new Set((await tx.craftRecipe.findMany({ select: { code: true } })).map((recipe) => recipe.code));
    const existingNames = new Set((await tx.craftRecipe.findMany({ select: { name: true } })).map((recipe) => normalizeName(recipe.name)));
    const nextCode = (name: string) => { const base = codeBase(name); let code = "", suffix = 1; do { code = `REC-${base}-${String(suffix++).padStart(2, "0")}`; } while (usedCodes.has(code)); usedCodes.add(code); return code; };
    const RECIPE_ALIASES: Record<string, string> = { gants: "gant", arumure: "armure" };
    const DIFFICULTY: Record<string, string> = { T1: "Novice", T2: "Confirmé", T3: "Expert", T4: "Maître", Autre: "Novice" };
    let recipesImported = 0;
    for (const recipe of kv.recipes) {
      const cleaned = normalizeName(recipe.name).split(" ").map((word) => RECIPE_ALIASES[word] ?? word).join(" ");
      const output = recipe.tier === "Autre" ? undefined : resourceByNorm.get(`${cleaned} ${recipe.tier.toLowerCase()}`);
      const name = output ? output.name : recipe.tier === "Autre" ? recipe.name : `${recipe.name} ${recipe.tier}`;
      if (existingNames.has(normalizeName(name))) continue;
      existingNames.add(normalizeName(name));
      const ingredients = recipe.materials.map((material) => ({ resource: resourceByNorm.get(normalizeName(KV_RESOURCE_NAMES[material.key] ?? material.key)), quantity: material.qty })).filter((item): item is { resource: { id: string; name: string }; quantity: number } => Boolean(item.resource));
      if (!ingredients.length) continue;
      await tx.craftRecipe.create({ data: {
        code: nextCode(name), version: 1, name, category: recipe.tier, description: "Importée du registre du bot (07/08/2026)", difficulty: DIFFICULTY[recipe.tier] ?? "Novice",
        durationRpMinutes: 60, cost: 0n, status: "ACTIVE",
        ingredients: { createMany: { data: ingredients.map((item) => ({ resourceId: item.resource.id, quantity: new Prisma.Decimal(item.quantity) })) } },
        ...(output ? { outputs: { create: { resourceId: output.id, quantity: new Prisma.Decimal(1) } } } : {})
      } });
      recipesImported++;
    }

    await tx.appSetting.create({ data: { key: FLAG_KV, value: { appliedAt: now.toISOString(), regraded, created, refunded: String(refunded), rebilled, regularised, advanceRows, advanceSettled, pointAdjustments, exoAdjustments, covered, donsImported, scaleApplied, closedPrices: closedPrices.count, recipesImported } } });
    await tx.auditLog.create({ data: { action: "KV_MERGE_2026_08_07", entityType: "NinjaProfile", entityId: FLAG_KV, requestId: randomUUID(), reason: `Fusion du registre du bot (07/08/2026) : ${regraded} regradés (+${created} créés), semaine refacturée (${rebilled} taxes, ${Number(refunded).toLocaleString("fr-FR")} ¥ de crédit restitués), ${regularised} semaines régularisées, ${advanceRows} semaines d’historique/avance, ${advanceSettled} semaines courantes payées d’avance, ${pointAdjustments} recalages de points, ${exoAdjustments} recalages d’exonération, ${covered} taxes couvertes par crédit, ${donsImported} dons, barème de points sur ${scaleApplied} objets, ${closedPrices.count} prix de rachat fermés, ${recipesImported} recettes` } });
    console.log(`import-legacy/kv : fusion appliquée — ${regraded} regradés, ${created} créés, ${donsImported} dons, ${recipesImported} recettes, ${advanceRows} semaines importées`);
  }, { timeout: 600_000, maxWait: 30_000 });
}

/** Correction on the KV merge: the bot's explicit grade field is authoritative — the
 *  gradeStatus flags (always all-or-nothing) are a bot-side marker, not a grade. Any ninja
 *  whose grade differs from the (now explicit) export is regraded, and the current week is
 *  rebilled with ledger-accurate refunds: only exemption lines actually funded by credit are
 *  refunded; "paid in advance" settlements are reapplied from the export afterwards. */
async function fixExplicitGrades20260807() {
  const FLAG_FIX = "kvGradesExplicit2026-08-07";
  if (await prisma.appSetting.findUnique({ where: { key: FLAG_FIX } })) { console.log("import-legacy/grades-kv : déjà appliqué"); return; }
  const kv = loadJson<KvPayload>("kv-2026-08-07.json");
  const [gradeRows, policy, rpSetting, systemUser] = await Promise.all([
    prisma.ninjaGrade.findMany(),
    prisma.taxPolicy.findFirst({ where: { isActive: true }, include: { rates: true } }),
    prisma.appSetting.findUnique({ where: { key: "rpTime" } }),
    prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } })
  ]);
  if (!policy || !systemUser) { console.log("import-legacy/grades-kv : référentiels absents"); return; }
  const gradeByCode = new Map(gradeRows.map((grade) => [grade.code, grade]));
  const unknown = gradeByCode.get("UNKNOWN");
  if (!unknown) { console.log("import-legacy/grades-kv : fusion KV absente — rien à corriger"); return; }
  const rates = new Map(policy.rates.map((rate) => [rate.gradeId, rate.amount]));
  const rp = rpSetting?.value as { realAnchorAt?: string; rpAnchorYear?: number; realMillisecondsPerRpYear?: number } | undefined;
  const anchor = Date.parse(rp?.realAnchorAt ?? "2026-01-04T23:00:00.000Z");
  const duration = rp?.realMillisecondsPerRpYear ?? 604_800_000;
  const now = new Date();
  const currentRpYear = (rp?.rpAnchorYear ?? 20) + Math.floor((now.getTime() - anchor) / duration);
  await prisma.$transaction(async (tx) => {
    const codeOf = (id: number) => `NIN-${String(id).padStart(6, "0")}`;
    const profiles = await tx.ninjaProfile.findMany({ select: { id: true, code: true, currentGradeId: true } });
    const profileByCode = new Map(profiles.map((profile) => [profile.code, profile]));
    let regraded = 0;
    for (const ninja of kv.ninjas) {
      const profile = profileByCode.get(codeOf(ninja.id));
      if (!profile) continue;
      const target = gradeByCode.get(ninja.grade ?? "UNKNOWN") ?? unknown;
      if (profile.currentGradeId === target.id) continue;
      await tx.ninjaGradeHistory.updateMany({ where: { ninjaId: profile.id, effectiveTo: null }, data: { effectiveTo: now } });
      await tx.ninjaGradeHistory.create({ data: { ninjaId: profile.id, gradeId: target.id, effectiveFrom: now, reason: "Correction du 07/08/2026 — le grade affiché par le bot fait foi (drapeaux gradeStatus ignorés)", changedById: systemUser.id } });
      await tx.ninjaProfile.update({ where: { id: profile.id }, data: { currentGradeId: target.id } });
      regraded++;
    }
    let refunded = 0n, rebilled = 0, advanceSettled = 0, covered = 0;
    if (regraded > 0) {
      const year = await tx.taxYear.findUnique({ where: { rpYear: currentRpYear } });
      if (year) {
        // Refund only what was actually funded by exemption credit, then rebill untouched lines.
        const candidates = await tx.taxAssessment.findMany({ where: {
          taxYearId: year.id, taxPolicy: { name: { not: "Ancien registre" } },
          allocations: { none: {} }, penalties: { none: {} }, adjustments: { none: {} }
        }, select: { id: true, ninjaId: true } });
        for (const assessment of candidates) {
          const debits = await tx.exemptionLedgerEntry.findMany({ where: { sourceType: "TaxAssessment", OR: [{ sourceId: assessment.id }, { sourceId: { startsWith: `${assessment.id}:` } }] } });
          const funded = debits.reduce((sum, entry) => sum - entry.amount, 0n);
          if (funded > 0n) {
            await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: funded, sourceType: "TaxAssessmentRefund", sourceId: assessment.id, reason: "Refacturation grades explicites du 07/08/2026 — crédit restitué" } });
            refunded += funded;
          }
          await tx.taxExemption.deleteMany({ where: { assessmentId: assessment.id } });
        }
        if (candidates.length) await tx.taxAssessment.deleteMany({ where: { id: { in: candidates.map((entry) => entry.id) } } });
        const active = await tx.ninjaProfile.findMany({ where: { status: "ACTIVE" }, include: { currentGrade: true } });
        const result = await tx.taxAssessment.createMany({ data: active.map((ninja) => ({
          ninjaId: ninja.id, taxYearId: year.id, taxPolicyId: policy.id, gradeCodeSnapshot: ninja.currentGrade.code, gradeLabelSnapshot: ninja.currentGrade.label,
          originalAmount: rates.get(ninja.currentGradeId) ?? 0n, dueAt: year.dueAt, status: year.dueAt > now ? "UPCOMING" as const : "DUE" as const
        })), skipDuplicates: true });
        rebilled = result.count;
        // Advance payments made at the bot settle the fresh lines again.
        const currentWeekKey = year.dueAt.toISOString().slice(0, 10);
        for (const ninja of kv.ninjas) {
          if (!ninja.taxes.some((record) => record.week === currentWeekKey && record.paid)) continue;
          const profile = profileByCode.get(codeOf(ninja.id));
          if (!profile) continue;
          const assessment = await tx.taxAssessment.findUnique({ where: { ninjaId_taxYearId: { ninjaId: profile.id, taxYearId: year.id } } });
          if (!assessment || assessment.originalAmount <= 0n || assessment.status === "PAID") continue;
          await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: assessment.originalAmount, reason: "Payée d’avance à l’ancien registre (07/08/2026)", grantedById: systemUser.id } });
          await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID", version: { increment: 1 } } });
          advanceSettled++;
        }
        // Whoever still owes is covered by their available credit, oldest rule as usual.
        const fresh = await tx.taxAssessment.findMany({ where: { taxYearId: year.id, originalAmount: { gt: 0 }, status: { in: ["UPCOMING", "DUE"] } }, select: { id: true, ninjaId: true, originalAmount: true } });
        for (const assessment of fresh) {
          const already = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "TaxAssessment", sourceId: assessment.id } } });
          if (already) continue;
          const balance = (await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId: assessment.ninjaId }, _sum: { amount: true } }))._sum.amount ?? 0n;
          if (balance <= 0n) continue;
          const use = balance < assessment.originalAmount ? balance : assessment.originalAmount;
          await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: -use, sourceType: "TaxAssessment", sourceId: assessment.id, reason: `Exonération automatique — taxe semaine RP ${currentRpYear}` } });
          await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: use, reason: "Exonération automatique (crédit de dons/rachats)", grantedById: systemUser.id } });
          if (use >= assessment.originalAmount) await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID", version: { increment: 1 } } });
          covered++;
        }
      }
    }
    await tx.appSetting.create({ data: { key: FLAG_FIX, value: { appliedAt: now.toISOString(), regraded, refunded: String(refunded), rebilled, advanceSettled, covered } } });
    await tx.auditLog.create({ data: { action: "KV_GRADES_EXPLICIT", entityType: "NinjaProfile", entityId: FLAG_FIX, requestId: randomUUID(), reason: `Grades explicites du bot appliqués : ${regraded} corrigés (drapeaux gradeStatus ignorés)${regraded ? ` — semaine refacturée (${rebilled} taxes, ${Number(refunded).toLocaleString("fr-FR")} ¥ restitués, ${advanceSettled} payées d’avance, ${covered} couvertes par crédit)` : ""}` } });
    console.log(`import-legacy/grades-kv : ${regraded} grades corrigés, ${rebilled} taxes refacturées, ${covered} couvertes`);
  }, { timeout: 600_000, maxWait: 30_000 });
}

async function main() {
  await importCore();
  await importTaxHistory();
  await importEvents();
  await fixCatalog();
  await taxAmnesty();
  await importExemptions();
  await fixTierExemptions();
  await updateCatalogPointsAndCategories();
  await setAllGradesGeninConfirmed();
  await mergeKvExport20260807();
  await fixExplicitGrades20260807();
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
