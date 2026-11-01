import "server-only";
import { notFound } from "next/navigation";
import { Prisma, prisma } from "@koeki/database";
import { rankingWeekAt, type Role } from "@koeki/domain";
import { normalizeReportHistoryRange } from "./report-period";
import { demoMode, hasPermission, requirePermission } from "./session";

export interface AgentHistoryFilters {
  du?: string | undefined;
  au?: string | undefined;
  page?: number | undefined;
}

interface HistoryOperation {
  id: string;
  kind: "PAYMENT" | "DONATION" | "BUYBACK";
  receiptNumber: string;
  ninjaId: string;
  amount: bigint;
  status: string;
  recordedById: string | null;
  createdAt: Date;
  validatedAt: Date | null;
  firstValidatedAt: Date | null;
  validationEvidence: string | null;
  operationOrigin: string;
  activityAt: Date;
}

/** Complete business history, independent of published ranking snapshots.
 * A legacy agentId association is visible but never promoted to proven authorship.
 * The guard runs before identity or operation reads, including guessed user IDs. */
export async function getAgentOperationHistory(requestedUserId?: string, filters: AgentHistoryFilters = {}) {
  const session = await requirePermission("ranking:read");
  const manager = hasPermission(session, "ranking:manage");
  const userId = !requestedUserId || requestedUserId === "moi" ? session.userId : requestedUserId;
  if (!manager && userId !== session.userId) notFound();
  const period = normalizeReportHistoryRange(filters.du, filters.au);
  if (demoMode) return { userId, name: session.name, own: userId === session.userId, manager, demo: true, rows: [], total: 0, payments: 0, donations: 0, buybacks: 0, page: 1, pageCount: 1, pageSize: 25 };

  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: session.userId }, select: { revokedAt: true, roles: { select: { role: { select: { code: true } } } } } });
    const liveSession = { ...session, roles: (actor?.roles.map((r) => r.role.code) ?? []) as Role[] };
    if (!actor || actor.revokedAt || !hasPermission(liveSession, "ranking:read")) notFound();
    const manager = hasPermission(liveSession, "ranking:manage");
    if (!manager && userId !== session.userId) notFound();
    const user = await tx.user.findUnique({ where: { id: userId }, select: {
      name: true, ninjaProfile: { select: { firstName: true, lastName: true } },
      participations: { where: { rankingEligible: true }, select: { startsAt: true, observedAt: true, endsAt: true } },
    } });
    if (!user) notFound();
    const operations = Prisma.sql`
      SELECT p."id", 'PAYMENT'::text AS "kind", p."receiptNumber", p."ninjaId", p."amount",
        p."status"::text AS "status", p."recordedById", p."createdAt", p."validatedAt", p."firstValidatedAt",
        p."validationEvidence", p."operationOrigin", COALESCE(CASE WHEN p."validationEvidence" IN ('SERVER', 'AUDIT_BACKFILL') THEN p."firstValidatedAt" END, p."validatedAt", p."createdAt") AS "activityAt"
      FROM "TaxPayment" p WHERE p."recordedById" = ${userId}
      UNION ALL
      SELECT r."id", r."type"::text AS "kind", r."receiptNumber", r."ninjaId", r."totalAmount" AS "amount",
        CASE WHEN EXISTS (SELECT 1 FROM "InventoryMovement" m JOIN "InventoryMovement" reversal ON reversal."reversedMovementId" = m."id" WHERE m."transactionId" = r."id")
          THEN 'REVERSED' ELSE r."status"::text END AS "status",
        r."recordedById", r."createdAt", r."validatedAt", r."firstValidatedAt", r."validationEvidence", r."operationOrigin",
        COALESCE(CASE WHEN r."validationEvidence" IN ('SERVER', 'AUDIT_BACKFILL') THEN r."firstValidatedAt" END, r."validatedAt", r."createdAt") AS "activityAt"
      FROM "ResourceTransaction" r WHERE r."recordedById" = ${userId} OR (r."recordedById" IS NULL AND r."agentId" = ${userId})
    `;
    const range = Prisma.sql`WHERE TRUE
      ${period.from ? Prisma.sql`AND o."activityAt" >= ${period.from}` : Prisma.empty}
      ${period.to ? Prisma.sql`AND o."activityAt" <= ${period.to}` : Prisma.empty}`;
    const [totals] = await tx.$queryRaw<Array<{ total: bigint; payments: bigint; donations: bigint; buybacks: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE kind = 'PAYMENT') AS payments,
        COUNT(*) FILTER (WHERE kind = 'DONATION') AS donations, COUNT(*) FILTER (WHERE kind = 'BUYBACK') AS buybacks
      FROM (${operations}) o ${range}`);
    const total = Number(totals!.total), pageSize = 25, pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Number.isSafeInteger(filters.page) && filters.page! > 0 ? filters.page! : 1);
    const rows = await tx.$queryRaw<HistoryOperation[]>(Prisma.sql`
      SELECT * FROM (${operations}) o ${range}
      ORDER BY o."activityAt" DESC, o."kind", o."id" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
    return {
      userId, name: user.ninjaProfile ? `${user.ninjaProfile.firstName} ${user.ninjaProfile.lastName}` : user.name ?? "Identité RP à renseigner",
      own: userId === session.userId, manager, demo: false, total,
      payments: Number(totals!.payments), donations: Number(totals!.donations), buybacks: Number(totals!.buybacks), page, pageCount, pageSize,
      rows: rows.map((row) => {
        const provenValidation = Boolean(row.firstValidatedAt && ["SERVER", "AUDIT_BACKFILL"].includes(row.validationEvidence ?? ""));
        const participation = row.firstValidatedAt && user.participations.some((p) =>
          (p.startsAt ?? p.observedAt) <= row.firstValidatedAt! && (!p.endsAt || p.endsAt > row.firstValidatedAt!));
        const exclusion = row.status !== "VALIDATED" ? "Opération non validée ou inversée"
          : row.operationOrigin === "IMPORT" ? "Import exclu du classement"
          : !["BUSINESS", "SELF_DECLARED"].includes(row.operationOrigin) ? "Origine métier non établie"
          : !row.recordedById ? "Auteur d’origine non établi"
          : !provenValidation ? "Première validation non prouvée"
          : !participation ? "Participation non établie à cette date"
          : null;
        return { ...row, provenValidation, exclusion, weekKey: provenValidation ? rankingWeekAt(row.firstValidatedAt!).key : null };
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
