import { Prisma, prisma } from "@koeki/database";
import { canAny } from "@koeki/domain";
import { demoMode, hasPermission, type SessionInfo } from "./session";
import {
  formatReportDate,
  reportDayBoundary,
  shiftReportDate,
} from "./report-period";

export interface AnalyticsFilters {
  from?: string | undefined;
  to?: string | undefined;
}
export interface AnalyticsDay {
  date: string;
  label: string;
  payments: number;
  donations: number;
  buybacks: number;
  total: number;
}
export interface AnalyticsMetrics {
  payments: number;
  donations: number;
  buybacks: number;
  total: number;
  collected: string;
  dossiers: number;
  tasksOpen: number;
  tasksOverdue: number;
  tasksBlocked: number;
  tasksDone: number;
  reportsSubmitted: number;
  reportsApproved: number;
}
export interface AnalyticsAgent extends AnalyticsMetrics {
  id: string;
  name: string;
  state: "ACTIVE" | "ABSENT" | "RECENT" | "LEFT" | "DISABLED" | "UNKNOWN";
  stateLabel: string;
  participation: string;
  participationStartsAt: string | null;
  participationEndsAt: string | null;
  entryDateKnown: boolean;
  absentNow: boolean;
  absenceDuringPeriod: boolean;
  lastActivity: string | null;
}
export interface TeamAnalytics {
  from: string;
  to: string;
  timeZone: "Europe/Paris";
  generatedAt: string;
  period: { startsAt: string; endsAtExclusive: string; days: number };
  daily: AnalyticsDay[];
  agents: AnalyticsAgent[];
  totals: AnalyticsMetrics & {
    agents: number;
    activeAgents: number;
    absentAgents: number;
    disabledAgents: number;
    noActivityAgents: number;
    unassignedDossiers: number;
    unassignedTasks: number;
    reportsToReview: number;
  };
  workload: {
    id: string;
    name: string;
    dossiers: number;
    tasksOpen: number;
    tasksOverdue: number;
    tasksBlocked: number;
  }[];
  attention: {
    kind:
      | "overdue"
      | "blocked"
      | "reports"
      | "unassigned-dossiers"
      | "unassigned-tasks";
    label: string;
    count: number;
    href: string;
  }[];
  definitions: { key: string; label: string; description: string }[];
  dataQuality: {
    excludedPayments: number;
    excludedTransactions: number;
    unknownValidationDates: number;
  };
}

const openStates = ["TODO", "IN_PROGRESS", "BLOCKED"];
const acceptedOrigins = ["BUSINESS", "SELF_DECLARED"];
const noMetrics = (): AnalyticsMetrics => ({
  payments: 0,
  donations: 0,
  buybacks: 0,
  total: 0,
  collected: "0",
  dossiers: 0,
  tasksOpen: 0,
  tasksOverdue: 0,
  tasksBlocked: 0,
  tasksDone: 0,
  reportsSubmitted: 0,
  reportsApproved: 0,
});

/** Inclusive civil dates; UTC bounds are calculated separately to preserve DST days. */
export function resolveTeamPeriod(
  filters: AnalyticsFilters = {},
  now = new Date(),
) {
  const to = filters.to?.trim() || formatReportDate(now);
  const from = filters.from?.trim() || shiftReportDate(to, -29);
  const startsAt = reportDayBoundary(from);
  const endsAtExclusive = reportDayBoundary(shiftReportDate(to, 1));
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000 +
    1;
  if (!Number.isInteger(days) || days < 1 || days > 366)
    throw new Error(
      "La période doit couvrir de 1 à 366 jours, avec une date de début antérieure à la fin.",
    );
  return { from, to, startsAt, endsAtExclusive, days };
}

const definitions: TeamAnalytics["definitions"] = [
  {
    key: "activity",
    label: "Opérations métier validées",
    description:
      "Une opération distincte par paiement, don ou rachat, affectée au jour de validatedAt dans Europe/Paris. Seuls les états validés et les origines métier BUSINESS ou SELF_DECLARED sont retenus. Les imports, origines inconnues, écritures techniques et opérations inversées sont exclus, y compris un don ou rachat dont le stock associé a été inversé. Ce suivi de période n’est pas une clôture du classement.",
  },
  {
    key: "author",
    label: "Auteur de l’opération",
    description:
      "Attribution à recordedById, l’auteur d’origine conservé. Un simple approbateur n’hérite pas de l’opération ; une attribution historique inconnue est exclue.",
  },
  {
    key: "collected",
    label: "Encaissements fiscaux",
    description:
      "Somme exacte des montants des paiements éligibles sur la période, en Ryō. Les dons et rachats ne sont pas additionnés aux encaissements. Les courbes portent uniquement sur des nombres d’opérations.",
  },
  {
    key: "workload",
    label: "Charge actuelle",
    description:
      "Dossiers actifs affectés, tâches actuellement à faire, en cours ou bloquées. Le retard est une échéance passée à l’heure de lecture ; cette charge n’est pas filtrée par la période de l’activité.",
  },
  {
    key: "tasksDone",
    label: "Tâches terminées sur la période",
    description:
      "Tâches actuellement terminées dont une transition vers Terminé est datée dans la période. Une tâche n’est comptée qu’une fois, même après plusieurs transitions ; une tâche rouverte n’est plus comptée comme terminée.",
  },
  {
    key: "reports",
    label: "Rapports de la période",
    description:
      "Rapports actuellement soumis avec une date de soumission dans la période, ou actuellement approuvés avec une date de décision dans la période. Les brouillons privés, dates inconnues et totaux des rapports ne sont jamais utilisés pour mesurer les opérations. Le compteur À examiner inclut les rapports actuellement soumis, toutes périodes confondues.",
  },
  {
    key: "population",
    label: "Population et contexte",
    description:
      "Agents économiques, responsables et participants historiques, y compris sans activité. Les comptes techniques sont exclus ; un super-administrateur participe à cette vue seulement avec un rôle métier ou une participation explicite. Participation et absence décrivent l’état actuel, avec un indicateur distinct pour une absence pendant la période. Aucune activité enregistrée ne constitue pas une faute.",
  },
  {
    key: "quality",
    label: "Couverture des données",
    description:
      "Les opérations datées mais non éligibles sont dénombrées séparément. Une validation inconnue est signalée d’après les créations de la période, sans transformer la création en date de validation. La dernière activité présentée est la dernière opération éligible dans la période choisie.",
  },
];

type Period = ReturnType<typeof resolveTeamPeriod>;
function emptyResult(period: Period, now: Date): TeamAnalytics {
  const daily: AnalyticsDay[] = [];
  const label = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
  });
  for (let day = 0; day < period.days; day++) {
    const date = shiftReportDate(period.from, day);
    daily.push({
      date,
      label: label.format(reportDayBoundary(date)),
      payments: 0,
      donations: 0,
      buybacks: 0,
      total: 0,
    });
  }
  return {
    from: period.from,
    to: period.to,
    timeZone: "Europe/Paris",
    generatedAt: now.toISOString(),
    period: {
      startsAt: period.startsAt.toISOString(),
      endsAtExclusive: period.endsAtExclusive.toISOString(),
      days: period.days,
    },
    daily,
    agents: [],
    totals: {
      ...noMetrics(),
      agents: 0,
      activeAgents: 0,
      absentAgents: 0,
      disabledAgents: 0,
      noActivityAgents: 0,
      unassignedDossiers: 0,
      unassignedTasks: 0,
      reportsToReview: 0,
    },
    workload: [],
    attention: [],
    definitions,
    dataQuality: {
      excludedPayments: 0,
      excludedTransactions: 0,
      unknownValidationDates: 0,
    },
  };
}

interface ActivityAggregate {
  authorId: string;
  date: string;
  kind: "PAYMENT" | "DONATION" | "BUYBACK";
  count: number;
  amount: string;
  lastActivity: Date;
}

interface ParticipationInterval {
  startsAt: Date | null;
  endsAt: Date | null;
  observedAt: Date;
}

/** Role changes split participation records without creating a new service entry. */
function continuousEntry(
  participations: ParticipationInterval[],
  anchor: ParticipationInterval | undefined,
) {
  if (!anchor) return null;
  let boundary = anchor.startsAt ?? anchor.observedAt;
  let entry = anchor.startsAt;
  const previous = [...participations].sort(
    (a, b) => +(b.startsAt ?? b.observedAt) - +(a.startsAt ?? a.observedAt),
  );
  for (const part of previous) {
    const start = part.startsAt ?? part.observedAt;
    if (start > boundary || (part.endsAt && part.endsAt < boundary)) continue;
    if (start < boundary) {
      boundary = start;
      entry = part.startsAt;
    } else if (!part.startsAt) entry = null;
  }
  return entry;
}

async function loadAnalytics(
  session: SessionInfo,
  filters: AnalyticsFilters,
  userId?: string,
): Promise<TeamAnalytics | null> {
  // This must run before even the actor lookup, including direct service callers.
  if (!hasPermission(session, "team:read")) throw new Error("FORBIDDEN");
  const now = new Date(),
    period = resolveTeamPeriod(filters, now),
    result = emptyResult(period, now);
  if (demoMode) return userId ? null : result;
  return prisma.$transaction(
    async (tx) => {
      // Fresh authorization prevents stale caller roles from exposing a revoked view.
      const actor = await tx.user.findUnique({
        where: { id: session.userId },
        select: {
          revokedAt: true,
          roles: { select: { role: { select: { code: true } } } },
        },
      });
      if (
        !actor ||
        actor.revokedAt ||
        !canAny(
          actor.roles.map(({ role }) => role.code),
          "team:read",
        )
      )
        throw new Error("FORBIDDEN");
      const users = await tx.user.findMany({
        where: {
          ...(userId ? { id: userId } : {}),
          AND: [
            {
              OR: [{ email: null }, { email: { not: "systeme@koeki.local" } }],
            },
            {
              OR: [
                {
                  roles: {
                    some: {
                      role: {
                        code: { in: ["ECONOMIC_AGENT", "KOEKI_MANAGER"] },
                      },
                    },
                  },
                },
                { participations: { some: {} } },
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          revokedAt: true,
          ninjaProfile: { select: { firstName: true, lastName: true } },
          participations: {
            orderBy: [{ observedAt: "desc" }, { id: "asc" }],
            select: { startsAt: true, endsAt: true, observedAt: true },
          },
          absences: {
            where: {
              OR: [
                {
                  startsAt: { lt: period.endsAtExclusive },
                  endsAt: { gt: period.startsAt },
                },
                { startsAt: { lte: now }, endsAt: { gt: now } },
              ],
            },
            select: { startsAt: true, endsAt: true },
          },
        },
        orderBy: [
          { ninjaProfile: { lastName: "asc" } },
          { ninjaProfile: { firstName: "asc" } },
          { name: "asc" },
          { id: "asc" },
        ],
      });
      if (userId && !users.length) return null;
      const ids = users.map((user) => user.id);
      const range = { gte: period.startsAt, lt: period.endsAtExclusive };
      const paymentScope: Prisma.TaxPaymentWhereInput = {
        recordedById: { in: ids },
      };
      const resourceScope: Prisma.ResourceTransactionWhereInput = {
        OR: [
          { recordedById: { in: ids } },
          { recordedById: null, agentId: { in: ids } },
        ],
      };
      // SQL aggregates return bounded day/author groups rather than every ledger line.
      const activity = ids.length
        ? await tx.$queryRaw<ActivityAggregate[]>(Prisma.sql`
      SELECT op."authorId", to_char(op."validatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS "date",
             op."kind", COUNT(*)::integer AS "count", SUM(op."amount")::text AS "amount", MAX(op."validatedAt") AS "lastActivity"
      FROM (
        SELECT p."recordedById" AS "authorId", p."validatedAt", 'PAYMENT' AS "kind", p."amount"
        FROM "TaxPayment" p
        WHERE p."recordedById" IN (${Prisma.join(ids)}) AND p."status" = 'VALIDATED'
          AND p."operationOrigin" IN ('BUSINESS', 'SELF_DECLARED')
          AND p."validatedAt" >= ${period.startsAt} AND p."validatedAt" < ${period.endsAtExclusive}
        UNION ALL
        SELECT r."recordedById" AS "authorId", r."validatedAt", r."type"::text AS "kind", r."totalAmount" AS "amount"
        FROM "ResourceTransaction" r
        WHERE r."recordedById" IN (${Prisma.join(ids)}) AND r."status" = 'VALIDATED'
          AND r."operationOrigin" IN ('BUSINESS', 'SELF_DECLARED')
          AND r."validatedAt" >= ${period.startsAt} AND r."validatedAt" < ${period.endsAtExclusive}
          AND NOT EXISTS (SELECT 1 FROM "InventoryMovement" m JOIN "InventoryMovement" reversed ON reversed."reversedMovementId" = m."id" WHERE m."transactionId" = r."id")
      ) op GROUP BY op."authorId", "date", op."kind"
    `)
        : [];

      const [
        dossiers,
        taskStates,
        overdue,
        completed,
        reports,
        approved,
        toReview,
        unassignedDossiers,
        unassignedTasks,
        excludedPayments,
        excludedTransactions,
        unknownPaymentDates,
        unknownResourceDates,
      ] = await Promise.all([
        tx.ninjaProfile.groupBy({
          by: ["referenceAgentId"],
          where: { referenceAgentId: { in: ids }, status: "ACTIVE" },
          _count: true,
        }),
        tx.followUpTask.groupBy({
          by: ["assigneeId", "status"],
          where: { assigneeId: { in: ids }, status: { in: openStates } },
          _count: true,
        }),
        tx.followUpTask.groupBy({
          by: ["assigneeId"],
          where: {
            assigneeId: { in: ids },
            status: { in: openStates },
            dueAt: { lt: now },
          },
          _count: true,
        }),
        tx.followUpTask.groupBy({
          by: ["assigneeId"],
          where: {
            assigneeId: { in: ids },
            status: "DONE",
            transitions: { some: { toStatus: "DONE", createdAt: range } },
          },
          _count: true,
        }),
        tx.agentReport.groupBy({
          by: ["authorId"],
          where: {
            authorId: { in: ids },
            status: "SUBMITTED",
            submittedAt: range,
          },
          _count: true,
        }),
        tx.agentReport.groupBy({
          by: ["authorId"],
          where: {
            authorId: { in: ids },
            status: "APPROVED",
            decidedAt: range,
          },
          _count: true,
        }),
        tx.agentReport.count({
          where: { authorId: { in: ids }, status: "SUBMITTED" },
        }),
        !userId
          ? tx.ninjaProfile.count({
              where: { referenceAgentId: null, status: "ACTIVE" },
            })
          : 0,
        !userId
          ? tx.followUpTask.count({
              where: { assigneeId: null, status: { in: openStates } },
            })
          : 0,
        tx.taxPayment.count({
          where: {
            ...paymentScope,
            validatedAt: range,
            OR: [
              { status: { not: "VALIDATED" } },
              { operationOrigin: { notIn: acceptedOrigins } },
            ],
          },
        }),
        tx.resourceTransaction.count({
          where: {
            AND: [
              resourceScope,
              { validatedAt: range },
              {
                OR: [
                  { status: { not: "VALIDATED" } },
                  { operationOrigin: { notIn: acceptedOrigins } },
                  { recordedById: null },
                  { movements: { some: { reversal: { isNot: null } } } },
                ],
              },
            ],
          },
        }),
        tx.taxPayment.count({
          where: {
            ...paymentScope,
            status: "VALIDATED",
            validatedAt: null,
            createdAt: range,
          },
        }),
        tx.resourceTransaction.count({
          where: {
            AND: [
              resourceScope,
              { status: "VALIDATED", validatedAt: null, createdAt: range },
            ],
          },
        }),
      ]);

      const days = new Map(result.daily.map((day) => [day.date, day]));
      const byAuthor = new Map<
        string,
        {
          payments: number;
          donations: number;
          buybacks: number;
          collected: bigint;
          lastActivity: Date | null;
        }
      >();
      for (const row of activity) {
        const key =
          row.kind === "PAYMENT"
            ? "payments"
            : row.kind === "DONATION"
              ? "donations"
              : "buybacks";
        const day = days.get(row.date);
        if (day) {
          day[key] += row.count;
          day.total += row.count;
        }
        const agent = byAuthor.get(row.authorId) ?? {
          payments: 0,
          donations: 0,
          buybacks: 0,
          collected: 0n,
          lastActivity: null,
        };
        agent[key] += row.count;
        if (key === "payments") agent.collected += BigInt(row.amount);
        if (!agent.lastActivity || row.lastActivity > agent.lastActivity)
          agent.lastActivity = row.lastActivity;
        byAuthor.set(row.authorId, agent);
      }
      result.agents = users.map((user): AnalyticsAgent => {
        const current = user.participations.find(
          (part) =>
            (part.startsAt ?? part.observedAt) <= now &&
            (!part.endsAt || part.endsAt > now),
        );
        const latest = current ?? user.participations[0];
        const entry = continuousEntry(user.participations, latest);
        const absentNow = user.absences.some(
          (absence) => absence.startsAt <= now && absence.endsAt > now,
        );
        const absenceDuringPeriod = user.absences.some(
          (absence) =>
            absence.startsAt < period.endsAtExclusive &&
            absence.endsAt > period.startsAt,
        );
        const recent = Boolean(
          current && entry && entry.getTime() >= now.getTime() - 14 * 86400000,
        );
        const state: AnalyticsAgent["state"] = user.revokedAt
          ? "DISABLED"
          : !current
            ? latest?.endsAt && latest.endsAt <= now
              ? "LEFT"
              : "UNKNOWN"
            : absentNow
              ? "ABSENT"
              : recent
                ? "RECENT"
                : "ACTIVE";
        const labels = {
          ACTIVE: "Participation active",
          ABSENT: "Absence déclarée",
          RECENT: "Entrée récente",
          LEFT: "Sortie du service",
          DISABLED: "Compte désactivé",
          UNKNOWN: "Participation à renseigner",
        };
        const values = byAuthor.get(user.id);
        const ownTasks = taskStates.filter(
          (entry) => entry.assigneeId === user.id,
        );
        return {
          ...noMetrics(),
          id: user.id,
          name: user.ninjaProfile
            ? `${user.ninjaProfile.firstName} ${user.ninjaProfile.lastName}`
            : (user.name ?? "Identité RP à renseigner"),
          state,
          stateLabel: labels[state],
          participation: current
            ? entry
              ? "Participation déclarée"
              : "Participation observée · entrée inconnue"
            : latest?.endsAt
              ? "Participation terminée"
              : "Participation non renseignée",
          participationStartsAt: entry?.toISOString() ?? null,
          participationEndsAt: latest?.endsAt?.toISOString() ?? null,
          entryDateKnown: Boolean(entry),
          absentNow,
          absenceDuringPeriod,
          payments: values?.payments ?? 0,
          donations: values?.donations ?? 0,
          buybacks: values?.buybacks ?? 0,
          total:
            (values?.payments ?? 0) +
            (values?.donations ?? 0) +
            (values?.buybacks ?? 0),
          collected: (values?.collected ?? 0n).toString(),
          lastActivity: values?.lastActivity?.toISOString() ?? null,
          dossiers:
            dossiers.find((entry) => entry.referenceAgentId === user.id)
              ?._count ?? 0,
          tasksOpen: ownTasks.reduce((sum, entry) => sum + entry._count, 0),
          tasksBlocked:
            ownTasks.find((entry) => entry.status === "BLOCKED")?._count ?? 0,
          tasksOverdue:
            overdue.find((entry) => entry.assigneeId === user.id)?._count ?? 0,
          tasksDone:
            completed.find((entry) => entry.assigneeId === user.id)?._count ??
            0,
          reportsSubmitted:
            reports.find((entry) => entry.authorId === user.id)?._count ?? 0,
          reportsApproved:
            approved.find((entry) => entry.authorId === user.id)?._count ?? 0,
        };
      });
      const countKeys = [
        "payments",
        "donations",
        "buybacks",
        "total",
        "dossiers",
        "tasksOpen",
        "tasksOverdue",
        "tasksBlocked",
        "tasksDone",
        "reportsSubmitted",
        "reportsApproved",
      ] as const;
      let collected = 0n;
      for (const agent of result.agents) {
        for (const key of countKeys) result.totals[key] += agent[key];
        collected += BigInt(agent.collected);
      }
      Object.assign(result.totals, {
        collected: collected.toString(),
        agents: result.agents.length,
        activeAgents: result.agents.filter((agent) =>
          ["ACTIVE", "RECENT", "ABSENT"].includes(agent.state),
        ).length,
        absentAgents: result.agents.filter((agent) => agent.state === "ABSENT")
          .length,
        disabledAgents: result.agents.filter(
          (agent) => agent.state === "DISABLED",
        ).length,
        noActivityAgents: result.agents.filter((agent) => agent.total === 0)
          .length,
        unassignedDossiers,
        unassignedTasks,
        reportsToReview: toReview,
      });
      result.workload = result.agents
        .map(
          ({
            id,
            name,
            dossiers: assigned,
            tasksOpen,
            tasksOverdue,
            tasksBlocked,
          }) => ({
            id,
            name,
            dossiers: assigned,
            tasksOpen,
            tasksOverdue,
            tasksBlocked,
          }),
        )
        .sort(
          (a, b) =>
            b.tasksOverdue - a.tasksOverdue ||
            b.tasksOpen - a.tasksOpen ||
            a.id.localeCompare(b.id),
        );
      const taskQuery = userId ? `&agent=${encodeURIComponent(userId)}` : "";
      result.attention = [
        {
          kind: "overdue",
          label: "Tâches dont l’échéance est dépassée",
          count: result.totals.tasksOverdue,
          href: `/taches?statut=overdue${taskQuery}`,
        },
        {
          kind: "blocked",
          label: "Tâches signalées bloquées",
          count: result.totals.tasksBlocked,
          href: `/taches?statut=BLOCKED${taskQuery}`,
        },
        {
          kind: "reports",
          label: "Rapports en attente d’examen",
          count: toReview,
          href: `/reports?statut=SUBMITTED${userId ? `&auteur=${encodeURIComponent(userId)}` : ""}`,
        },
        ...(!userId
          ? [
              {
                kind: "unassigned-dossiers" as const,
                label: "Dossiers sans référent",
                count: unassignedDossiers,
                href: "/equipe#sans-referent",
              },
              {
                kind: "unassigned-tasks" as const,
                label: "Tâches à attribuer",
                count: unassignedTasks,
                href: "/taches?agent=unassigned",
              },
            ]
          : []),
      ].filter((item) => item.count > 0) as TeamAnalytics["attention"];
      result.dataQuality = {
        excludedPayments,
        excludedTransactions,
        unknownValidationDates: unknownPaymentDates + unknownResourceDates,
      };
      return result;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
}

export async function getTeamAnalytics(
  session: SessionInfo,
  filters: AnalyticsFilters = {},
): Promise<TeamAnalytics> {
  return (await loadAnalytics(session, filters))!;
}

/** The same strict team permission applies even when the requested ID is the actor. */
export function getAgentAnalytics(
  session: SessionInfo,
  userId: string,
  filters: AnalyticsFilters = {},
): Promise<TeamAnalytics | null> {
  return loadAnalytics(session, filters, userId);
}
