import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@koeki/database";
import { z } from "zod";
import { activePrice, writeAudit } from "./finance";
import { assertTeamActor } from "./team-service";
import { demoMode, hasPermission, type SessionInfo } from "./session";

const whole = (maximum: number) => z.string().trim().regex(/^\d+$/, "Saisissez un entier positif ou zéro").transform(Number).pipe(z.number().int().min(0).max(maximum));
export const resourceValuesSchema = z.object({
  resourceId: z.string().min(1).max(200),
  revision: z.string().regex(/^[a-f0-9]{64}$/, "Rechargez les valeurs avant de les modifier"),
  price: z.union([z.literal(""), whole(100_000_000)]),
  pointsPerUnit: whole(1_000_000),
  exemptionPerUnit: whole(100_000_000_000),
  demand: z.enum(["NONE", "NEEDED", "CRITICAL"]),
  reason: z.string().trim().min(3, "Expliquez le changement (3 caractères minimum)").max(300),
});

type Values = { pointsPerUnit: number; exemptionPerUnit: bigint; demand: string };
export function resourceValuesRevision(values: Values, price: bigint | null) {
  return createHash("sha256").update(JSON.stringify({
    price: price?.toString() ?? null,
    points: values.pointsPerUnit,
    exemption: values.exemptionPerUnit.toString(),
    demand: values.demand,
  })).digest("hex");
}

/** Value-only editor: no category, unit, stock or identity field can be changed. */
export async function saveResourceValues(session: SessionInfo, input: unknown) {
  if (demoMode || !hasPermission(session, "settings:manage")) throw new Error("FORBIDDEN");
  const data = resourceValuesSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await assertTeamActor(tx, session.userId, "settings:manage");
    // This form edits exactly one resource. Bind that ID directly and acquire
    // the same PostgreSQL row lock used by inventory/price mutations. Avoid
    // carrying a composed SQL/Set result across the Next.js module boundary.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Resource"
      WHERE "id" = ${data.resourceId}
      FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("VALIDATION:Ressource introuvable");
    const resource = await tx.resource.findUniqueOrThrow({ where: { id: data.resourceId } });
    const previousPrice = await activePrice(tx, data.resourceId);
    if (resourceValuesRevision(resource, previousPrice) !== data.revision) {
      throw new Error("VALIDATION:Ces valeurs ont changé depuis l’ouverture du formulaire. Rechargez la page avant de réessayer.");
    }
    if (data.price === "" && previousPrice !== null) {
      throw new Error("VALIDATION:Indiquez un prix ; saisissez zéro pour désactiver le rachat.");
    }
    const nextPrice = data.price === "" ? null : BigInt(data.price);
    const priceChanged = nextPrice !== previousPrice;
    const changed = priceChanged || resource.pointsPerUnit !== data.pointsPerUnit || resource.exemptionPerUnit !== BigInt(data.exemptionPerUnit) || resource.demand !== data.demand;
    if (!changed) return { changed: false };
    await tx.resource.update({ where: { id: data.resourceId }, data: {
      pointsPerUnit: data.pointsPerUnit,
      exemptionPerUnit: BigInt(data.exemptionPerUnit),
      demand: data.demand,
    } });
    if (priceChanged && nextPrice !== null) {
      const now = new Date();
      await tx.resourcePriceHistory.updateMany({ where: { resourceId: data.resourceId, effectiveTo: null }, data: { effectiveTo: now } });
      await tx.resourcePriceHistory.create({ data: { resourceId: data.resourceId, pricePerUnit: nextPrice, effectiveFrom: now, createdById: session.userId } });
    }
    await writeAudit(tx, {
      actorId: session.userId, action: "RESOURCE_VALUES_UPDATED", entityType: "Resource", entityId: data.resourceId, reason: data.reason,
      previousValues: { pricePerUnit: previousPrice?.toString() ?? null, pointsPerUnit: resource.pointsPerUnit, exemptionPerUnit: resource.exemptionPerUnit.toString(), demand: resource.demand },
      newValues: { pricePerUnit: nextPrice?.toString() ?? null, pointsPerUnit: data.pointsPerUnit, exemptionPerUnit: String(data.exemptionPerUnit), demand: data.demand },
    });
    // Never modify historical receipts, points entries, donation credits or stocks.
    return { changed: true };
  });
}

export async function getResourceValues(session: SessionInfo, filters: { q?: string | undefined; resourceId?: string | undefined; page?: string | undefined } = {}) {
  if (!hasPermission(session, "settings:manage")) throw new Error("FORBIDDEN");
  const q = (filters.q ?? "").trim().slice(0, 120);
  const where: Prisma.ResourceWhereInput = {
    ...(filters.resourceId ? { id: filters.resourceId } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const total = demoMode ? 0 : await prisma.resource.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / 20));
  const requested = Number(filters.page ?? 1);
  const page = Math.min(pageCount, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  const now = new Date();
  const resources = demoMode ? [] : await prisma.resource.findMany({
    where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20,
    include: { category: true, unit: true, prices: { where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }], take: 1 } },
  });
  return { q, total, page, pageCount, resources: resources.map((resource) => {
    const price = resource.prices[0]?.pricePerUnit ?? null;
    return { id: resource.id, code: resource.code, name: resource.name, category: resource.category.label, unit: resource.unit.label, active: resource.isActive,
      price, pointsPerUnit: resource.pointsPerUnit, exemptionPerUnit: resource.exemptionPerUnit, demand: resource.demand,
      revision: resourceValuesRevision(resource, price) };
  }) };
}
