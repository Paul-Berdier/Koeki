// Inventory referential shared by the production bootstrap and the local demo seed.
// Idempotent: units and categories are upserted by code; each catalog resource is matched by
// stable code first, then by historical name (the old register called "Plan T1" simply "T1"),
// and only created when nothing matches. Nothing is ever deleted or re-quantified here —
// quantities always come from movements (first physical count).
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export const UNIT_SEED = [
  ["unit-unite", "UNIT", "unité", 0, 10], ["unit-piece", "PIECE", "pièce", 0, 20], ["unit-kg", "KG", "kg", 3, 30], ["unit-g", "G", "g", 0, 40],
  ["unit-m", "M", "m", 2, 50], ["unit-l", "L", "L", 2, 60], ["unit-lot", "LOT", "lot", 0, 70], ["unit-ryo", "RYO", "Ryō", 0, 80]
] as const;

export const INVENTORY_CATEGORY_SEED = [
  ["PLANS", "Plans", 10], ["CHAKRA", "Chakra", 20], ["METALS", "Métaux", 30], ["MATERIALS", "Matériaux", 40],
  ["TEXTILES", "Textiles", 50], ["TREASURY", "Trésorerie", 60], ["OTHER", "Autre", 900]
] as const;

export interface ResourceSeed { code: string; name: string; category: string; unit: string; aliases: string[]; matchNames: string[]; description?: string }

export const INVENTORY_RESOURCE_SEED: ResourceSeed[] = [
  { code: "RES-PLAN-T1", name: "Plan T1", category: "PLANS", unit: "UNIT", aliases: ["T1"], matchNames: ["T1", "Plan T1"] },
  { code: "RES-PLAN-T2", name: "Plan T2", category: "PLANS", unit: "UNIT", aliases: ["T2"], matchNames: ["T2", "Plan T2"] },
  { code: "RES-PLAN-T3", name: "Plan T3", category: "PLANS", unit: "UNIT", aliases: ["T3"], matchNames: ["T3", "Plan T3"] },
  { code: "RES-PLAN-T4", name: "Plan T4", category: "PLANS", unit: "UNIT", aliases: ["T4"], matchNames: ["T4", "Plan T4"] },
  { code: "RES-CHAKRA-PART", name: "Pièces Chakra", category: "CHAKRA", unit: "UNIT", aliases: ["Chakra Métal", "Chakra", "Pièce Chakra"], matchNames: ["Chakra Métal", "Pièces Chakra", "Pièce Chakra", "Chakra"] },
  { code: "RES-TITANIUM", name: "Titane", category: "METALS", unit: "KG", aliases: ["Titanium"], matchNames: ["Titane"] },
  { code: "RES-IRON", name: "Fer", category: "METALS", unit: "KG", aliases: ["Iron"], matchNames: ["Fer"] },
  { code: "RES-COPPER", name: "Cuivre", category: "METALS", unit: "KG", aliases: ["Copper"], matchNames: ["Cuivre"] },
  { code: "RES-JADE", name: "Jade", category: "MATERIALS", unit: "UNIT", aliases: [], matchNames: ["Jade"] },
  { code: "RES-PLASTIC", name: "Plastique", category: "MATERIALS", unit: "UNIT", aliases: ["Plastic"], matchNames: ["Plastique"] },
  { code: "RES-WOOD", name: "Bois", category: "MATERIALS", unit: "UNIT", aliases: ["Wood"], matchNames: ["Bois"] },
  { code: "RES-WOOL", name: "Laine", category: "TEXTILES", unit: "UNIT", aliases: ["Wool"], matchNames: ["Laine"] },
  // Treasury: no central cash ledger exists in Kōeki, so the Ryō balance is tracked like any
  // other counted resource (see docs/INVENTORY_AUDIT.md § 10). Excluded from dons/rachats.
  { code: "RES-RYO", name: "Ryōs", category: "TREASURY", unit: "RYO", aliases: ["Ryo", "Ryō", "Ryos"], matchNames: ["Ryo", "Ryō", "Ryōs", "Ryos"], description: "Trésorerie du service économique — solde tenu par comptage et mouvements manuels" }
];

type Db = PrismaClient | Prisma.TransactionClient;

export async function seedInventoryReferential(prisma: Db, actorId: string | null) {
  for (const [id, code, label, decimals, sortOrder] of UNIT_SEED) {
    await prisma.resourceUnit.upsert({ where: { code }, create: { id, code, label, decimals, sortOrder }, update: { label, decimals, sortOrder } });
  }
  const categories = new Map<string, string>();
  for (const [code, label, sortOrder] of INVENTORY_CATEGORY_SEED) {
    const category = await prisma.resourceCategory.upsert({ where: { code }, create: { code, label, sortOrder }, update: { sortOrder } });
    categories.set(code, category.id);
  }
  const units = new Map((await prisma.resourceUnit.findMany()).map((unit) => [unit.code, unit.id]));
  let created = 0, aligned = 0;
  for (const seed of INVENTORY_RESOURCE_SEED) {
    const categoryId = categories.get(seed.category)!;
    const unitId = units.get(seed.unit)!;
    const byCode = await prisma.resource.findUnique({ where: { code: seed.code } });
    if (byCode) { await ensureAliases(prisma, byCode.id, seed.aliases); continue; }
    const byName = await prisma.resource.findFirst({ where: { OR: seed.matchNames.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) }, orderBy: { code: "asc" } });
    if (byName) {
      const previous = { code: byName.code, name: byName.name, categoryId: byName.categoryId, unitId: byName.unitId, isActive: byName.isActive };
      await prisma.resource.update({ where: { id: byName.id }, data: { code: seed.code, name: seed.name, categoryId, unitId, isActive: true, ...(seed.description && !byName.description ? { description: seed.description } : {}) } });
      await ensureAliases(prisma, byName.id, [...seed.aliases, ...(byName.name !== seed.name ? [byName.name] : []), byName.code]);
      await prisma.auditLog.create({ data: { actorId, action: "RESOURCE_ALIGNED", entityType: "Resource", entityId: byName.id, requestId: randomUUID(), reason: `Catalogue d’inventaire : « ${byName.name} » (${byName.code}) devient « ${seed.name} » (${seed.code})`, previousValues: previous, newValues: { code: seed.code, name: seed.name, categoryId, unitId, isActive: true } } });
      aligned++;
      continue;
    }
    const resource = await prisma.resource.create({ data: { code: seed.code, name: seed.name, categoryId, unitId, minimumStock: 0, criticalStock: 0, description: seed.description ?? null } });
    await ensureAliases(prisma, resource.id, seed.aliases);
    await prisma.auditLog.create({ data: { actorId, action: "RESOURCE_CREATED", entityType: "Resource", entityId: resource.id, requestId: randomUUID(), reason: "Catalogue d’inventaire initial", newValues: { code: seed.code, name: seed.name } } });
    created++;
  }
  return { created, aligned };
}

async function ensureAliases(prisma: Db, resourceId: string, aliases: string[]) {
  const unique = [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
  if (unique.length) await prisma.resourceAlias.createMany({ data: unique.map((alias) => ({ resourceId, alias })), skipDuplicates: true });
}
