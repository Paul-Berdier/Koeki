// Single writer of the stock ledger. Every stock change in Kōeki — manual entry or exit,
// don, rachat, atelier, comptage, correction — goes through `recordMovement`, inside the
// caller's transaction:
//   1. row lock on the resource (FOR UPDATE, ids sorted to avoid deadlocks);
//   2. current stock = SUM(movements) — the ledger is the source of truth;
//   3. unit precision and negative-stock checks (override only with inventory:adjust);
//   4. immutable movement line with before/after, counterparty, agent, reason, source;
//   5. the database trigger keeps Resource.currentQuantity / lastMovementAt in step.
// Business errors are thrown as "VALIDATION:<message>" like the rest of the server actions.
import { Prisma, type CounterpartyType, type InventoryMovementType, type PrismaClient } from "@koeki/database";
import { QUANTITY_SCALE, planStocktake, type InventoryStatusCode } from "@koeki/domain";

export type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

const fail = (message: string): never => { throw new Error(`VALIDATION:${message}`); };

/** Serialises stock-sensitive mutations. IDs are sorted so multi-resource commands
 *  always acquire locks in the same order and cannot deadlock one another. */
export async function lockResources(tx: Tx, resourceIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(resourceIds)].sort();
  if (!ids.length) return new Set();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Resource"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `;
  return new Set(rows.map((row) => row.id));
}

/** Ledger truth for one resource (the cached `currentQuantity` is only a read optimisation). */
export async function ledgerStock(db: Db, resourceId: string): Promise<Prisma.Decimal> {
  const aggregate = await db.inventoryMovement.aggregate({ where: { resourceId }, _sum: { quantity: true } });
  return new Prisma.Decimal(aggregate._sum.quantity ?? 0);
}

export type Counterparty =
  | { type: "NINJA"; ninjaId: string; label?: string | undefined }
  | { type: "EXTERNAL"; label: string };

export interface MovementInput {
  resourceId: string;
  type: InventoryMovementType;
  /** Signed quantity: positive = entry, negative = exit. Zero is only accepted for INITIAL_BALANCE. */
  quantity: Prisma.Decimal | number | string;
  agentId: string;
  reason: string;
  notes?: string | null | undefined;
  counterparty?: Counterparty | null | undefined;
  unitCost?: bigint | null | undefined;
  transactionId?: string | null | undefined;
  craftExecutionId?: string | null | undefined;
  sourceType?: string | null | undefined;
  sourceId?: string | null | undefined;
  reversedMovementId?: string | null | undefined;
  idempotencyKey: string;
  /** Explicit audited override: the caller must have checked inventory:adjust. */
  allowNegative?: boolean | undefined;
  /** Marks the resource as physically counted (initial balance, stocktake). */
  markCounted?: boolean | undefined;
  occurredAt?: Date | undefined;
}

export interface RecordedMovement { id: string; before: Prisma.Decimal; after: Prisma.Decimal; quantity: Prisma.Decimal; resourceName: string; unitLabel: string; unitDecimals: number }

export async function recordMovement(tx: Tx, input: MovementInput): Promise<RecordedMovement> {
  const locked = await lockResources(tx, [input.resourceId]);
  if (!locked.has(input.resourceId)) fail("Ressource introuvable");
  const resource = await tx.resource.findUnique({ where: { id: input.resourceId }, include: { unit: true } });
  if (!resource) return fail("Ressource introuvable");
  if (!resource.isActive) fail(`${resource.name} est désactivée — réactivez-la depuis le catalogue avant tout mouvement`);
  const quantity = new Prisma.Decimal(input.quantity);
  if (!quantity.isFinite()) fail("Quantité invalide");
  if (quantity.decimalPlaces() > Math.min(QUANTITY_SCALE, resource.unit.decimals)) {
    fail(resource.unit.decimals === 0 ? `${resource.name} se compte en ${resource.unit.label}s entières` : `${resource.unit.decimals} décimale${resource.unit.decimals > 1 ? "s" : ""} maximum pour ${resource.name} (${resource.unit.label})`);
  }
  if (quantity.isZero() && input.type !== "INITIAL_BALANCE") fail("La quantité doit être différente de zéro");
  const before = await ledgerStock(tx, input.resourceId);
  const after = before.add(quantity);
  if (after.isNegative() && !input.allowNegative) {
    fail(`Stock insuffisant pour ${resource.name} — disponible : ${formatDecimal(before.isNegative() ? new Prisma.Decimal(0) : before, resource.unit.decimals)} ${resource.unit.label}, demandé : ${formatDecimal(quantity.abs(), resource.unit.decimals)} ${resource.unit.label}`);
  }
  let counterpartyType: CounterpartyType | null = null;
  let counterpartyNinjaId: string | null = null;
  let counterpartyLabel: string | null = null;
  if (input.counterparty?.type === "NINJA") {
    const ninja = await tx.ninjaProfile.findUnique({ where: { id: input.counterparty.ninjaId }, select: { id: true, firstName: true, lastName: true } });
    if (!ninja) fail("Ninja introuvable");
    counterpartyType = "NINJA";
    counterpartyNinjaId = ninja!.id;
    counterpartyLabel = input.counterparty.label?.trim() || `${ninja!.firstName} ${ninja!.lastName}`.trim();
  } else if (input.counterparty?.type === "EXTERNAL") {
    const label = input.counterparty.label.trim();
    if (!label) fail("Indiquez le nom de la personne externe");
    counterpartyType = "EXTERNAL";
    counterpartyLabel = label.slice(0, 120);
  }
  const movement = await tx.inventoryMovement.create({ data: {
    resourceId: input.resourceId, type: input.type, quantity, quantityBefore: before, quantityAfter: after,
    unitCost: input.unitCost ?? null, transactionId: input.transactionId ?? null, craftExecutionId: input.craftExecutionId ?? null,
    agentId: input.agentId, counterpartyType, counterpartyNinjaId, counterpartyLabel,
    reason: input.reason.trim().slice(0, 300), notes: input.notes?.trim() ? input.notes.trim().slice(0, 1000) : null,
    sourceType: input.sourceType ?? (input.transactionId ? "ResourceTransaction" : input.craftExecutionId ? "CraftExecution" : null),
    sourceId: input.sourceId ?? input.transactionId ?? input.craftExecutionId ?? null,
    reversedMovementId: input.reversedMovementId ?? null, idempotencyKey: input.idempotencyKey,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {})
  } });
  if (input.markCounted) {
    await tx.resource.update({ where: { id: resource.id }, data: { inventoryStatus: "COUNTED", lastCountedAt: movement.occurredAt } });
  }
  return { id: movement.id, before, after, quantity, resourceName: resource.name, unitLabel: resource.unit.label, unitDecimals: resource.unit.decimals };
}

/** Immutable correction: the original line stays, a REVERSAL line of opposite sign points to it. */
export async function reverseMovement(tx: Tx, input: { movementId: string; agentId: string; reason: string; idempotencyKey: string; allowNegative?: boolean | undefined }): Promise<RecordedMovement & { originalId: string }> {
  const original = await tx.inventoryMovement.findUnique({ where: { id: input.movementId }, include: { reversal: { select: { id: true } } } });
  if (!original) return fail("Mouvement introuvable");
  if (original.type === "REVERSAL") fail("Une correction ne se corrige pas : enregistrez un nouveau mouvement");
  if (original.reversal) fail("Ce mouvement a déjà été corrigé");
  const counterparty: Counterparty | null = original.counterpartyType === "NINJA" && original.counterpartyNinjaId
    ? { type: "NINJA", ninjaId: original.counterpartyNinjaId, label: original.counterpartyLabel ?? undefined }
    : original.counterpartyType === "EXTERNAL" && original.counterpartyLabel ? { type: "EXTERNAL", label: original.counterpartyLabel } : null;
  const recorded = await recordMovement(tx, {
    resourceId: original.resourceId, type: "REVERSAL", quantity: original.quantity.negated(), agentId: input.agentId,
    reason: `Annulation — ${input.reason.trim()}`, counterparty, sourceType: "InventoryMovement", sourceId: original.id,
    reversedMovementId: original.id, idempotencyKey: input.idempotencyKey, allowNegative: input.allowNegative ?? false
  });
  return { ...recorded, originalId: original.id };
}

export interface StocktakeCount { resourceId: string; counted: Prisma.Decimal | number | string }

/** Step 1 of a count: snapshot the ledger and store what was counted. Nothing moves yet. */
export async function openStocktake(tx: Tx, input: { kind: "INITIAL" | "COUNT"; startedById: string; notes?: string | null | undefined; counts: StocktakeCount[] }) {
  if (!input.counts.length) fail("Saisissez au moins une quantité comptée");
  const ids = [...new Set(input.counts.map((count) => count.resourceId))];
  if (ids.length !== input.counts.length) fail("Une ressource apparaît deux fois");
  const resources = await tx.resource.findMany({ where: { id: { in: ids } }, include: { unit: true } });
  if (resources.length !== ids.length) fail("Ressource introuvable");
  const sums = await tx.inventoryMovement.groupBy({ by: ["resourceId"], where: { resourceId: { in: ids } }, _sum: { quantity: true } });
  const expectedOf = new Map(sums.map((row) => [row.resourceId, new Prisma.Decimal(row._sum.quantity ?? 0)]));
  const entries = input.counts.map((count) => {
    const resource = resources.find((row) => row.id === count.resourceId)!;
    if (!resource.isActive) fail(`${resource.name} est désactivée`);
    const counted = new Prisma.Decimal(count.counted);
    if (!counted.isFinite() || counted.isNegative()) fail(`Quantité comptée invalide pour ${resource.name}`);
    if (counted.decimalPlaces() > Math.min(QUANTITY_SCALE, resource.unit.decimals)) fail(`${resource.name} se compte avec ${resource.unit.decimals} décimale${resource.unit.decimals > 1 ? "s" : ""} maximum`);
    const expected = expectedOf.get(resource.id) ?? new Prisma.Decimal(0);
    return { resourceId: resource.id, expectedQuantity: expected, countedQuantity: counted, difference: counted.sub(expected) };
  });
  return tx.stocktakeSession.create({ data: { kind: input.kind, startedById: input.startedById, notes: input.notes?.trim() || null, entries: { createMany: { data: entries } } }, include: { entries: true } });
}

export interface StocktakeConfirmation { sessionId: string; movements: number; adjusted: number; counted: number }

/** Step 2: on locked state, recompute every difference and write the movements. Idempotent
 *  through the session status and per-entry idempotency keys. */
export async function confirmStocktake(tx: Tx, input: { sessionId: string; agentId: string }): Promise<StocktakeConfirmation> {
  const session = await tx.stocktakeSession.findUnique({ where: { id: input.sessionId }, include: { entries: true } });
  if (!session) return fail("Comptage introuvable");
  if (session.status !== "OPEN") fail("Ce comptage est déjà clôturé");
  const claimed = await tx.stocktakeSession.updateMany({ where: { id: session.id, status: "OPEN" }, data: { status: "COMPLETED", completedAt: new Date() } });
  if (claimed.count !== 1) fail("Ce comptage est déjà clôturé");
  const ids = session.entries.map((entry) => entry.resourceId);
  const locked = await lockResources(tx, ids);
  if (locked.size !== new Set(ids).size) fail("Une ressource du comptage est introuvable");
  const resources = new Map((await tx.resource.findMany({ where: { id: { in: ids } }, select: { id: true, inventoryStatus: true } })).map((row) => [row.id, row]));
  const plan = planStocktake(await Promise.all(session.entries.map(async (entry) => ({
    resourceId: entry.resourceId,
    inventoryStatus: resources.get(entry.resourceId)!.inventoryStatus as InventoryStatusCode,
    expected: Number(await ledgerStock(tx, entry.resourceId)),
    counted: Number(entry.countedQuantity)
  }))));
  let movements = 0, adjusted = 0;
  const label = session.kind === "INITIAL" ? "Inventaire initial" : "Comptage physique";
  for (const line of plan) {
    const entry = session.entries.find((row) => row.resourceId === line.resourceId)!;
    let movementId: string | null = null;
    if (line.movementType) {
      const recorded = await recordMovement(tx, {
        resourceId: line.resourceId, type: line.movementType, quantity: line.difference, agentId: input.agentId,
        reason: line.movementType === "INITIAL_BALANCE" ? label : `${label} — écart constaté`, sourceType: "StocktakeSession", sourceId: session.id,
        idempotencyKey: `stocktake:${session.id}:${line.resourceId}`, allowNegative: true, markCounted: true
      });
      movementId = recorded.id;
      movements++;
      if (line.movementType !== "INITIAL_BALANCE") adjusted++;
    } else {
      await tx.resource.update({ where: { id: line.resourceId }, data: { inventoryStatus: "COUNTED", lastCountedAt: new Date() } });
    }
    await tx.stocktakeEntry.update({ where: { id: entry.id }, data: { expectedQuantity: new Prisma.Decimal(line.expected), difference: new Prisma.Decimal(line.difference), adjustmentMovementId: movementId } });
  }
  return { sessionId: session.id, movements, adjusted, counted: plan.length };
}

export interface ReconciliationRow { resourceId: string; code: string; name: string; ledger: Prisma.Decimal; cache: Prisma.Decimal }

/** Ledger vs cache. A difference is reported, never corrected silently. */
export async function reconcileInventory(db: Db): Promise<ReconciliationRow[]> {
  const rows = await db.$queryRaw<Array<{ id: string; code: string; name: string; ledger: Prisma.Decimal | null; cache: Prisma.Decimal }>>`
    SELECT r."id", r."code", r."name", r."currentQuantity" AS "cache", SUM(m."quantity") AS "ledger"
    FROM "Resource" r
    LEFT JOIN "InventoryMovement" m ON m."resourceId" = r."id"
    GROUP BY r."id", r."code", r."name", r."currentQuantity"
    HAVING COALESCE(SUM(m."quantity"), 0) <> r."currentQuantity"
    ORDER BY r."name"
  `;
  return rows.map((row) => ({ resourceId: row.id, code: row.code, name: row.name, ledger: new Prisma.Decimal(row.ledger ?? 0), cache: new Prisma.Decimal(row.cache) }));
}

/** Explicit, audited resynchronisation of the cache from the ledger (manager action). */
export async function resyncInventoryCache(tx: Tx, resourceIds: string[]): Promise<number> {
  await lockResources(tx, resourceIds);
  let fixed = 0;
  for (const resourceId of resourceIds) {
    const ledger = await ledgerStock(tx, resourceId);
    const result = await tx.resource.updateMany({ where: { id: resourceId, NOT: { currentQuantity: ledger } }, data: { currentQuantity: ledger } });
    fixed += result.count;
  }
  return fixed;
}

function formatDecimal(value: Prisma.Decimal, decimals: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: Math.min(QUANTITY_SCALE, decimals) }).format(Number(value));
}
