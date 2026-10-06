import { Prisma, prisma } from "@koeki/database";
import { canAny } from "@koeki/domain";
import { demoMode, hasPermission, type SessionInfo } from "./session";
import { resolveTeamPeriod } from "./team-analytics";
import { agentName } from "./team-service";

export type TaxBucket = "collected" | "history" | "excluded";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/** Cash receipts only. Credits/exemptions are not money received by an agent. */
export function taxBucket(payment: { status: string; operationOrigin: string; method: string; validatedAt: Date | null }): TaxBucket {
  if (payment.status !== "VALIDATED" || !payment.validatedAt) return "excluded";
  if (!["ryo", "cash", "especes"].includes(normalize(payment.method))) return "excluded";
  if (["BUSINESS", "SELF_DECLARED"].includes(payment.operationOrigin)) return "collected";
  if (["UNKNOWN", "IMPORT", "LEGACY"].includes(payment.operationOrigin)) return "history";
  return "excluded";
}
export interface TaxAgentRow {
  id: string;
  name: string;
  disabled: boolean;
  collected: bigint;
  payments: number;
  historical: bigint;
  historicalPayments: number;
}
export interface TaxReceiptRow {
  id: string;
  receipt: string;
  ninjaId: string;
  ninja: string;
  amount: bigint;
  at: Date | null;
  createdAt: Date;
  method: string;
  origin: string;
  status: string;
  bucket: TaxBucket;
}
export interface TaxLedgerFilters {
  from?: string | undefined;
  to?: string | undefined;
  agentId?: string | undefined;
  page?: string | undefined;
  q?: string | undefined;
}

/** Read-only journal. Neither dossier ownership nor an approver can change attribution. */
export async function getAgentTaxLedger(session: SessionInfo, filters: TaxLedgerFilters = {}) {
  if (!hasPermission(session, "team:read")) throw new Error("FORBIDDEN");
  const period = resolveTeamPeriod({ from: filters.from, to: filters.to });
  const q = (filters.q ?? "").trim().slice(0, 120);
  const blank = {
    from: period.from, to: period.to, q,
    agents: [] as TaxAgentRow[], choices: [] as Array<{ id: string; name: string }>,
    totalCollected: 0n, totalPayments: 0, totalHistorical: 0n,
    unattributed: 0n, unknownDates: 0, receipts: [] as TaxReceiptRow[],
    selected: null as TaxAgentRow | null, selectedMissing: false,
    page: 1, pageCount: 1, receiptCount: 0,
  };
  if (demoMode) return blank;
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({
      where: { id: session.userId },
      select: { revokedAt: true, roles: { select: { role: { select: { code: true } } } } },
    });
    if (!actor || actor.revokedAt || !canAny(actor.roles.map(({ role }) => role.code), "team:read")) throw new Error("FORBIDDEN");
    const range = { gte: period.startsAt, lt: period.endsAtExclusive };
    const activityDate: Prisma.TaxPaymentWhereInput = {
      OR: [{ validatedAt: range }, { validatedAt: null, createdAt: range }],
    };
    const groups = await tx.taxPayment.groupBy({
      by: ["recordedById", "operationOrigin", "method"],
      where: { status: "VALIDATED", validatedAt: range },
      _sum: { amount: true }, _count: true,
    });
    // Former agents with only cancelled or undated receipts must remain discoverable.
    const authors = await tx.taxPayment.findMany({
      where: activityDate, select: { recordedById: true }, distinct: ["recordedById"],
    });
    const users = await tx.user.findMany({
      where: {
        AND: [
          { OR: [{ email: null }, { email: { not: "systeme@koeki.local" } }] },
          {
            OR: [
              { roles: { some: { role: { code: { in: ["ECONOMIC_AGENT", "KOEKI_MANAGER"] } } } } },
              { participations: { some: {} } },
              { id: { in: authors.map((author) => author.recordedById) } },
            ],
          },
        ],
      },
      select: { id: true, name: true, revokedAt: true, ninjaProfile: { select: { firstName: true, lastName: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const rows = new Map<string, TaxAgentRow>(users.map((user) => [user.id, {
      id: user.id, name: agentName(user), disabled: Boolean(user.revokedAt),
      collected: 0n, payments: 0, historical: 0n, historicalPayments: 0,
    }]));
    let unattributed = 0n;
    for (const group of groups) {
      const bucket = taxBucket({ ...group, status: "VALIDATED", validatedAt: period.startsAt });
      if (bucket === "excluded") continue;
      const amount = group._sum.amount ?? 0n;
      const row = rows.get(group.recordedById);
      if (!row) { unattributed += amount; continue; }
      if (bucket === "collected") { row.collected += amount; row.payments += group._count; }
      else { row.historical += amount; row.historicalPayments += group._count; }
    }
    const allRows = [...rows.values()].sort((a, b) => a.collected === b.collected ? a.name.localeCompare(b.name, "fr") : a.collected > b.collected ? -1 : 1);
    const agents = q ? allRows.filter((row) => normalize(row.name).includes(normalize(q))) : allRows;
    const selected = filters.agentId ? rows.get(filters.agentId) ?? null : null;
    const unknownDates = await tx.taxPayment.count({ where: {
      status: "VALIDATED", validatedAt: null, createdAt: range,
      recordedById: selected ? selected.id : { in: users.map((user) => user.id) },
    } });
    const where: Prisma.TaxPaymentWhereInput = { recordedById: selected?.id ?? "", ...activityDate };
    const receiptCount = selected ? await tx.taxPayment.count({ where }) : 0;
    const pageCount = Math.max(1, Math.ceil(receiptCount / 25));
    const requested = Number(filters.page ?? 1);
    const page = Math.min(pageCount, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
    const payments = selected ? await tx.taxPayment.findMany({
      where,
      orderBy: [{ validatedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 25, take: 25,
      select: { id: true, receiptNumber: true, ninjaId: true, amount: true, method: true, operationOrigin: true, status: true, validatedAt: true, createdAt: true, ninja: { select: { firstName: true, lastName: true } } },
    }) : [];
    return {
      ...blank, agents, selected, selectedMissing: Boolean(filters.agentId && !selected),
      choices: allRows.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
      totalCollected: allRows.reduce((sum, row) => sum + row.collected, 0n),
      totalPayments: allRows.reduce((sum, row) => sum + row.payments, 0),
      totalHistorical: allRows.reduce((sum, row) => sum + row.historical, 0n),
      unattributed, unknownDates, page, pageCount, receiptCount,
      receipts: payments.map((payment): TaxReceiptRow => ({
        id: payment.id, receipt: payment.receiptNumber, ninjaId: payment.ninjaId,
        ninja: `${payment.ninja.firstName} ${payment.ninja.lastName}`, amount: payment.amount,
        at: payment.validatedAt, createdAt: payment.createdAt, status: payment.status,
        origin: payment.operationOrigin, method: payment.method, bucket: taxBucket(payment),
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 });
}
