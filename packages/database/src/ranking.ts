import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { adjacentRankingWeek, buildWeeklyRanking, rankingWeekAt, rankingWeekFromKey, type RankingSnapshot, type RankingWeek } from "@koeki/domain";

export async function calculateRanking(tx: Prisma.TransactionClient, week: RankingWeek): Promise<RankingSnapshot> {
  const evidenceRange = { OR: [
    { firstValidatedAt: { gte: week.startsAt, lt: week.endsAt } },
    { firstValidatedAt: null, OR: [{ validatedAt: { gte: week.startsAt, lt: week.endsAt } }, { validatedAt: null, createdAt: { gte: week.startsAt, lt: week.endsAt } }] }
  ] };
  const [participants, payments, resources, coverage, absences] = await Promise.all([
    tx.agentParticipation.findMany({ where: { rankingEligible: true, AND: [{ OR: [{ startsAt: { lt: week.endsAt } }, { startsAt: null, observedAt: { lt: week.endsAt } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: week.startsAt } }] }] }, include: { user: { select: { name: true, ninjaProfile: { select: { firstName: true, lastName: true } } } } } }),
    tx.taxPayment.findMany({ where: evidenceRange, select: { id: true, recordedById: true, amount: true, status: true, firstValidatedAt: true, validationEvidence: true, operationOrigin: true } }),
    tx.resourceTransaction.findMany({ where: evidenceRange, select: { id: true, recordedById: true, type: true, totalAmount: true, status: true, firstValidatedAt: true, validationEvidence: true, operationOrigin: true, movements: { where: { reversal: { isNot: null } }, select: { id: true }, take: 1 } } }),
    tx.appSetting.findUnique({ where: { key: "rankingCoverage" }, select: { value: true } }),
    tx.agentAbsence.findMany({ where: { startsAt: { lt: week.endsAt }, endsAt: { gt: week.startsAt } }, select: { userId: true } })
  ]);
  const rawCoverage = coverage?.value as { reliableFrom?: string } | undefined;
  const snapshot = buildWeeklyRanking(week, participants.map((p) => ({ ...p, name: p.user.ninjaProfile ? `${p.user.ninjaProfile.firstName} ${p.user.ninjaProfile.lastName}` : p.user.name ?? "Identité RP à renseigner" })), [
    ...payments.map((p) => ({ ...p, authorId: p.recordedById, kind: "PAYMENT" as const })),
    ...resources.map((r) => ({ ...r, authorId: r.recordedById, kind: r.type, amount: r.totalAmount, status: r.movements.length ? "REVERSED" : r.status }))
  ], rawCoverage?.reliableFrom ? new Date(rawCoverage.reliableFrom) : null);
  const unknown = payments.filter((p) => p.operationOrigin === "UNKNOWN" && p.status === "VALIDATED").length + resources.filter((r) => r.operationOrigin === "UNKNOWN" && r.status === "VALIDATED").length;
  snapshot.excludedUnknown += unknown;
  if (unknown) snapshot.coverageComplete = false;
  const absent = new Set(absences.map((absence) => absence.userId));
  for (const row of snapshot.rows) if (absent.has(row.userId)) row.fullWeek = false;
  // Store the portion of participation relevant to this period; a later exit
  // must not retroactively mark an earlier week as changed.
  snapshot.population = snapshot.population.map((p) => ({ ...p, startsAt: p.startsAt < snapshot.startsAt ? snapshot.startsAt : p.startsAt, endsAt: !p.endsAt || p.endsAt > snapshot.endsAt ? snapshot.endsAt : p.endsAt }));
  return snapshot;
}

export function rankingFingerprint(snapshot: RankingSnapshot): string {
  return createHash("sha256").update(JSON.stringify({ ...snapshot, rows: snapshot.rows.map(({ name: _name, ...row }) => row) })).digest("hex");
}

/** Caller must authorize the actor; the transaction independently rechecks them.
 * A period advisory lock plus unique (period,version) makes retries/concurrency safe. */
export async function publishRanking(db: PrismaClient, input: { weekKey: string; actorId?: string; correctionReason?: string; expectedVersion?: number; now?: Date }) {
  const week = rankingWeekFromKey(input.weekKey), now = input.now ?? new Date();
  if (week.endsAt > now) throw new Error("Une semaine encore ouverte ne peut pas être clôturée");
  return db.$transaction(async (tx) => {
    // Account role mutations take this lifecycle lock without necessarily
    // updating the User row. Acquire it first, before period/row locks, so the
    // authorization checked below remains valid until the publication commits.
    if (input.actorId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714424)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ranking:' + week.key}))`;
    if (input.actorId) {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.actorId} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: input.actorId }, include: { roles: { include: { role: true } } } });
      if (!actor || actor.revokedAt || !actor.roles.some((r) => r.role.code === "SUPER_ADMIN" || r.role.code === "KOEKI_MANAGER")) throw new Error("FORBIDDEN");
    }
    const period = await tx.rankingPeriod.upsert({ where: { weekKey: week.key }, create: { weekKey: week.key, startsAt: week.startsAt, endsAt: week.endsAt }, update: {} });
    const latest = await tx.rankingVersion.findFirst({ where: { periodId: period.id }, orderBy: { version: "desc" } });
    const snapshot = await calculateRanking(tx, week), fingerprint = rankingFingerprint(snapshot);
    if (latest) {
      if (latest.fingerprint === fingerprint) return { id: latest.id, version: latest.version, created: false };
      if (!input.correctionReason) {
        await tx.rankingPeriod.update({ where: { id: period.id }, data: { correctionNeeded: true } });
        return { id: latest.id, version: latest.version, created: false, correctionNeeded: true };
      }
      if (!input.actorId || input.correctionReason.trim().length < 10) throw new Error("Une correction exige un responsable et un motif d’au moins 10 caractères");
      if (input.expectedVersion !== latest.version) throw new Error("Le classement a changé : rechargez avant de publier une correction");
    }
    const version = await tx.rankingVersion.create({ data: { periodId: period.id, version: (latest?.version ?? 0) + 1, formulaVersion: snapshot.formulaVersion, snapshot: snapshot as unknown as Prisma.InputJsonValue, fingerprint, reason: latest ? input.correctionReason!.trim() : null, createdById: input.actorId ?? null } });
    await tx.rankingPeriod.update({ where: { id: period.id }, data: { correctionNeeded: false } });
    await tx.auditLog.create({ data: { actorId: input.actorId ?? null, action: latest ? "RANKING_CORRECTED" : "RANKING_CLOSED", entityType: "RankingVersion", entityId: version.id, requestId: randomUUID(), reason: input.correctionReason ?? `Clôture ${week.key}`, newValues: { weekKey: week.key, version: version.version, formula: snapshot.formulaVersion } } });
    return { id: version.id, version: version.version, created: true };
  }, { timeout: 30_000 });
}

/** Resumes missed closures from the evidence cutover, never the current week.
 * Existing historical periods are checked for late corrections, never republished. */
export async function closeCompletedRankings(db: PrismaClient, now = new Date()) {
  const coverage = await db.appSetting.findUnique({ where: { key: "rankingCoverage" } });
  const reliableFrom = (coverage?.value as { reliableFrom?: string } | undefined)?.reliableFrom;
  if (!reliableFrom) return { command: "ranking:close", closed: 0, corrections: 0, unconfigured: true };
  const keys = new Set((await db.rankingPeriod.findMany({ select: { weekKey: true } })).map((p) => p.weekKey));
  let week = rankingWeekAt(new Date(reliableFrom));
  while (week.endsAt <= now) { keys.add(week.key); week = adjacentRankingWeek(week, 1); }
  let closed = 0, corrections = 0;
  for (const weekKey of [...keys].sort()) {
    const result = await publishRanking(db, { weekKey, now });
    if (result.created) closed++;
    if ("correctionNeeded" in result) corrections++;
  }
  return { command: "ranking:close", closed, corrections };
}
