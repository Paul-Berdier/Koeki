// Shared helpers for the PostgreSQL-backed integration tests. Every fixture gets a unique
// suffix so test files never collide and never need to delete immutable ledger lines.
import { randomUUID } from "node:crypto";
import { prisma } from "@koeki/database";

export const suffix = () => randomUUID().slice(0, 8).toUpperCase();

export async function ensureReferential() {
  const category = await prisma.resourceCategory.upsert({ where: { code: "TEST" }, create: { code: "TEST", label: "Tests", sortOrder: 950 }, update: {} });
  const treasury = await prisma.resourceCategory.upsert({ where: { code: "TREASURY" }, create: { code: "TREASURY", label: "Trésorerie", sortOrder: 60 }, update: {} });
  const [unite, kg, ryo] = await Promise.all([
    prisma.resourceUnit.findUniqueOrThrow({ where: { code: "UNIT" } }),
    prisma.resourceUnit.findUniqueOrThrow({ where: { code: "KG" } }),
    prisma.resourceUnit.findUniqueOrThrow({ where: { code: "RYO" } })
  ]);
  const grade = await prisma.ninjaGrade.upsert({ where: { code: "GENIN" }, create: { code: "GENIN", label: "Genin simple", sortOrder: 2 }, update: {} });
  return { category, treasury, unite, kg, ryo, grade };
}

export async function createTestUser(name = "Agent Test") {
  return prisma.user.create({ data: { email: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix().toLowerCase()}@koeki.test`, name } });
}

export async function createTestNinja(gradeId: string, firstName = "Aoki", lastName = "Hoki") {
  return prisma.ninjaProfile.create({ data: { code: `TST-${suffix()}`, firstName, lastName, currentGradeId: gradeId } });
}

export async function createTestResource(input: { categoryId: string; unitId: string; name?: string; minimumStock?: number; criticalStock?: number; isActive?: boolean }) {
  const code = `TEST-${suffix()}`;
  return prisma.resource.create({ data: { code, name: input.name ?? `Ressource ${code}`, categoryId: input.categoryId, unitId: input.unitId, minimumStock: input.minimumStock ?? 0, criticalStock: input.criticalStock ?? 0, isActive: input.isActive ?? true } });
}

export async function ledgerSum(resourceId: string) {
  const aggregate = await prisma.inventoryMovement.aggregate({ where: { resourceId }, _sum: { quantity: true } });
  return Number(aggregate._sum.quantity ?? 0);
}

export async function cachedQuantity(resourceId: string) {
  const resource = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
  return Number(resource.currentQuantity);
}
