import { prisma, type Prisma } from "@koeki/database";
import { demoMode, hasPermission, type SessionInfo } from "./session";
import { resolveTeamPeriod, type AnalyticsFilters } from "./team-analytics";

const resourceSelect = { id: true, code: true, name: true, unit: { select: { label: true } } } as const;
const movementSelect = {
  id: true, quantity: true, type: true, occurredAt: true,
  resource: { select: resourceSelect },
} as const;
const detailsSelect = {
  id: true,
  ninja: { select: { id: true, code: true, firstName: true, lastName: true } },
  items: {
    orderBy: { id: "asc" },
    select: { id: true, quantity: true, unitPriceSnapshot: true, lineTotal: true, resource: { select: resourceSelect } },
  },
  movements: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { ...movementSelect, reversal: { select: movementSelect } },
  },
} as const satisfies Prisma.ResourceTransactionSelect;

type StoredDetails = Prisma.ResourceTransactionGetPayload<{ select: typeof detailsSelect }>;
export type ResourceDetails = ReturnType<typeof presentDetails>;

function presentDetails(row: StoredDetails) {
  // A correction can be related both to the transaction and to its source line.
  // Deduplicate by movement id; never hide an exit or count a reversal twice.
  const movements = new Map<string, (typeof row.movements)[number] | NonNullable<(typeof row.movements)[number]["reversal"]>>();
  for (const movement of row.movements) {
    movements.set(movement.id, movement);
    if (movement.reversal) movements.set(movement.reversal.id, movement.reversal);
  }
  return {
    ninja: row.ninja,
    items: row.items.map((item) => ({
      id: item.id, resourceId: item.resource.id, code: item.resource.code,
      name: item.resource.name, unit: item.resource.unit.label,
      quantity: item.quantity.toString(), unitPrice: item.unitPriceSnapshot, lineTotal: item.lineTotal,
    })),
    movements: [...movements.values()].sort((a, b) => +a.occurredAt - +b.occurredAt || a.id.localeCompare(b.id)).map((movement) => ({
      id: movement.id, quantity: movement.quantity.toString(), type: movement.type,
      at: movement.occurredAt, resourceId: movement.resource.id, name: movement.resource.name,
    })),
  };
}

/** Preserve Decimal(20,4) exactly; Number() would lose significant digits. */
export function formatRecordedQuantity(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "Quantité inconnue";
  const whole = BigInt(match[2]!).toLocaleString("fr-FR");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ""}`;
}

/** One batched query for the existing agent journal, never one query per row. */
export async function getResourceDetailsByTransactionIds(session: SessionInfo, ids: readonly string[]) {
  if (!hasPermission(session, "team:read")) throw new Error("FORBIDDEN");
  const unique = [...new Set(ids)];
  if (unique.length > 100) throw new Error("Trop d’opérations demandées");
  if (demoMode || !unique.length) return new Map<string, ResourceDetails>();
  const rows = await prisma.resourceTransaction.findMany({ where: { id: { in: unique } }, select: detailsSelect });
  return new Map(rows.map((row) => [row.id, presentDetails(row)]));
}

export interface ResourceJournalFilters extends AnalyticsFilters {
  agentId?: string | undefined;
  q?: string | undefined;
  type?: string | undefined;
  page?: string | undefined;
  preview?: boolean | undefined;
}

/** Read-only manager view. Keep original authors, saved valuations and all states. */
export async function getTeamResourceJournal(session: SessionInfo, filters: ResourceJournalFilters = {}) {
  if (!hasPermission(session, "team:read")) throw new Error("FORBIDDEN");
  const period = resolveTeamPeriod(filters);
  const q = (filters.q ?? "").trim().slice(0, 100);
  const type = filters.type === "DONATION" || filters.type === "BUYBACK" ? filters.type : undefined;
  const range = { gte: period.startsAt, lt: period.endsAtExclusive };
  const operationFilter: Prisma.ResourceTransactionWhereInput[] = type ? [{ type }] : [];
  const where: Prisma.ResourceTransactionWhereInput = {
    AND: [
      { OR: [{ validatedAt: range }, { validatedAt: null, createdAt: range }] },
      ...(filters.agentId ? [{ OR: [{ recordedById: filters.agentId }, { recordedById: null, agentId: filters.agentId }] }] : []),
      ...operationFilter,
      ...q.split(/\s+/).filter(Boolean).slice(0, 8).map((word) => ({ OR: [
        { receiptNumber: { contains: word, mode: "insensitive" as const } },
        { ninja: { OR: [{ firstName: { contains: word, mode: "insensitive" as const } }, { lastName: { contains: word, mode: "insensitive" as const } }, { code: { contains: word, mode: "insensitive" as const } }] } },
        { items: { some: { resource: { OR: [{ name: { contains: word, mode: "insensitive" as const } }, { code: { contains: word, mode: "insensitive" as const } }] } } } },
      ] })),
    ],
  };
  const pageSize = filters.preview ? 8 : 25;
  const total = demoMode ? 0 : await prisma.resourceTransaction.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number(filters.page ?? "1");
  const page = filters.preview ? 1 : Math.min(pages, Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1);
  const rows = demoMode ? [] : await prisma.resourceTransaction.findMany({
    where, take: pageSize, skip: (page - 1) * pageSize,
    orderBy: [{ validatedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      ...detailsSelect, receiptNumber: true, type: true, status: true, operationOrigin: true,
      recordedById: true, agentId: true, totalAmount: true, validatedAt: true, createdAt: true,
    },
  });
  const authorIds = [...new Set(rows.map((row) => row.recordedById ?? row.agentId))];
  const users = !authorIds.length ? [] : await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, ninjaProfile: { select: { firstName: true, lastName: true } } },
  });
  const names = new Map(users.map((user) => [user.id, user.ninjaProfile ? `${user.ninjaProfile.firstName} ${user.ninjaProfile.lastName}` : "Identité RP non renseignée"]));
  return {
    from: period.from, to: period.to, q, type, total, page, pages, pageSize,
    rows: rows.map((row) => ({
      id: row.id, receiptNumber: row.receiptNumber, type: row.type, status: row.status,
      origin: row.operationOrigin, totalAmount: row.totalAmount,
      at: row.validatedAt ?? row.createdAt, dateKnown: Boolean(row.validatedAt),
      agentId: row.recordedById ?? row.agentId,
      agentName: names.get(row.recordedById ?? row.agentId) ?? "Auteur historique",
      authorKnown: Boolean(row.recordedById), details: presentDetails(row),
    })),
  };
}
