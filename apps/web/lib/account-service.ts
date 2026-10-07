import { Prisma, prisma } from "@koeki/database";
import { assertAccountChange, canAny, type AccessAccount, type Role } from "@koeki/domain";
import { demoMode, requirePermission } from "./session";
import { writeAudit } from "./finance";

// Shared with invitations, task assignment and participation changes.
export async function lockAccountChanges(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714424)`;
}
export async function currentAccount(tx: Prisma.TransactionClient, id: string): Promise<AccessAccount> {
  const row = await tx.user.findUnique({ where: { id }, select: { id: true, revokedAt: true, sessionVersion: true, roles: { select: { role: { select: { code: true } } } }, accounts: { where: { provider: "discord" }, take: 1, select: { id: true } }, sessions: { where: { expires: { gt: new Date() } }, select: { sessionVersion: true } } } });
  if (!row) throw new Error("Compte introuvable");
  return { id: row.id, revokedAt: row.revokedAt, roles: row.roles.map((entry) => entry.role.code), connectable: row.accounts.length > 0 || row.sessions.some((session) => session.sessionVersion === row.sessionVersion) };
}
export async function assertActiveActor(tx: Prisma.TransactionClient, id: string, permission: Parameters<typeof canAny>[1]) {
  const actor = await currentAccount(tx, id);
  if (actor.revokedAt || !canAny(actor.roles, permission)) throw new Error("Accès refusé");
  return actor;
}
export type AccountChangeInput = {
  actorId: string; targetId: string; operation: "revoke" | "reactivate" | "roles" | "remove-agent";
  reason: string; roles?: Role[]; replacementAgentId?: string | null;
};
/** Keep financial authors and legacy ninja metadata intact. Only explicit tasks can transfer. */
export async function changeAccount(input: AccountChangeInput) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1000) throw new Error("Précisez un motif de 3 à 1 000 caractères");
  return prisma.$transaction(async (tx) => {
    await lockAccountChanges(tx);
    const actor = await currentAccount(tx, input.actorId), target = await currentAccount(tx, input.targetId);
    const operation = input.operation === "remove-agent" ? "roles" : input.operation;
    const requestedRoles = input.operation === "remove-agent" ? target.roles.filter((role) => role !== "ECONOMIC_AGENT") : input.roles;
    if (operation === "roles" && !requestedRoles) throw new Error("Choisissez les rôles à conserver");
    const counts = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "User" u
      WHERE u."revokedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = u.id AND r.code = 'SUPER_ADMIN')
        AND (EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u.id AND a.provider = 'discord')
          OR EXISTS (SELECT 1 FROM "Session" s WHERE s."userId" = u.id AND s.expires > CURRENT_TIMESTAMP AND s."sessionVersion" = u."sessionVersion"))
    `;
    assertAccountChange({ actor, target, operation, ...(requestedRoles ? { requestedRoles } : {}), activeSuperAdmins: Number(counts[0]?.count ?? 0n) });
    if ((operation === "revoke" && target.revokedAt) || (operation === "reactivate" && !target.revokedAt)) return { changed: false };
    if (operation === "roles" && requestedRoles!.length === target.roles.length && requestedRoles!.every((role) => target.roles.includes(role))) return { changed: false };
    const serviceRole = (role: Role) => role === "ECONOMIC_AGENT" || role === "KOEKI_MANAGER" || role === "SUPER_ADMIN";
    const leavesService = operation === "revoke" || (operation === "roles" && ((target.roles.includes("ECONOMIC_AGENT") && !requestedRoles!.includes("ECONOMIC_AGENT")) || (target.roles.some(serviceRole) && !requestedRoles!.some(serviceRole))));
    const now = new Date();
    if (leavesService) {
      const replacementId = input.replacementAgentId || null;
      if (replacementId) {
        const replacement = await currentAccount(tx, replacementId);
        const identity = await tx.user.findUnique({ where: { id: replacementId }, select: { email: true } });
        if (replacement.id === target.id || replacement.revokedAt || identity?.email === "systeme@koeki.local" || !canAny(replacement.roles, "tasks:read")) throw new Error("Le remplaçant doit être un autre membre actif du service");
      }
      // No ninja reassignment: everyone works on the shared register. Historical
      // referenceAgentId values and old assignment audit rows are inert and retained.
      const tasks = await tx.followUpTask.findMany({ where: { assigneeId: target.id, status: { notIn: ["DONE", "CANCELLED"] } }, select: { id: true } });
      if (tasks.length) {
        await tx.followUpTask.updateMany({ where: { id: { in: tasks.map((row) => row.id) }, assigneeId: target.id }, data: { assigneeId: replacementId, version: { increment: 1 } } });
        await tx.assignmentHistory.createMany({ data: tasks.map((row) => ({ taskId: row.id, previousAgentId: target.id, assignedAgentId: replacementId, actorId: actor.id, reason })) });
      }
      await tx.agentParticipation.updateMany({ where: { userId: target.id, endsAt: null }, data: { endsAt: now } });
    }
    if (operation === "roles") {
      const roles = await tx.role.findMany({ where: { code: { in: requestedRoles! } }, select: { id: true, code: true } });
      if (roles.length !== new Set(requestedRoles).size) throw new Error("Rôle inconnu");
      await tx.userRole.deleteMany({ where: { userId: target.id, role: { code: { notIn: requestedRoles! } } } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId: target.id, roleId: role.id, assignedById: actor.id })), skipDuplicates: true });
      if (!target.roles.includes("ECONOMIC_AGENT") && requestedRoles!.includes("ECONOMIC_AGENT")) {
        const participation = await tx.agentParticipation.findFirst({ where: { userId: target.id, endsAt: null }, select: { id: true, serviceRole: true, rankingEligible: true } });
        if (participation?.serviceRole !== "ECONOMIC_AGENT") {
          if (participation) await tx.agentParticipation.update({ where: { id: participation.id }, data: { endsAt: now } });
          await tx.agentParticipation.create({ data: { userId: target.id, startsAt: now, dateSource: "DECLARED", serviceRole: "ECONOMIC_AGENT", rankingEligible: participation?.rankingEligible ?? true, createdById: actor.id } });
        }
      }
    } else {
      await tx.user.update({ where: { id: target.id }, data: { revokedAt: operation === "revoke" ? now : null, sessionVersion: { increment: 1 } } });
      await tx.session.deleteMany({ where: { userId: target.id } });
      if (operation === "reactivate" && target.roles.includes("ECONOMIC_AGENT") && !await tx.agentParticipation.findFirst({ where: { userId: target.id, endsAt: null }, select: { id: true } })) await tx.agentParticipation.create({ data: { userId: target.id, startsAt: now, dateSource: "DECLARED", serviceRole: "ECONOMIC_AGENT", rankingEligible: true, createdById: actor.id } });
    }
    await writeAudit(tx, {
      actorId: actor.id, action: operation === "revoke" ? "USER_ACCESS_REVOKED" : operation === "reactivate" ? "USER_ACCESS_REACTIVATED" : "USER_ROLES_UPDATED", entityType: "User", entityId: target.id, reason,
      previousValues: { roles: [...target.roles], revokedAt: target.revokedAt?.toISOString() ?? null },
      newValues: { roles: requestedRoles ?? [...target.roles], revokedAt: operation === "revoke" ? now.toISOString() : null, replacementAgentId: leavesService ? input.replacementAgentId || null : null },
    });
    return { changed: true };
  });
}
export async function getAccounts(query: { q?: string; role?: string; state?: string; page?: string }) {
  await requirePermission("users:read");
  let page = Math.max(1, Math.min(100_000, Number.parseInt(query.page ?? "1", 10) || 1));
  const q = (query.q ?? "").trim().slice(0, 100);
  const validRoles: Role[] = ["SUPER_ADMIN", "KOEKI_MANAGER", "ECONOMIC_AGENT", "NINJA", "AUDITOR"];
  const role = validRoles.find((value) => value === query.role), disabled = query.state === "disabled";
  const where: Prisma.UserWhereInput = { revokedAt: disabled ? { not: null } : null,
    ...(role ? { roles: { some: { role: { code: role } } } } : {}),
    ...(q ? { AND: q.split(/\s+/).map((word) => ({ OR: [{ name: { contains: word, mode: "insensitive" as const } }, { ninjaProfile: { OR: [{ firstName: { contains: word, mode: "insensitive" as const } }, { lastName: { contains: word, mode: "insensitive" as const } }, { alias: { contains: word, mode: "insensitive" as const } }, { code: { contains: word, mode: "insensitive" as const } }] } }] })) } : {}),
  };
  if (demoMode) return { users: [], replacements: [], total: 0, page, pages: 1 };
  const total = await prisma.user.count({ where });
  page = Math.min(page, Math.max(1, Math.ceil(total / 20)));
  const [users, replacements] = await Promise.all([
    prisma.user.findMany({ where, take: 20, skip: (page - 1) * 20, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, revokedAt: true, roles: { select: { role: { select: { code: true } } } }, ninjaProfile: { select: { firstName: true, lastName: true, code: true } } } }),
    prisma.user.findMany({ where: { revokedAt: null, OR: [{ email: null }, { email: { not: "systeme@koeki.local" } }], roles: { some: { role: { code: { in: ["ECONOMIC_AGENT", "KOEKI_MANAGER", "SUPER_ADMIN"] } } } } }, orderBy: { name: "asc" }, select: { id: true, name: true, ninjaProfile: { select: { firstName: true, lastName: true } } } }),
  ]);
  const tasks = await prisma.followUpTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: users.map((user) => user.id) }, status: { notIn: ["DONE", "CANCELLED"] } }, _count: { id: true } });
  const identity = (user: { id: string; name: string | null; ninjaProfile: { firstName: string; lastName: string } | null }) => user.ninjaProfile ? `${user.ninjaProfile.firstName} ${user.ninjaProfile.lastName}` : user.name ?? "Compte sans identité RP";
  return { users: users.map((user) => ({ id: user.id, name: identity(user), code: user.ninjaProfile?.code ?? null, roles: user.roles.map((entry) => entry.role.code), revokedAt: user.revokedAt?.toISOString() ?? null, dossiers: 0, tasks: tasks.find((entry) => entry.assigneeId === user.id)?._count.id ?? 0 })), replacements: replacements.map((user) => ({ id: user.id, name: identity(user) })), total, page, pages: Math.max(1, Math.ceil(total / 20)) };
}
