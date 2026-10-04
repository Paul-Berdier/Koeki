import { prisma, type Prisma } from "@koeki/database";
import {
  adjacentRankingWeek,
  can,
  isReportExpected,
  participationLabel,
  rankingWeekAt,
  type Permission,
  type RankingSnapshot,
} from "@koeki/domain";
import { demoMode, hasPermission, type SessionInfo } from "./session";
import {
  formatReportDate,
  normalizeReportHistoryRange,
  reportDayBoundary,
  shiftReportDate,
} from "./report-period";

export const taskLabels: Record<string, string> = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  BLOCKED: "Bloqué",
  DONE: "Terminé",
  CANCELLED: "Annulé",
};
export const priorityLabels: Record<string, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
};
const activeTaskStatuses = ["TODO", "IN_PROGRESS", "BLOCKED"];
const identitySelect = {
  id: true,
  name: true,
  revokedAt: true,
  ninjaProfile: { select: { firstName: true, lastName: true } },
} as const;
export function agentName(user: {
  name: string | null;
  ninjaProfile: { firstName: string; lastName: string } | null;
}) {
  return user.ninjaProfile
    ? `${user.ninjaProfile.firstName} ${user.ninjaProfile.lastName}`
    : (user.name ?? "Identité non renseignée");
}

/** Shared lock with account lifecycle mutations. Always take it BEFORE row locks. */
export async function assertTeamActor(
  tx: Prisma.TransactionClient,
  userId: string,
  permission: Permission,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714424)`;
  const actor = await tx.user.findUnique({
    where: { id: userId },
    select: {
      revokedAt: true,
      roles: { select: { role: { select: { code: true } } } },
    },
  });
  if (
    !actor ||
    actor.revokedAt ||
    !actor.roles.some(({ role }) => can(role.code, permission))
  )
    throw new Error("FORBIDDEN");
  return actor;
}
export async function assertAssignee(
  tx: Prisma.TransactionClient,
  userId: string | null,
) {
  if (!userId) return;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      revokedAt: true,
      roles: { select: { role: { select: { code: true } } } },
    },
  });
  if (
    !user ||
    user.email === "systeme@koeki.local" ||
    user.revokedAt ||
    !user.roles.some(({ role }) =>
      ["ECONOMIC_AGENT", "KOEKI_MANAGER", "SUPER_ADMIN"].includes(role.code),
    )
  )
    throw new Error(
      "VALIDATION:Le référent doit disposer d’un accès humain actif au service",
    );
}
export async function notifyInternal(
  tx: Prisma.TransactionClient,
  data: {
    userId: string;
    title: string;
    body: string;
    href: string;
    dedupeKey: string;
  },
) {
  await tx.notification.upsert({
    where: { dedupeKey: data.dedupeKey },
    update: {},
    create: data,
  });
}

export async function getAssignableAgents(session: SessionInfo) {
  if (
    !hasPermission(session, "team:assign") &&
    !hasPermission(session, "tasks:manage")
  )
    throw new Error("FORBIDDEN");
  if (demoMode) return [];
  const users = await prisma.user.findMany({
    where: {
      revokedAt: null,
      OR: [{ email: null }, { email: { not: "systeme@koeki.local" } }],
      roles: {
        some: {
          role: {
            code: { in: ["ECONOMIC_AGENT", "KOEKI_MANAGER", "SUPER_ADMIN"] },
          },
        },
      },
    },
    select: identitySelect,
    orderBy: { id: "asc" },
    take: 500,
  });
  return users.map((user) => ({ id: user.id, name: agentName(user) }));
}

export async function getMyWorkSummary(session: SessionInfo) {
  const empty = {
    tasks: [] as {
      id: string;
      title: string;
      status: string;
      priority: string;
      dueAt: Date | null;
    }[],
    assignedDossiers: 0,
    returnedReports: 0,
    awaitingReview: 0,
    unassignedDossiers: 0,
    blockedTasks: 0,
    overdueTasks: 0,
    activeAgents: 0,
  };
  if (demoMode || !hasPermission(session, "tasks:read")) return empty;
  const manager = hasPermission(session, "team:read");
  const scope = manager ? {} : { assigneeId: session.userId };
  const [
    tasks,
    assignedDossiers,
    returnedReports,
    awaitingReview,
    unassignedDossiers,
    blockedTasks,
    overdueTasks,
    activeAgents,
  ] = await Promise.all([
    prisma.followUpTask.findMany({
      where: { ...scope, status: { in: activeTaskStatuses } },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 6,
    }),
    prisma.ninjaProfile.count({
      where: { referenceAgentId: session.userId, status: "ACTIVE" },
    }),
    prisma.agentReport.count({
      where: { authorId: session.userId, status: "RETURNED" },
    }),
    manager
      ? prisma.agentReport.count({
          where: { status: "SUBMITTED", authorId: { not: session.userId } },
        })
      : 0,
    manager
      ? prisma.ninjaProfile.count({
          where: { referenceAgentId: null, status: "ACTIVE" },
        })
      : 0,
    prisma.followUpTask.count({ where: { ...scope, status: "BLOCKED" } }),
    prisma.followUpTask.count({
      where: {
        ...scope,
        status: { in: activeTaskStatuses },
        dueAt: { lt: new Date() },
      },
    }),
    manager
      ? prisma.agentParticipation.count({
          where: { endsAt: null, user: { revokedAt: null } },
        })
      : 0,
  ]);
  return {
    tasks,
    assignedDossiers,
    returnedReports,
    awaitingReview,
    unassignedDossiers,
    blockedTasks,
    overdueTasks,
    activeAgents,
  };
}

export async function getTasks(
  session: SessionInfo,
  filters: {
    status?: string | undefined;
    page?: number | undefined;
    assignee?: string | undefined;
    id?: string | undefined;
  } = {},
) {
  if (!hasPermission(session, "tasks:read")) throw new Error("FORBIDDEN");
  const manager = hasPermission(session, "tasks:manage");
  const where: Prisma.FollowUpTaskWhereInput = {
    ...(filters.id ? { id: filters.id } : {}),
    ...(!manager
      ? { assigneeId: session.userId }
      : filters.assignee === "unassigned"
        ? { assigneeId: null }
        : filters.assignee
          ? { assigneeId: filters.assignee }
          : {}),
    ...(filters.status === "overdue"
      ? { dueAt: { lt: new Date() }, status: { in: activeTaskStatuses } }
      : filters.status && taskLabels[filters.status]
        ? { status: filters.status }
        : {}),
  };
  if (demoMode) return { tasks: [], total: 0, page: 1, pageCount: 1 };
  const total = await prisma.followUpTask.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / 25));
  const page = Math.min(
    pageCount,
    Math.max(1, Math.floor(filters.page ?? 1) || 1),
  );
  const tasks = await prisma.followUpTask.findMany({
    where,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    skip: (page - 1) * 25,
    take: 25,
    include: { transitions: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  const ids = [
    ...new Set(
      tasks
        .map((task) => task.assigneeId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: identitySelect,
  });
  const names = new Map(users.map((user) => [user.id, agentName(user)]));
  return {
    tasks: tasks.map((task) => ({
      ...task,
      assigneeName: task.assigneeId
        ? (names.get(task.assigneeId) ?? "Identité conservée")
        : "À attribuer",
    })),
    total,
    page,
    pageCount,
  };
}

export async function getTeamOverview(
  session: SessionInfo,
  filters: {
    from?: string | undefined;
    to?: string | undefined;
    search?: string | undefined;
    status?: string | undefined;
    sort?: string | undefined;
    page?: number | undefined;
  } = {},
) {
  if (!hasPermission(session, "team:read")) throw new Error("FORBIDDEN");
  const today = formatReportDate(new Date());
  const fromValue = filters.from || shiftReportDate(today, -6),
    toValue = filters.to || today;
  const { from, to } = normalizeReportHistoryRange(fromValue, toValue);
  if (!from || !to || to.getTime() - from.getTime() > 366 * 86400000)
    throw new Error("La période doit couvrir au maximum un an");
  if (demoMode)
    return {
      rows: [],
      from: fromValue,
      to: toValue,
      total: 0,
      page: 1,
      pageCount: 1,
      unassigned: 0,
      awaiting: 0,
    };
  const searchTokens = (filters.search ?? "")
    .trim()
    .slice(0, 160)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  const where: Prisma.UserWhereInput = {
    AND: [
      {
        OR: [
          { roles: { some: { role: { code: "ECONOMIC_AGENT" } } } },
          { participations: { some: {} } },
        ],
      },
      ...searchTokens.map((token) => ({
        OR: [
          { name: { contains: token, mode: "insensitive" as const } },
          {
            ninjaProfile: {
              OR: [
                {
                  firstName: { contains: token, mode: "insensitive" as const },
                },
                { lastName: { contains: token, mode: "insensitive" as const } },
                { alias: { contains: token, mode: "insensitive" as const } },
              ],
            },
          },
        ],
      })),
      ...(filters.status === "disabled"
        ? [{ revokedAt: { not: null } }]
        : filters.status === "active"
          ? [{ revokedAt: null, participations: { some: { endsAt: null } } }]
          : []),
    ],
  };
  const total = await prisma.user.count({ where }),
    pageCount = Math.max(1, Math.ceil(total / 30)),
    page = Math.min(pageCount, Math.max(1, Math.floor(filters.page ?? 1) || 1));
  const order =
    filters.sort === "name-desc" ? ("desc" as const) : ("asc" as const);
  const users = await prisma.user.findMany({
    where,
    select: {
      ...identitySelect,
      roles: { select: { role: { select: { code: true } } } },
      participations: { orderBy: { observedAt: "desc" } },
      absences: {
        where: {
          startsAt: { lt: rankingWeekAt(to).endsAt },
          endsAt: { gt: rankingWeekAt(from).startsAt },
        },
        select: { startsAt: true, endsAt: true },
      },
    },
    orderBy: [
      { ninjaProfile: { lastName: order } },
      { ninjaProfile: { firstName: order } },
      { name: order },
      { id: "asc" },
    ],
    skip: (page - 1) * 30,
    take: 30,
  });
  const ids = users.map((user) => user.id);
  const [
    payments,
    transactions,
    dossiers,
    tasks,
    reports,
    lastPayments,
    lastTransactions,
    unassigned,
    awaiting,
    expectations,
  ] = await Promise.all([
    prisma.taxPayment.groupBy({
      by: ["recordedById"],
      where: {
        recordedById: { in: ids },
        status: "VALIDATED",
        validatedAt: { gte: from, lte: to },
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.resourceTransaction.groupBy({
      by: ["agentId", "recordedById", "type"],
      where: {
        OR: [
          { recordedById: { in: ids } },
          { recordedById: null, agentId: { in: ids } },
        ],
        status: "VALIDATED",
        validatedAt: { gte: from, lte: to },
      },
      _count: true,
      _sum: { totalAmount: true },
    }),
    prisma.ninjaProfile.groupBy({
      by: ["referenceAgentId"],
      where: { referenceAgentId: { in: ids }, status: "ACTIVE" },
      _count: true,
    }),
    prisma.followUpTask.groupBy({
      by: ["assigneeId"],
      where: {
        assigneeId: { in: ids },
        status: { in: activeTaskStatuses },
        dueAt: { lt: new Date() },
      },
      _count: true,
    }),
    prisma.agentReport.groupBy({
      by: ["authorId"],
      where: {
        authorId: { in: ids },
        status: { not: "DRAFT" },
        periodStart: { lte: to },
        periodEnd: { gte: from },
      },
      _count: true,
    }),
    prisma.taxPayment.groupBy({
      by: ["recordedById"],
      where: { recordedById: { in: ids }, status: "VALIDATED" },
      _max: { validatedAt: true },
    }),
    prisma.resourceTransaction.groupBy({
      by: ["agentId", "recordedById"],
      where: {
        OR: [
          { recordedById: { in: ids } },
          { recordedById: null, agentId: { in: ids } },
        ],
        status: "VALIDATED",
      },
      _max: { validatedAt: true },
    }),
    prisma.ninjaProfile.count({
      where: { referenceAgentId: null, status: "ACTIVE" },
    }),
    prisma.agentReport.count({ where: { status: "SUBMITTED" } }),
    prisma.reportExpectation.findMany({
      where: { effectiveFrom: { lte: to } },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);
  const rows = users.map((user) => {
    const payment = payments.find((row) => row.recordedById === user.id);
    const totals = (type: string) =>
      transactions
        .filter(
          (row) =>
            (row.recordedById ?? row.agentId) === user.id && row.type === type,
        )
        .reduce(
          (total, row) => ({
            _count: total._count + row._count,
            _sum: {
              totalAmount:
                total._sum.totalAmount + (row._sum.totalAmount ?? 0n),
            },
          }),
          { _count: 0, _sum: { totalAmount: 0n } },
        );
    const donation = totals("DONATION"),
      buyback = totals("BUYBACK");
    const operations =
      (payment?._count ?? 0) + (donation?._count ?? 0) + (buyback?._count ?? 0);
    const participation = user.participations.find((entry) => !entry.endsAt);
    let expected = 0;
    for (
      let week = rankingWeekAt(from);
      week.startsAt <= to;
      week = adjacentRankingWeek(week, 1)
    ) {
      const rule = expectations.find(
        (entry) => entry.effectiveFrom <= week.startsAt,
      );
      if (!rule) continue;
      if (
        user.participations.some(
          (part) =>
            (rule.population !== "ECONOMIC_AGENT" ||
              part.serviceRole === "ECONOMIC_AGENT") &&
            isReportExpected({
              periodStart: week.startsAt,
              periodEnd: new Date(week.endsAt.getTime() - 1),
              effectiveFrom: rule.effectiveFrom,
              participationStart: part.startsAt ?? part.observedAt,
              participationEnd: part.endsAt,
              absences: user.absences,
            }),
        )
      )
        expected++;
    }
    const dates = [
      lastPayments.find((row) => row.recordedById === user.id)?._max
        .validatedAt,
      ...lastTransactions
        .filter((row) => (row.recordedById ?? row.agentId) === user.id)
        .map((row) => row._max.validatedAt),
    ].filter((date): date is Date => Boolean(date));
    return {
      id: user.id,
      name: agentName(user),
      state: participationLabel({
        revoked: Boolean(user.revokedAt),
        participates: Boolean(participation),
        recent: Boolean(
          participation?.startsAt && participation.startsAt >= from,
        ),
        absent: user.absences.length > 0,
        hasActivity: operations > 0,
      }),
      entryKnown: Boolean(participation?.startsAt),
      dossiers:
        dossiers.find((row) => row.referenceAgentId === user.id)?._count ?? 0,
      payments: payment?._count ?? 0,
      collected: payment?._sum.amount ?? 0n,
      donations: donation?._count ?? 0,
      buybacks: buyback?._count ?? 0,
      operations,
      reports: reports.find((row) => row.authorId === user.id)?._count ?? 0,
      expectedReports: expectations.length ? expected : null,
      overdue: tasks.find((row) => row.assigneeId === user.id)?._count ?? 0,
      lastActivity: dates.length
        ? new Date(Math.max(...dates.map(Number)))
        : null,
    };
  });
  return {
    rows,
    from: fromValue,
    to: toValue,
    total,
    page,
    pageCount,
    unassigned,
    awaiting,
  };
}

export async function getAgentDetail(
  session: SessionInfo,
  userId: string,
  filters: { from?: string | undefined; to?: string | undefined } = {},
) {
  if (!hasPermission(session, "team:read")) throw new Error("FORBIDDEN");
  if (demoMode) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...identitySelect,
      participations: { orderBy: { observedAt: "desc" }, take: 30 },
      absences: { orderBy: { startsAt: "desc" }, take: 30 },
    },
  });
  if (!user) return null;
  const since = reportDayBoundary(
    shiftReportDate(formatReportDate(new Date()), -90),
  );
  const period = normalizeReportHistoryRange(filters.from, filters.to);
  const range = {
    gte: period.from ?? since,
    ...(period.to ? { lte: period.to } : {}),
  };
  const activityDate = {
    OR: [{ validatedAt: range }, { validatedAt: null, createdAt: range }],
  };
  const [
    payments,
    transactions,
    dossiers,
    reports,
    tasks,
    notes,
    assignments,
    rankingPeriods,
  ] = await Promise.all([
    prisma.taxPayment.findMany({
      where: { recordedById: userId, ...activityDate },
      select: {
        id: true,
        receiptNumber: true,
        ninjaId: true,
        amount: true,
        status: true,
        validatedAt: true,
        createdAt: true,
        operationOrigin: true,
      },
      orderBy: [
        { validatedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 50,
    }),
    prisma.resourceTransaction.findMany({
      where: {
        AND: [
          {
            OR: [
              { recordedById: userId },
              { recordedById: null, agentId: userId },
            ],
          },
          activityDate,
        ],
      },
      select: {
        id: true,
        receiptNumber: true,
        ninjaId: true,
        totalAmount: true,
        status: true,
        type: true,
        validatedAt: true,
        createdAt: true,
        operationOrigin: true,
      },
      orderBy: [
        { validatedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 50,
    }),
    prisma.ninjaProfile.findMany({
      where: { referenceAgentId: userId },
      select: { id: true, firstName: true, lastName: true, status: true },
      orderBy: { lastName: "asc" },
      take: 100,
    }),
    prisma.agentReport.findMany({
      where: {
        authorId: userId,
        ...(userId !== session.userId
          ? { status: { not: "DRAFT" as const } }
          : {}),
      },
      select: { id: true, periodStart: true, periodEnd: true, status: true },
      orderBy: { periodStart: "desc" },
      take: 20,
    }),
    prisma.followUpTask.findMany({
      where: { assigneeId: userId, status: { in: activeTaskStatuses } },
      orderBy: { dueAt: "asc" },
      take: 30,
    }),
    hasPermission(session, "team:notes")
      ? prisma.agentNote.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 30,
        })
      : [],
    prisma.assignmentHistory.findMany({
      where: { OR: [{ previousAgentId: userId }, { assignedAgentId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.rankingPeriod.findMany({
      orderBy: { startsAt: "desc" },
      take: 12,
      select: {
        weekKey: true,
        correctionNeeded: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, snapshot: true },
        },
      },
    }),
  ]);
  const weekly = rankingPeriods.map((period) => {
    const version = period.versions[0];
    const snapshot = version?.snapshot as unknown as
      RankingSnapshot | undefined;
    const row = snapshot?.rows.find((entry) => entry.userId === userId);
    return {
      weekKey: period.weekKey,
      version: version?.version ?? null,
      operations: row?.operations ?? null,
      rank: row?.rank ?? null,
      correctionNeeded: period.correctionNeeded,
      coverageComplete: snapshot?.coverageComplete ?? false,
    };
  });
  const noteAuthors = await prisma.user.findMany({
    where: { id: { in: [...new Set(notes.map((note) => note.authorId))] } },
    select: identitySelect,
  });
  const names = new Map(
    noteAuthors.map((author) => [author.id, agentName(author)]),
  );
  return {
    user: { ...user, name: agentName(user) },
    payments,
    transactions,
    dossiers,
    reports,
    tasks,
    notes: notes.map((note) => ({
      ...note,
      authorName: names.get(note.authorId) ?? "Auteur historique",
    })),
    assignments,
    weekly,
  };
}
