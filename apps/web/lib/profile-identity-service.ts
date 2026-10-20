import { z } from "zod";
import { Prisma, prisma } from "@koeki/database";
import { canAny } from "@koeki/domain";
import { assertActiveActor, currentAccount, lockAccountChanges } from "./account-service";
import { ownsDiscordIdentity } from "./discord-identity";
import { writeAudit } from "./finance";

const profileSelect = { id: true, code: true, firstName: true, lastName: true, status: true, userId: true, version: true } as const;

async function authorize(tx: Prisma.TransactionClient, actorId: string, targetId: string, writing = false) {
  const actor = await assertActiveActor(tx, actorId, "users:identity");
  const target = await currentAccount(tx, targetId);
  if (!canAny(actor.roles, "users:leadership") && target.roles.some((role) => role === "SUPER_ADMIN" || role === "KOEKI_MANAGER")) {
    throw new Error("Seul un super-administrateur peut corriger l’identité d’un compte dirigeant");
  }
  if (writing && actorId === targetId) throw new Error("Faites valider votre propre rattachement par un autre responsable autorisé");
  if (writing && (target.revokedAt || !target.roles.length)) throw new Error("Le compte doit être actif et autorisé avant de corriger sa fiche");
}

/** Manager-only bounded view. Do not expose email, OAuth tokens or sessions. */
export async function getProfileIdentity(actorId: string, targetId: string, query: { q?: string; code?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    await authorize(tx, actorId, targetId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: targetId }, select: {
      id: true, name: true, discordId: true, revokedAt: true, sessionVersion: true,
      accounts: { where: { provider: "discord" }, select: { providerAccountId: true } },
      roles: { select: { role: { select: { code: true } } } }, ninjaProfile: { select: profileSelect },
    } });
    const q = (query.q ?? "").trim().slice(0, 100), code = (query.code ?? "").trim().slice(0, 64);
    const candidates = q.length >= 2 ? await tx.ninjaProfile.findMany({
      where: { status: "ACTIVE", AND: q.split(/\s+/).map((part) => ({ OR: [
        { firstName: { contains: part, mode: "insensitive" as const } },
        { lastName: { contains: part, mode: "insensitive" as const } },
        { code: { equals: part, mode: "insensitive" as const } },
      ] })) },
      select: profileSelect, orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }], take: 20,
    }) : [];
    const selected = code ? await tx.ninjaProfile.findUnique({ where: { code }, select: profileSelect }) : null;
    const discordId = user.accounts.length === 1 ? user.accounts[0]!.providerAccountId : null;
    return {
      user: { id: user.id, name: user.name, revoked: Boolean(user.revokedAt), sessionVersion: user.sessionVersion, roles: user.roles.map(({ role }) => role.code) },
      discordId, consistent: discordId !== null && ownsDiscordIdentity(user, discordId),
      current: user.ninjaProfile, candidates, selected,
    };
  }, { isolationLevel: "RepeatableRead" });
}

const changeSchema = z.object({
  actorId: z.string().min(1).max(128), targetId: z.string().min(1).max(128),
  ninjaId: z.string().min(1).max(128), expectedCurrentNinjaId: z.string().max(128).nullable(),
  expectedCurrentVersion: z.number().int().nonnegative().nullable(),
  expectedNinjaVersion: z.number().int().nonnegative(), expectedSessionVersion: z.number().int().nonnegative(),
  confirmedDiscordId: z.string().trim().regex(/^\d{17,20}$/, "Confirmez l’identifiant Discord numérique vérifié auprès de la personne"),
  confirmedCode: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(10, "Précisez un motif d’au moins 10 caractères").max(1000),
});
export type ProfileIdentityChange = z.infer<typeof changeSchema>;

/** Reassign ONLY the login-to-character link. No role, name, fiscal line, author,
 * reference agent, participation or ledger is renamed/moved. Occupied targets are
 * never stolen or swapped. Conflicts require a fresh human-reviewed selection. */
export async function changeProfileIdentity(raw: ProfileIdentityChange) {
  const input = changeSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockAccountChanges(tx);
    await authorize(tx, input.actorId, input.targetId, true);
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.targetId }, select: {
      discordId: true, sessionVersion: true, accounts: { where: { provider: "discord" }, select: { providerAccountId: true } },
    } });
    if (!ownsDiscordIdentity(user, input.confirmedDiscordId)) throw new Error("Identité Discord incohérente ou confirmation incorrecte : aucun rattachement modifié");
    const before = await tx.ninjaProfile.findUnique({ where: { userId: input.targetId }, select: profileSelect });
    const ids = [...new Set([input.ninjaId, ...(before ? [before.id] : [])])].sort();
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "NinjaProfile" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
    const current = await tx.ninjaProfile.findUnique({ where: { userId: input.targetId }, select: profileSelect });
    const target = await tx.ninjaProfile.findUnique({ where: { id: input.ninjaId }, select: profileSelect });
    if (!target || target.status !== "ACTIVE" || target.code !== input.confirmedCode) throw new Error("Vérifiez la fiche cible active et son code exact");
    if (target.userId && target.userId !== input.targetId) throw new Error("Cette fiche appartient déjà à un autre compte : aucun échange automatique n’est autorisé");
    if (current?.id === target.id && target.userId === input.targetId) return { changed: false };
    if (user.sessionVersion !== input.expectedSessionVersion
      || (current?.id ?? null) !== input.expectedCurrentNinjaId
      || (current?.version ?? null) !== input.expectedCurrentVersion
      || target.version !== input.expectedNinjaVersion) throw new Error("Le rattachement ou la fiche a changé : rechargez et vérifiez à nouveau");
    const reservation = await tx.invitation.findFirst({ where: { ninjaProfileId: target.id, status: "PENDING", revokedAt: null, consumedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (reservation) throw new Error("La fiche cible est réservée par une invitation active : vérifiez-la avant de poursuivre");
    if (current) {
      const released = await tx.ninjaProfile.updateMany({ where: { id: current.id, userId: input.targetId, version: current.version }, data: { userId: null, version: { increment: 1 } } });
      if (released.count !== 1) throw new Error("Le rattachement a changé : aucune correction appliquée");
      await writeAudit(tx, { actorId: input.actorId, action: "NINJA_IDENTITY_UNLINKED", entityType: "NinjaProfile", entityId: current.id, reason: input.reason, previousValues: { userId: input.targetId }, newValues: { userId: null } });
    }
    const attached = await tx.ninjaProfile.updateMany({ where: { id: target.id, userId: null, status: "ACTIVE", version: target.version }, data: { userId: input.targetId, version: { increment: 1 } } });
    if (attached.count !== 1) throw new Error("La fiche n’est plus disponible : aucune correction appliquée");
    await tx.user.update({ where: { id: input.targetId }, data: { sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: input.targetId } });
    await writeAudit(tx, { actorId: input.actorId, action: "NINJA_IDENTITY_LINKED", entityType: "NinjaProfile", entityId: target.id, reason: input.reason, previousValues: { userId: null }, newValues: { userId: input.targetId } });
    await writeAudit(tx, { actorId: input.actorId, action: "USER_IDENTITY_CORRECTED", entityType: "User", entityId: input.targetId, reason: input.reason,
      previousValues: { ninjaId: current?.id ?? null, code: current?.code ?? null, sessionVersion: user.sessionVersion },
      newValues: { ninjaId: target.id, code: target.code, sessionVersion: user.sessionVersion + 1, sessionsRevoked: true, rolesChanged: false },
    });
    return { changed: true };
  }, { timeout: 15_000, maxWait: 10_000 });
}
