// Read models of the inventory register. Every function returns plain, serialisable data
// (numbers, strings, ISO dates) ready for server components and client tables.
import { cache } from "react";
import { Prisma, prisma } from "@koeki/database";
import { counterpartyRoleLabel, deriveStockState, directionOfQuantity, formatSignedQuantity, inventoryStatusLabels, movementTypeLabels, normalizeSearch, stockStateLabels, type InventoryMovementTypeCode, type InventoryStatusCode } from "@koeki/domain";
import { demoInventoryBoard, demoJournal, demoNinjaInventory, demoResourceDetail, demoStocktakeCandidates, demoStocktakeDetail, demoStocktakes } from "./demo-inventory";
import { formatFullDateTime, relativeDay } from "./format";
import { getUserNames } from "./data";
import { normalizeReportHistoryRange } from "./report-period";
import { demoMode, hasPermission, type SessionInfo } from "./session";
import type { InventoryAgentActivity, InventoryBoardData, InventoryRow, JournalData, JournalFilters, MovementRow, NinjaInventoryHistory, ResourceDetailData, StocktakeCandidate, StocktakeDetail, StocktakeLine, StocktakeSummary, UnitInfo } from "./inventory-types";

export const JOURNAL_PAGE_SIZE = 50;
const DAY = 86_400_000;
const TREASURY_CATEGORY = "TREASURY";

const resourceInclude = { category: true, unit: true, aliases: { select: { alias: true } } } as const;
type ResourceWithRelations = Prisma.ResourceGetPayload<{ include: typeof resourceInclude }>;

const unitOf = (unit: { code: string; label: string; decimals: number }): UnitInfo => ({ code: unit.code, label: unit.label, decimals: unit.decimals });

const sourceLabels: Record<string, string> = { ResourceTransaction: "Reçu", CraftExecution: "Atelier", StocktakeSession: "Comptage", InventoryMovement: "Correction", Seed: "Amorçage" };
export const sourceOptions = [
  { code: "MANUAL", label: "Saisie manuelle" }, { code: "ResourceTransaction", label: "Don / rachat" }, { code: "CraftExecution", label: "Atelier" },
  { code: "StocktakeSession", label: "Comptage" }, { code: "InventoryMovement", label: "Correction" }
];

/** Local midnight — the same rule the worker uses for "today". */
function startOfToday(now = new Date()) { const day = new Date(now); day.setHours(0, 0, 0, 0); return day; }

interface FlowTotals { in30: Map<string, number>; out30: Map<string, number> }

async function flowTotals(db: typeof prisma, since: Date, resourceIds?: string[]): Promise<FlowTotals> {
  const scope = resourceIds ? { resourceId: { in: resourceIds } } : {};
  const [entries, exits] = await Promise.all([
    db.inventoryMovement.groupBy({ by: ["resourceId"], where: { ...scope, occurredAt: { gte: since }, quantity: { gt: 0 } }, _sum: { quantity: true } }),
    db.inventoryMovement.groupBy({ by: ["resourceId"], where: { ...scope, occurredAt: { gte: since }, quantity: { lt: 0 } }, _sum: { quantity: true } })
  ]);
  return {
    in30: new Map(entries.map((row) => [row.resourceId, Number(row._sum.quantity ?? 0)])),
    out30: new Map(exits.map((row) => [row.resourceId, Math.abs(Number(row._sum.quantity ?? 0))]))
  };
}

interface LastMovement { resourceId: string; occurredAt: Date; type: string; quantity: number; agentId: string; counterpartyLabel: string | null }

async function lastMovements(db: typeof prisma, resourceIds?: string[]): Promise<Map<string, LastMovement>> {
  const rows = resourceIds
    ? await db.$queryRaw<LastMovement[]>`SELECT DISTINCT ON ("resourceId") "resourceId", "occurredAt", "type"::text AS "type", "quantity"::float8 AS "quantity", "agentId", "counterpartyLabel" FROM "InventoryMovement" WHERE "resourceId" IN (${Prisma.join(resourceIds)}) ORDER BY "resourceId", "occurredAt" DESC, "id" DESC`
    : await db.$queryRaw<LastMovement[]>`SELECT DISTINCT ON ("resourceId") "resourceId", "occurredAt", "type"::text AS "type", "quantity"::float8 AS "quantity", "agentId", "counterpartyLabel" FROM "InventoryMovement" ORDER BY "resourceId", "occurredAt" DESC, "id" DESC`;
  return new Map(rows.map((row) => [row.resourceId, row]));
}

function toRow(resource: ResourceWithRelations, context: { flows: FlowTotals; last: Map<string, LastMovement>; users: Map<string, string>; now: Date }): InventoryRow {
  const quantity = Number(resource.currentQuantity);
  const last = context.last.get(resource.id);
  const unit = unitOf(resource.unit);
  const state = deriveStockState({ inventoryStatus: resource.inventoryStatus as InventoryStatusCode, quantity, minimumStock: Number(resource.minimumStock), criticalStock: Number(resource.criticalStock) });
  const lastAgent = last ? context.users.get(last.agentId) ?? "Agent Kōeki" : null;
  const lastSummary = last ? `${formatSignedQuantity(last.quantity, unit)} · ${movementTypeLabels[last.type as InventoryMovementTypeCode] ?? last.type}${last.counterpartyLabel ? ` · ${last.counterpartyLabel}` : ""} · ${lastAgent}` : null;
  return {
    id: resource.id, code: resource.code, name: resource.name, description: resource.description,
    categoryCode: resource.category.code, categoryLabel: resource.category.label, unit,
    quantity, hasMovements: Boolean(last) || resource.inventoryStatus === "COUNTED",
    inventoryStatus: resource.inventoryStatus as InventoryStatusCode, state, stateLabel: stockStateLabels[state],
    minimumStock: Number(resource.minimumStock), criticalStock: Number(resource.criticalStock),
    in30: context.flows.in30.get(resource.id) ?? 0, out30: context.flows.out30.get(resource.id) ?? 0,
    lastMovementAt: last ? last.occurredAt.toISOString() : null, lastMovementLabel: last ? relativeDay(last.occurredAt, context.now) : "—", lastMovementSummary: lastSummary, lastAgent,
    lastCountedAt: resource.lastCountedAt?.toISOString() ?? null, lastCountedLabel: resource.lastCountedAt ? relativeDay(resource.lastCountedAt, context.now) : "Jamais",
    updatedAt: resource.updatedAt.toISOString(), updatedLabel: relativeDay(resource.updatedAt, context.now),
    aliases: resource.aliases.map((alias) => alias.alias), isActive: resource.isActive, isTreasury: resource.category.code === TREASURY_CATEGORY
  };
}

export const listNinjaOptions = cache(async () => {
  const ninjas = await prisma.ninjaProfile.findMany({ where: { status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, code: true, firstName: true, lastName: true } });
  return ninjas.map((ninja) => ({ id: ninja.id, name: `${ninja.firstName} ${ninja.lastName}`.trim(), code: ninja.code }));
});

export async function getInventoryBoard(session: SessionInfo): Promise<InventoryBoardData> {
  if (demoMode) return demoInventoryBoard;
  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY);
  const canAdjust = hasPermission(session, "inventory:adjust");
  const [resources, categories, units, flows, last, users, today, ninjas, openStocktakes, mismatches] = await Promise.all([
    prisma.resource.findMany({ include: resourceInclude, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }] }),
    prisma.resourceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.resourceUnit.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    flowTotals(prisma, since), lastMovements(prisma), getUserNames(),
    prisma.inventoryMovement.findMany({ where: { occurredAt: { gte: startOfToday(now) } }, select: { quantity: true } }),
    hasPermission(session, "inventory:write") ? listNinjaOptions() : Promise.resolve([]),
    prisma.stocktakeSession.count({ where: { status: "OPEN" } }),
    canAdjust ? prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM (SELECT r."id" FROM "Resource" r LEFT JOIN "InventoryMovement" m ON m."resourceId" = r."id" GROUP BY r."id", r."currentQuantity" HAVING COALESCE(SUM(m."quantity"), 0) <> r."currentQuantity") AS diff` : Promise.resolve([{ n: 0 }])
  ]);
  const rows = resources.map((resource) => toRow(resource, { flows, last, users, now }));
  const active = rows.filter((row) => row.isActive);
  return {
    rows,
    categories: categories.map((category) => ({ code: category.code, label: category.label })),
    units: units.map(unitOf),
    stats: {
      total: rows.length, active: active.length,
      notInventoried: active.filter((row) => row.state === "NOT_INVENTORIED").length,
      low: active.filter((row) => row.state === "LOW").length, critical: active.filter((row) => row.state === "CRITICAL").length, outOfStock: active.filter((row) => row.state === "OUT_OF_STOCK").length,
      movementsToday: today.length, inToday: today.filter((movement) => Number(movement.quantity) > 0).length, outToday: today.filter((movement) => Number(movement.quantity) < 0).length
    },
    ninjas, mismatches: mismatches[0]?.n ?? 0, openStocktakes
  };
}

const movementInclude = { resource: { include: { unit: true } }, transaction: { select: { receiptNumber: true } }, reversal: { select: { id: true } } } as const;
type MovementWithRelations = Prisma.InventoryMovementGetPayload<{ include: typeof movementInclude }>;

function toMovementRow(movement: MovementWithRelations, users: Map<string, string>, canReverse: boolean): MovementRow {
  const quantity = Number(movement.quantity);
  const sourceType = movement.sourceType;
  const sourceLabel = sourceType === "ResourceTransaction" && movement.transaction ? `Reçu ${movement.transaction.receiptNumber}` : sourceType ? sourceLabels[sourceType] ?? sourceType : "Saisie manuelle";
  return {
    id: movement.id, at: movement.occurredAt.toISOString(), atLabel: formatFullDateTime(movement.occurredAt),
    resourceId: movement.resourceId, resourceName: movement.resource.name, resourceCode: movement.resource.code, unit: unitOf(movement.resource.unit),
    type: movement.type, typeLabel: movementTypeLabels[movement.type as InventoryMovementTypeCode] ?? movement.type, quantity,
    before: movement.quantityBefore === null ? null : Number(movement.quantityBefore), after: movement.quantityAfter === null ? null : Number(movement.quantityAfter),
    counterpartyLabel: movement.counterpartyLabel, counterpartyNinjaId: movement.counterpartyNinjaId, counterpartyRole: counterpartyRoleLabel(quantity),
    agent: users.get(movement.agentId) ?? "Agent Kōeki", agentId: movement.agentId, reason: movement.reason, notes: movement.notes,
    sourceType, sourceId: movement.sourceId, sourceLabel,
    reversedMovementId: movement.reversedMovementId, reversalId: movement.reversal?.id ?? null,
    canReverse: canReverse && movement.type !== "REVERSAL" && !movement.reversal
  };
}

/** Prisma filter of the journal — shared by the page and the CSV export so both see the same lines. */
export function journalWhere(filters: JournalFilters, users: Map<string, string>): Prisma.InventoryMovementWhereInput {
  const conditions: Prisma.InventoryMovementWhereInput[] = [];
  if (filters.ressource) conditions.push({ resourceId: filters.ressource });
  if (filters.categorie) conditions.push({ resource: { category: { code: filters.categorie } } });
  if (filters.type && (Object.keys(movementTypeLabels) as string[]).includes(filters.type)) conditions.push({ type: filters.type as InventoryMovementTypeCode });
  if (filters.sens === "in") conditions.push({ quantity: { gt: 0 } });
  if (filters.sens === "out") conditions.push({ quantity: { lt: 0 } });
  if (filters.agent) conditions.push({ agentId: filters.agent });
  if (filters.ninja) conditions.push({ counterpartyNinjaId: filters.ninja });
  if (filters.origine === "MANUAL") conditions.push({ sourceType: null });
  else if (filters.origine) conditions.push({ sourceType: filters.origine });
  // Civil days in Europe/Paris, DST-aware — the same rule as the report history filters.
  // An unparsable or inverted range from the URL is ignored rather than failing the page.
  let range: { from?: Date | undefined; to?: Date | undefined } = {};
  try { range = normalizeReportHistoryRange(filters.du, filters.au); } catch { range = {}; }
  if (range.from || range.to) conditions.push({ occurredAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } });
  if (filters.motif?.trim()) conditions.push({ OR: [{ reason: { contains: filters.motif.trim(), mode: "insensitive" } }, { notes: { contains: filters.motif.trim(), mode: "insensitive" } }] });
  if (filters.q?.trim()) {
    // Free search: every token must match somewhere — resource, alias, counterparty, reason, agent name.
    const tokens = filters.q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const token of tokens) {
      const agentIds = [...users.entries()].filter(([, name]) => normalizeSearch(name).includes(normalizeSearch(token))).map(([id]) => id);
      conditions.push({ OR: [
        { resource: { OR: [{ name: { contains: token, mode: "insensitive" } }, { code: { contains: token, mode: "insensitive" } }, { aliases: { some: { alias: { contains: token, mode: "insensitive" } } } }] } },
        { counterpartyLabel: { contains: token, mode: "insensitive" } },
        { counterpartyNinja: { is: { OR: [{ firstName: { contains: token, mode: "insensitive" } }, { lastName: { contains: token, mode: "insensitive" } }, { code: { contains: token, mode: "insensitive" } }] } } },
        { reason: { contains: token, mode: "insensitive" } }, { notes: { contains: token, mode: "insensitive" } },
        { transaction: { is: { receiptNumber: { contains: token, mode: "insensitive" } } } },
        ...(agentIds.length ? [{ agentId: { in: agentIds } }] : [])
      ] });
    }
  }
  return conditions.length ? { AND: conditions } : {};
}

/** Filtered lines for the CSV export (bounded to keep the response reasonable). */
export async function listMovementsForExport(filters: JournalFilters, limit = 10_000): Promise<MovementRow[]> {
  if (demoMode) return demoJournal.rows;
  const users = await getUserNames();
  const movements = await prisma.inventoryMovement.findMany({ where: journalWhere(filters, users), include: movementInclude, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit });
  return movements.map((movement) => toMovementRow(movement, users, false));
}

export async function getMovementJournal(session: SessionInfo, filters: JournalFilters): Promise<JournalData> {
  if (demoMode) return demoJournal;
  const users = await getUserNames();
  const where = journalWhere(filters, users);
  const requestedPage = filters.page && Number.isSafeInteger(filters.page) && filters.page > 0 ? filters.page : 1;
  const total = await prisma.inventoryMovement.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / JOURNAL_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const canReverse = hasPermission(session, "inventory:adjust");
  const [movements, resources, categories, agents, ninjas] = await Promise.all([
    prisma.inventoryMovement.findMany({ where, include: movementInclude, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (page - 1) * JOURNAL_PAGE_SIZE, take: JOURNAL_PAGE_SIZE }),
    prisma.resource.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    prisma.resourceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.inventoryMovement.findMany({ select: { agentId: true }, distinct: ["agentId"] }),
    listNinjaOptions()
  ]);
  return {
    rows: movements.map((movement) => toMovementRow(movement, users, canReverse)), total, page, pageCount,
    resources, categories: categories.map((category) => ({ code: category.code, label: category.label })),
    agents: agents.map(({ agentId }) => ({ id: agentId, name: users.get(agentId) ?? "Agent Kōeki" })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    ninjas,
    types: (Object.keys(movementTypeLabels) as InventoryMovementTypeCode[]).map((code) => ({ code, label: movementTypeLabels[code] })),
    sources: sourceOptions
  };
}

export async function getResourceInventoryDetail(session: SessionInfo, resourceId: string, page = 1): Promise<ResourceDetailData | null> {
  if (demoMode) return demoResourceDetail(resourceId);
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, include: resourceInclude });
  if (!resource) return null;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [flows, last, users, monthIn, monthOut, total, stocktakes] = await Promise.all([
    flowTotals(prisma, new Date(now.getTime() - 30 * DAY), [resourceId]), lastMovements(prisma, [resourceId]), getUserNames(),
    prisma.inventoryMovement.aggregate({ where: { resourceId, occurredAt: { gte: monthStart }, quantity: { gt: 0 } }, _sum: { quantity: true } }),
    prisma.inventoryMovement.aggregate({ where: { resourceId, occurredAt: { gte: monthStart }, quantity: { lt: 0 } }, _sum: { quantity: true } }),
    prisma.inventoryMovement.count({ where: { resourceId } }),
    prisma.stocktakeEntry.findMany({ where: { resourceId }, include: { session: true }, orderBy: { session: { startedAt: "desc" } }, take: 8 })
  ]);
  const pageCount = Math.max(1, Math.ceil(total / JOURNAL_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const movements = await prisma.inventoryMovement.findMany({ where: { resourceId }, include: movementInclude, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (currentPage - 1) * JOURNAL_PAGE_SIZE, take: JOURNAL_PAGE_SIZE });
  const canReverse = hasPermission(session, "inventory:adjust");
  return {
    resource: toRow(resource, { flows, last, users, now }),
    metrics: { inMonth: Number(monthIn._sum.quantity ?? 0), outMonth: Math.abs(Number(monthOut._sum.quantity ?? 0)), movementsCount: total, lastCountLabel: resource.lastCountedAt ? formatFullDateTime(resource.lastCountedAt) : "Jamais compté" },
    movements: movements.map((movement) => toMovementRow(movement, users, canReverse)), total, page: currentPage, pageCount,
    stocktakes: stocktakes.map((entry) => ({ id: entry.session.id, atLabel: formatFullDateTime(entry.session.startedAt), kindLabel: entry.session.kind === "INITIAL" ? "Inventaire initial" : "Comptage", expected: Number(entry.expectedQuantity), counted: Number(entry.countedQuantity), difference: Number(entry.difference), agent: users.get(entry.session.startedById) ?? "Agent Kōeki", status: entry.session.status }))
  };
}

const stocktakeStatusLabels = { OPEN: "À confirmer", COMPLETED: "Clôturé", CANCELLED: "Annulé" } as const;
const stocktakeKindLabels = { INITIAL: "Inventaire initial", COUNT: "Comptage" } as const;

function toStocktakeSummary(session: Prisma.StocktakeSessionGetPayload<{ include: { entries: { select: { difference: true } } } }>, users: Map<string, string>): StocktakeSummary {
  return {
    id: session.id, kind: session.kind, kindLabel: stocktakeKindLabels[session.kind], status: session.status, statusLabel: stocktakeStatusLabels[session.status],
    startedAt: session.startedAt.toISOString(), startedLabel: formatFullDateTime(session.startedAt), completedLabel: session.completedAt ? formatFullDateTime(session.completedAt) : null,
    startedBy: users.get(session.startedById) ?? "Agent Kōeki", entries: session.entries.length, differences: session.entries.filter((entry) => Number(entry.difference) !== 0).length, notes: session.notes
  };
}

export async function getStocktakes(): Promise<StocktakeSummary[]> {
  if (demoMode) return demoStocktakes;
  const [sessions, users] = await Promise.all([
    prisma.stocktakeSession.findMany({ include: { entries: { select: { difference: true } } }, orderBy: { startedAt: "desc" }, take: 60 }),
    getUserNames()
  ]);
  return sessions.map((session) => toStocktakeSummary(session, users));
}

export async function getStocktakeDetail(id: string): Promise<StocktakeDetail | null> {
  if (demoMode) return demoStocktakeDetail(id);
  const [session, users] = await Promise.all([
    prisma.stocktakeSession.findUnique({ where: { id }, include: { entries: { include: { resource: { include: { unit: true, category: true } }, adjustmentMovement: { select: { id: true, type: true } } } } } }),
    getUserNames()
  ]);
  if (!session) return null;
  const lines: StocktakeLine[] = session.entries
    .map((entry) => ({
      resourceId: entry.resourceId, code: entry.resource.code, name: entry.resource.name, unit: unitOf(entry.resource.unit), categoryLabel: entry.resource.category.label,
      expected: Number(entry.expectedQuantity), counted: Number(entry.countedQuantity), difference: Number(entry.difference), inventoryStatus: entry.resource.inventoryStatus as InventoryStatusCode,
      movementType: entry.adjustmentMovement?.type ?? null, movementLabel: entry.adjustmentMovement ? movementTypeLabels[entry.adjustmentMovement.type as InventoryMovementTypeCode] ?? entry.adjustmentMovement.type : null, movementId: entry.adjustmentMovement?.id ?? null
    }))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.name.localeCompare(b.name, "fr"));
  return { ...toStocktakeSummary({ ...session, entries: session.entries.map((entry) => ({ difference: entry.difference })) }, users), lines };
}

/** Rows of the count grid: active resources (optionally only the ones never counted). */
export async function getStocktakeCandidates(mode: "initial" | "count"): Promise<StocktakeCandidate[]> {
  if (demoMode) return demoStocktakeCandidates(mode);
  const resources = await prisma.resource.findMany({ where: { isActive: true, ...(mode === "initial" ? { inventoryStatus: "NOT_INVENTORIED" } : {}) }, include: resourceInclude, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }] });
  const withMovements = new Set((await prisma.inventoryMovement.groupBy({ by: ["resourceId"], where: { resourceId: { in: resources.map((resource) => resource.id) } } })).map((row) => row.resourceId));
  return resources.map((resource) => ({
    id: resource.id, code: resource.code, name: resource.name, categoryCode: resource.category.code, categoryLabel: resource.category.label, unit: unitOf(resource.unit),
    quantity: Number(resource.currentQuantity), hasMovements: withMovements.has(resource.id), inventoryStatus: resource.inventoryStatus as InventoryStatusCode, aliases: resource.aliases.map((alias) => alias.alias)
  }));
}

/** Everything a ninja gave to or took from the Kōeki, for the ninja record. */
export async function getNinjaInventoryHistory(ninjaId: string): Promise<NinjaInventoryHistory> {
  if (demoMode) return demoNinjaInventory;
  const [movements, users] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { counterpartyNinjaId: ninjaId }, include: { resource: { include: { unit: true } } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100 }),
    getUserNames()
  ]);
  const totals = { donations: 0, buybacks: 0, taken: 0, returned: 0 };
  for (const movement of movements) {
    if (movement.type === "DONATION_IN") totals.donations++;
    else if (movement.type === "BUYBACK_IN") totals.buybacks++;
    else if (Number(movement.quantity) < 0) totals.taken++;
    else totals.returned++;
  }
  return {
    rows: movements.map((movement) => ({
      id: movement.id, atLabel: formatFullDateTime(movement.occurredAt), typeLabel: movementTypeLabels[movement.type as InventoryMovementTypeCode] ?? movement.type,
      direction: directionOfQuantity(Number(movement.quantity)), resourceName: movement.resource.name, resourceId: movement.resourceId,
      quantityLabel: formatSignedQuantity(Number(movement.quantity), unitOf(movement.resource.unit)), agent: users.get(movement.agentId) ?? "Agent Kōeki", reason: movement.reason
    })),
    totals
  };
}

/** Traceability indicators per agent over a period — never a performance score. */
export async function getInventoryAgentActivity(since: Date): Promise<InventoryAgentActivity[]> {
  if (demoMode) return [];
  const [movements, sessions, users] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { occurredAt: { gte: since } }, select: { agentId: true, type: true, quantity: true, reversal: { select: { id: true } } } }),
    prisma.stocktakeSession.findMany({ where: { startedAt: { gte: since }, status: "COMPLETED" }, select: { startedById: true } }),
    getUserNames()
  ]);
  const byAgent = new Map<string, InventoryAgentActivity>();
  const entry = (id: string) => { const current = byAgent.get(id) ?? { id, name: users.get(id) ?? "Agent Kōeki", movements: 0, entries: 0, exits: 0, counts: 0, adjustments: 0, corrections: 0, reversed: 0 }; byAgent.set(id, current); return current; };
  for (const movement of movements) {
    const row = entry(movement.agentId);
    row.movements++;
    if (movement.type === "REVERSAL") row.corrections++;
    else if (movement.type === "ADJUSTMENT_IN" || movement.type === "ADJUSTMENT_OUT" || movement.type === "MANUAL_ADJUSTMENT") row.adjustments++;
    else if (Number(movement.quantity) > 0) row.entries++;
    else row.exits++;
    if (movement.reversal) row.reversed++;
  }
  for (const session of sessions) entry(session.startedById).counts++;
  return [...byAgent.values()].sort((a, b) => b.movements - a.movements || a.name.localeCompare(b.name, "fr"));
}

export const inventoryStatusLabel = (status: InventoryStatusCode) => inventoryStatusLabels[status];
