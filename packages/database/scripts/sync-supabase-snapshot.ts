// Idempotent cutover of the last Supabase-backed register snapshot.
// The source table stays read-only: this script only writes to Koeki's PostgreSQL database.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

const FLAG = "supabaseSnapshot2026-08-09-v1";
const SNAPSHOT_FILE = "supabase-2026-08-09.json";

interface RawDonation {
  id: string;
  date: string;
  items: string;
  pts: number;
  by: string;
}

interface RawTax {
  week: string;
  paid: boolean;
}

interface RawNinja {
  id: number;
  name: string;
  points: number;
  exo: number | null;
  grade: string | null;
  taxes: RawTax[];
  donations: RawDonation[];
}

interface RawEquipment {
  id: string;
  name: string;
  grade: string;
  equipment: Record<string, { tier: string; type: string | null }>;
}

interface Snapshot {
  exportedAt: string;
  sourceUpdatedAt: Record<string, string>;
  ninjas: RawNinja[];
  equipment: RawEquipment[];
  resourcePoints: Record<string, number>;
  rachatResources: Record<string, number>;
}

interface PreparedDonation extends RawDonation {
  ninjaExternalId: number;
}

interface PreparedSnapshot {
  snapshot: Snapshot;
  ninjas: RawNinja[];
  canonicalIdBySourceId: Map<number, number>;
  canonicalByName: Map<string, RawNinja>;
  duplicateExternalIds: Array<{ duplicateId: number; canonicalId: number; name: string }>;
  donations: PreparedDonation[];
  equipmentByName: Map<string, RawEquipment>;
}

interface ProfileRef {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  currentGradeId: string;
  status: string;
  userId: string | null;
  notes: string | null;
}

const NINJA_GRADE_CODES: Record<string, string> = {
  GC: "GENIN_CONFIRMED",
  C: "CHUNIN",
  K: "KONIN",
  TKJ: "TOKUBETSU_JONIN"
};

const EQUIPMENT_GRADE_CODES: Record<string, string> = {
  jonin: "JONIN",
  cmj: "JONIN_COMMANDER",
  kage: "KAGE"
};

const RESOURCE_NAMES: Record<string, string> = {
  bois: "Bois",
  laine: "Laine",
  plastique: "Plastique",
  cuivre: "Cuivre",
  fer: "Fer",
  titane: "Titane",
  chakra: "Chakra Métal",
  jade: "Jade",
  t1: "T1",
  t2: "T2",
  t3: "T3",
  t4: "T4",
  ryo: "Ryo",
  lavande: "Lavande"
};

const loadSnapshot = (): Snapshot => JSON.parse(readFileSync(join(__dirname, "..", "data", "import", SNAPSHOT_FILE), "utf8")) as Snapshot;

const normalizeName = (value: string): string => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

// The equipment sheet contains one extra "i" compared with the canonical ninja record.
const canonicalEquipmentName = (value: string): string => {
  const normalized = normalizeName(value);
  return normalized === "seiren chiikatsume" ? "seiren chikatsume" : normalized;
};

const ninjaScore = (ninja: RawNinja): number =>
  (ninja.grade ? 100_000 : 0)
  + (ninja.donations?.length ?? 0) * 1_000
  + (ninja.taxes?.length ?? 0) * 10
  + (ninja.points !== 0 ? 2 : 0)
  + ((ninja.exo ?? 0) !== 0 ? 1 : 0);

const splitName = (name: string): { firstName: string; lastName: string } => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? name.trim(), lastName: parts.slice(1).join(" ") };
};

const parseDonationItems = (value: string): Array<{ quantity: number; name: string }> => value
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean)
  .map((part) => {
    const match = part.match(/^(\d+(?:[.,]\d+)?)x\s+(.+)$/i);
    if (!match) throw new Error(`Format de don invalide : ${part}`);
    return { quantity: Number(match[1]!.replace(",", ".")), name: match[2]!.trim() };
  });

const parseDonationDate = (value: string): Date => {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Date de don invalide : ${value}`);
  const [, day, month, year, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Date de don invalide : ${value}`);
  return parsed;
};

const prepareSnapshot = (snapshot: Snapshot): PreparedSnapshot => {
  const groups = new Map<string, RawNinja[]>();
  for (const ninja of snapshot.ninjas) {
    const key = normalizeName(ninja.name);
    const group = groups.get(key) ?? [];
    group.push(ninja);
    groups.set(key, group);
  }

  const ninjas: RawNinja[] = [];
  const canonicalIdBySourceId = new Map<number, number>();
  const canonicalByName = new Map<string, RawNinja>();
  const duplicateExternalIds: PreparedSnapshot["duplicateExternalIds"] = [];
  for (const [name, group] of groups) {
    const ranked = [...group].sort((a, b) => ninjaScore(b) - ninjaScore(a) || a.id - b.id);
    const canonical = ranked[0]!;
    ninjas.push(canonical);
    canonicalByName.set(name, canonical);
    for (const source of group) {
      canonicalIdBySourceId.set(source.id, canonical.id);
      if (source.id !== canonical.id) duplicateExternalIds.push({ duplicateId: source.id, canonicalId: canonical.id, name: canonical.name });
    }
  }
  ninjas.sort((a, b) => a.id - b.id);

  const donationById = new Map<string, PreparedDonation>();
  for (const ninja of snapshot.ninjas) {
    const ninjaExternalId = canonicalIdBySourceId.get(ninja.id)!;
    for (const donation of ninja.donations ?? []) {
      if (donationById.has(donation.id)) throw new Error(`Identifiant de don dupliqué dans Supabase : ${donation.id}`);
      parseDonationDate(donation.date);
      parseDonationItems(donation.items);
      donationById.set(donation.id, { ...donation, ninjaExternalId });
    }
  }

  // Last row wins: the sheet contains a newer lowercase duplicate for Seisura Sabaku.
  const equipmentByName = new Map<string, RawEquipment>();
  for (const equipment of snapshot.equipment) equipmentByName.set(canonicalEquipmentName(equipment.name), equipment);

  return {
    snapshot,
    ninjas,
    canonicalIdBySourceId,
    canonicalByName,
    duplicateExternalIds,
    donations: [...donationById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    equipmentByName
  };
};

const gradeCodeFor = (ninja: RawNinja, equipment: RawEquipment | undefined): string => {
  if (equipment) {
    const equipmentGrade = EQUIPMENT_GRADE_CODES[normalizeName(equipment.grade)];
    if (!equipmentGrade) throw new Error(`Grade d'équipement inconnu : ${equipment.grade}`);
    return equipmentGrade;
  }
  if (!ninja.grade) return "UNKNOWN";
  const grade = NINJA_GRADE_CODES[ninja.grade];
  if (!grade) throw new Error(`Grade ninja inconnu : ${ninja.grade}`);
  return grade;
};

const dryRun = (prepared: PreparedSnapshot): void => {
  const unmatchedEquipment = [...prepared.equipmentByName.keys()].filter((name) => !prepared.canonicalByName.has(name));
  const nonZeroBuybackPrices = Object.values(prepared.snapshot.rachatResources).filter((value) => value !== 0).length;
  const donationPoints = prepared.donations.reduce((total, donation) => total + donation.pts, 0);
  console.log(JSON.stringify({
    sourceNinjas: prepared.snapshot.ninjas.length,
    canonicalNinjas: prepared.ninjas.length,
    duplicateNinjas: prepared.duplicateExternalIds,
    donations: prepared.donations.length,
    donationPoints,
    uniqueEquipmentRows: prepared.equipmentByName.size,
    unmatchedEquipment,
    buybackTransactions: 0,
    buybackPriceEntries: Object.keys(prepared.snapshot.rachatResources).length,
    nonZeroBuybackPrices
  }, null, 2));
};

async function syncSnapshot(prepared: PreparedSnapshot): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public";
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const already = await prisma.appSetting.findUnique({ where: { key: FLAG } });
    if (already) {
      console.log("sync-supabase : snapshot déjà appliqué — rien à faire");
      return;
    }

    const [grades, systemUser, resources] = await Promise.all([
      prisma.ninjaGrade.findMany(),
      prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } }),
      prisma.resource.findMany({ select: { id: true, name: true } })
    ]);
    if (!systemUser) throw new Error("Aucun SUPER_ADMIN disponible pour tracer la synchronisation");
    const gradeByCode = new Map(grades.map((grade) => [grade.code, grade]));
    if (!gradeByCode.has("UNKNOWN")) throw new Error("Le grade UNKNOWN doit être créé par import:legacy avant cette synchronisation");
    const resourceByName = new Map(resources.map((resource) => [normalizeName(resource.name), resource]));

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const profiles = await tx.ninjaProfile.findMany({
        select: { id: true, code: true, firstName: true, lastName: true, currentGradeId: true, status: true, userId: true, notes: true }
      });
      const profileByCode = new Map(profiles.map((profile) => [profile.code, profile as ProfileRef]));
      const profilesByName = new Map<string, ProfileRef[]>();
      for (const profile of profiles) {
        const name = normalizeName(`${profile.firstName} ${profile.lastName}`);
        const rows = profilesByName.get(name) ?? [];
        rows.push(profile as ProfileRef);
        profilesByName.set(name, rows);
      }

      const canonicalProfileByExternalId = new Map<number, ProfileRef>();
      const canonicalProfileByName = new Map<string, ProfileRef>();
      let created = 0;
      let updated = 0;
      let regraded = 0;

      for (const ninja of prepared.ninjas) {
        const code = `NIN-${String(ninja.id).padStart(6, "0")}`;
        const nameKey = normalizeName(ninja.name);
        const equipment = prepared.equipmentByName.get(nameKey);
        const targetGrade = gradeByCode.get(gradeCodeFor(ninja, equipment));
        if (!targetGrade) throw new Error(`Grade cible absent pour ${ninja.name}`);
        const names = splitName(ninja.name);
        let profile = profileByCode.get(code);

        // Reuse a manually-created exact-name profile when the external code is not present.
        if (!profile) profile = (profilesByName.get(nameKey) ?? []).find((entry) => entry.status !== "ARCHIVED") ?? profilesByName.get(nameKey)?.[0];
        if (!profile) {
          const fresh = await tx.ninjaProfile.create({ data: {
            code,
            firstName: names.firstName,
            lastName: names.lastName,
            currentGradeId: targetGrade.id,
            notes: "Synchronisé depuis le dernier registre Supabase (09/08/2026)"
          } });
          await tx.ninjaGradeHistory.create({ data: {
            ninjaId: fresh.id,
            gradeId: targetGrade.id,
            effectiveFrom: now,
            reason: "Synchronisation du registre Supabase (09/08/2026)",
            changedById: systemUser.id
          } });
          profile = {
            id: fresh.id,
            code: fresh.code,
            firstName: fresh.firstName,
            lastName: fresh.lastName,
            currentGradeId: fresh.currentGradeId,
            status: fresh.status,
            userId: fresh.userId,
            notes: fresh.notes
          };
          created++;
        } else {
          const gradeChanged = profile.currentGradeId !== targetGrade.id;
          if (gradeChanged) {
            await tx.ninjaGradeHistory.updateMany({ where: { ninjaId: profile.id, effectiveTo: null }, data: { effectiveTo: now } });
            await tx.ninjaGradeHistory.create({ data: {
              ninjaId: profile.id,
              gradeId: targetGrade.id,
              effectiveFrom: now,
              reason: "Synchronisation du registre Supabase (09/08/2026)",
              changedById: systemUser.id
            } });
            regraded++;
          }
          const changed = profile.code !== code
            || profile.firstName !== names.firstName
            || profile.lastName !== names.lastName
            || profile.status === "ARCHIVED"
            || gradeChanged;
          if (changed) {
            const saved = await tx.ninjaProfile.update({ where: { id: profile.id }, data: {
              code,
              firstName: names.firstName,
              lastName: names.lastName,
              status: "ACTIVE",
              currentGradeId: targetGrade.id,
              version: { increment: 1 }
            } });
            profile = { ...profile, code: saved.code, firstName: saved.firstName, lastName: saved.lastName, status: saved.status, currentGradeId: saved.currentGradeId };
            updated++;
          }
        }
        profileByCode.set(code, profile);
        canonicalProfileByExternalId.set(ninja.id, profile);
        canonicalProfileByName.set(nameKey, profile);
      }

      const duplicatePairs: Array<{ duplicate: ProfileRef; canonical: ProfileRef }> = [];
      for (const duplicate of prepared.duplicateExternalIds) {
        const duplicateCode = `NIN-${String(duplicate.duplicateId).padStart(6, "0")}`;
        const duplicateProfile = profileByCode.get(duplicateCode);
        const canonicalProfile = canonicalProfileByExternalId.get(duplicate.canonicalId);
        if (duplicateProfile && canonicalProfile && duplicateProfile.id !== canonicalProfile.id) duplicatePairs.push({ duplicate: duplicateProfile, canonical: canonicalProfile });
      }
      const seirenCanonical = canonicalProfileByName.get("seiren chikatsume");
      if (seirenCanonical) {
        for (const typoProfile of profilesByName.get("seiren chiikatsume") ?? []) {
          if (typoProfile.id !== seirenCanonical.id) duplicatePairs.push({ duplicate: typoProfile, canonical: seirenCanonical });
        }
      }

      let archivedDuplicates = 0;
      let removedDuplicateAssessments = 0;
      const archivedIds = new Set<string>();
      for (const { duplicate, canonical } of duplicatePairs) {
        if (archivedIds.has(duplicate.id)) continue;
        archivedIds.add(duplicate.id);
        if (duplicate.userId) {
          if (canonical.userId && canonical.userId !== duplicate.userId) throw new Error(`Deux comptes sont liés au doublon ${duplicate.code}`);
          if (!canonical.userId) {
            await tx.ninjaProfile.update({ where: { id: duplicate.id }, data: { userId: null } });
            await tx.ninjaProfile.update({ where: { id: canonical.id }, data: { userId: duplicate.userId } });
            canonical.userId = duplicate.userId;
          }
        }
        const untouched = await tx.taxAssessment.findMany({ where: {
          ninjaId: duplicate.id,
          allocations: { none: {} },
          penalties: { none: {} },
          adjustments: { none: {} },
          exemptions: { none: {} }
        }, select: { id: true } });
        if (untouched.length) {
          const deleted = await tx.taxAssessment.deleteMany({ where: { id: { in: untouched.map((assessment) => assessment.id) } } });
          removedDuplicateAssessments += deleted.count;
        }
        if (duplicate.status !== "ARCHIVED") {
          await tx.ninjaProfile.update({ where: { id: duplicate.id }, data: {
            status: "ARCHIVED",
            userId: null,
            notes: `${duplicate.notes ? `${duplicate.notes}\n` : ""}Doublon archivé au profit de ${canonical.code} lors de la synchronisation Supabase.`,
            version: { increment: 1 }
          } });
          archivedDuplicates++;
        }
      }

      const canonicalProfileIds = [...new Set([...canonicalProfileByExternalId.values()].map((profile) => profile.id))];
      const [pointGroups, exemptionGroups] = await Promise.all([
        tx.pointLedgerEntry.groupBy({ by: ["ninjaId"], where: { ninjaId: { in: canonicalProfileIds } }, _sum: { points: true } }),
        tx.exemptionLedgerEntry.groupBy({ by: ["ninjaId"], where: { ninjaId: { in: canonicalProfileIds } }, _sum: { amount: true } })
      ]);
      const pointsByProfile = new Map(pointGroups.map((entry) => [entry.ninjaId, entry._sum.points ?? 0]));
      const exemptionsByProfile = new Map(exemptionGroups.map((entry) => [entry.ninjaId, entry._sum.amount ?? 0n]));
      const pointAdjustments: Prisma.PointLedgerEntryCreateManyInput[] = [];
      const exemptionAdjustments: Prisma.ExemptionLedgerEntryCreateManyInput[] = [];
      for (const ninja of prepared.ninjas) {
        const profile = canonicalProfileByExternalId.get(ninja.id)!;
        const pointsDelta = ninja.points - (pointsByProfile.get(profile.id) ?? 0);
        if (pointsDelta !== 0) pointAdjustments.push({
          ninjaId: profile.id,
          eventType: "MANUAL_ADJUSTMENT",
          points: pointsDelta,
          sourceType: "Import",
          sourceId: `${FLAG}:points:${ninja.id}`,
          reason: "Recalage sur le dernier registre Supabase (09/08/2026)"
        });
        const exemptionDelta = BigInt(ninja.exo ?? 0) - (exemptionsByProfile.get(profile.id) ?? 0n);
        if (exemptionDelta !== 0n) exemptionAdjustments.push({
          ninjaId: profile.id,
          amount: exemptionDelta,
          sourceType: "Import",
          sourceId: `${FLAG}:exo:${ninja.id}`,
          reason: "Recalage sur le dernier registre Supabase (09/08/2026)"
        });
      }
      if (pointAdjustments.length) await tx.pointLedgerEntry.createMany({ data: pointAdjustments, skipDuplicates: true });
      if (exemptionAdjustments.length) await tx.exemptionLedgerEntry.createMany({ data: exemptionAdjustments, skipDuplicates: true });

      const donationKeys = prepared.donations.map((donation) => `kv-don-${donation.id}`);
      const existingDonations = await tx.resourceTransaction.findMany({ where: { idempotencyKey: { in: donationKeys } }, select: { idempotencyKey: true } });
      const existingDonationKeys = new Set(existingDonations.map((donation) => donation.idempotencyKey));
      const unmatchedDonationItems = new Set<string>();
      let donationsImported = 0;
      for (const donation of prepared.donations) {
        const idempotencyKey = `kv-don-${donation.id}`;
        if (existingDonationKeys.has(idempotencyKey)) continue;
        const profile = canonicalProfileByExternalId.get(donation.ninjaExternalId);
        if (!profile) throw new Error(`Ninja introuvable pour le don ${donation.id}`);
        const items = parseDonationItems(donation.items).flatMap((item) => {
          const resource = resourceByName.get(normalizeName(item.name));
          if (!resource) {
            unmatchedDonationItems.add(item.name);
            return [];
          }
          return [{ resourceId: resource.id, quantity: item.quantity }];
        });
        const when = parseDonationDate(donation.date);
        await tx.resourceTransaction.create({ data: {
          id: idempotencyKey,
          receiptNumber: `DON-BOT-${donation.id}`,
          type: "DONATION",
          status: "VALIDATED",
          ninjaId: profile.id,
          agentId: systemUser.id,
          totalAmount: 0n,
          totalPoints: donation.pts,
          idempotencyKey,
          validatedAt: when,
          createdAt: when,
          ...(items.length ? { items: { createMany: { data: items.map((item) => ({
            resourceId: item.resourceId,
            quantity: new Prisma.Decimal(item.quantity),
            unitPriceSnapshot: 0n,
            lineTotal: 0n
          })) } } } : {})
        } });
        donationsImported++;
      }

      // Apply the Supabase point scale. Tier values intentionally cover both the generic
      // resource (T1..T4) and catalog entries ending in that tier, matching the old register.
      let pointScaleUpdated = 0;
      for (const [key, value] of Object.entries(prepared.snapshot.resourcePoints)) {
        const name = RESOURCE_NAMES[key];
        if (!name) continue;
        const where: Prisma.ResourceWhereInput = ["t1", "t2", "t3", "t4"].includes(key)
          ? { OR: [{ name: { endsWith: ` ${name}` } }, { name }] }
          : { name: { equals: name, mode: "insensitive" } };
        const changed = await tx.resource.updateMany({ where, data: { pointsPerUnit: value } });
        pointScaleUpdated += changed.count;
      }

      // Supabase has no historical buyback transactions or equipment plans, but it does have
      // the resource buyback price table. A zero disables that resource; a positive value
      // replaces the active price with an auditable history row.
      let buybackPricesClosed = 0;
      let buybackPricesCreated = 0;
      let buybackPricesUnchanged = 0;
      const unmatchedBuybackResources: string[] = [];
      for (const [key, value] of Object.entries(prepared.snapshot.rachatResources)) {
        const name = RESOURCE_NAMES[key];
        if (!name) continue;
        const resource = resourceByName.get(normalizeName(name));
        if (!resource) {
          unmatchedBuybackResources.push(name);
          continue;
        }
        if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Prix de rachat invalide pour ${name} : ${value}`);
        const activePrice = await tx.resourcePriceHistory.findFirst({
          where: { resourceId: resource.id, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          orderBy: { effectiveFrom: "desc" }
        });
        const targetPrice = BigInt(value);
        if (targetPrice === 0n) {
          const closed = await tx.resourcePriceHistory.updateMany({ where: { resourceId: resource.id, effectiveTo: null }, data: { effectiveTo: now } });
          buybackPricesClosed += closed.count;
        } else if (activePrice?.pricePerUnit === targetPrice) {
          buybackPricesUnchanged++;
        } else {
          await tx.resourcePriceHistory.updateMany({ where: { resourceId: resource.id, effectiveTo: null }, data: { effectiveTo: now } });
          await tx.resourcePriceHistory.create({ data: { resourceId: resource.id, pricePerUnit: targetPrice, effectiveFrom: now, createdById: systemUser.id } });
          buybackPricesCreated++;
        }
      }

      let equipmentUpdated = 0;
      const unmatchedEquipment: string[] = [];
      for (const [name, equipment] of prepared.equipmentByName) {
        const sourceNinja = prepared.canonicalByName.get(name);
        const profile = sourceNinja ? canonicalProfileByExternalId.get(sourceNinja.id) : undefined;
        if (!profile) {
          unmatchedEquipment.push(equipment.name);
          continue;
        }
        await tx.ninjaEquipment.upsert({
          where: { ninjaId: profile.id },
          create: { ninjaId: profile.id, slots: equipment.equipment as Prisma.InputJsonValue, updatedById: systemUser.id },
          update: { slots: equipment.equipment as Prisma.InputJsonValue, updatedById: systemUser.id }
        });
        equipmentUpdated++;
      }

      const audit = {
        sourceRows: prepared.snapshot.ninjas.length,
        canonicalNinjas: prepared.ninjas.length,
        created,
        updated,
        regraded,
        archivedDuplicates,
        removedDuplicateAssessments,
        donationsFound: prepared.donations.length,
        donationsImported,
        pointAdjustments: pointAdjustments.length,
        exemptionAdjustments: exemptionAdjustments.length,
        equipmentUpdated,
        pointScaleUpdated,
        unmatchedEquipment,
        unmatchedDonationItems: [...unmatchedDonationItems],
        buybackTransactionsFound: 0,
        buybackPriceEntriesFound: Object.keys(prepared.snapshot.rachatResources).length,
        buybackPricesClosed,
        buybackPricesCreated,
        buybackPricesUnchanged,
        unmatchedBuybackResources
      };
      await tx.appSetting.create({ data: { key: FLAG, value: { appliedAt: now.toISOString(), ...audit } } });
      await tx.auditLog.create({ data: {
        action: "SUPABASE_SNAPSHOT_SYNC",
        entityType: "NinjaProfile",
        entityId: FLAG,
        requestId: randomUUID(),
        reason: `Dernier registre Supabase synchronisé : ${prepared.ninjas.length} ninjas canoniques, ${donationsImported} nouveaux dons, ${archivedDuplicates} doublons archivés, ${equipmentUpdated} panoplies, ${buybackPricesClosed} prix de rachat désactivés.`,
        newValues: audit
      } });
      return audit;
    }, { timeout: 600_000, maxWait: 30_000 });

    console.log(`sync-supabase : ${result.canonicalNinjas} ninjas, ${result.donationsImported} nouveaux dons, ${result.archivedDuplicates} doublons archivés, ${result.equipmentUpdated} panoplies`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const prepared = prepareSnapshot(loadSnapshot());
  if (process.argv.includes("--dry-run")) {
    dryRun(prepared);
    return;
  }
  await syncSnapshot(prepared);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
