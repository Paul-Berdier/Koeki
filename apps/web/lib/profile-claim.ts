import { prisma } from "@koeki/database";
import { assertActiveActor, lockAccountChanges } from "./account-service";
import { writeAudit } from "./finance";

export const profileLabel = (firstName: string, lastName: string, code: string) => `${firstName} ${lastName} · ${code}`.normalize("NFKC").replace(/\s+/gu, " ").trim();

export function parseProfileReference(reference: unknown) {
  if (typeof reference !== "string" || reference.length > 250) throw new Error("Choisissez une fiche précise dans la liste");
  const normalized = reference.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const match = /^(.+) · (NIN-\d{6})$/u.exec(normalized);
  if (!match) throw new Error("Choisissez une proposition complète avec son code NIN : un prénom seul ne suffit pas");
  return { label: normalized, code: match[2]! };
}

/** Preserve the existing onboarding permission scope, but never guess a person,
 * replace an existing link, or steal a reserved/claimed record. Confirmation is
 * an accidental-selection safeguard, not proof that a player owns a character. */
export async function claimExactProfile(userId: string, reference: unknown, confirmed: boolean): Promise<string> {
  if (!confirmed) throw new Error("Confirmez que le personnage et le code sélectionnés sont bien les vôtres");
  const parsed = parseProfileReference(reference);
  return prisma.$transaction(async (tx) => {
    await lockAccountChanges(tx);
    await assertActiveActor(tx, userId, "self:read");
    const selected = await tx.ninjaProfile.findUnique({ where: { code: parsed.code }, select: { id: true } });
    if (!selected) throw new Error("Fiche introuvable : rechargez les propositions");
    await tx.$queryRaw`SELECT "id" FROM "NinjaProfile" WHERE "id" = ${selected.id} FOR UPDATE`;
    const target = await tx.ninjaProfile.findUniqueOrThrow({ where: { id: selected.id } });
    if (profileLabel(target.firstName, target.lastName, target.code) !== parsed.label) throw new Error("Le nom ne correspond plus au code choisi : sélectionnez à nouveau votre fiche");
    const existing = await tx.ninjaProfile.findUnique({ where: { userId }, select: { id: true } });
    if (existing) {
      if (existing.id === target.id) return existing.id;
      throw new Error("Votre compte est déjà rattaché à une autre fiche. Aucun rattachement ne peut être remplacé depuis ce formulaire.");
    }
    if (target.status !== "ACTIVE" || target.userId) throw new Error("Cette fiche n’est plus disponible");
    const reservation = await tx.invitation.findFirst({ where: { ninjaProfileId: target.id, status: "PENDING", revokedAt: null, consumedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (reservation) throw new Error("Cette fiche est réservée par une invitation en cours");
    const result = await tx.ninjaProfile.updateMany({ where: { id: target.id, userId: null, status: "ACTIVE", version: target.version }, data: { userId, version: { increment: 1 } } });
    if (result.count !== 1) throw new Error("Cette fiche vient de changer : rechargez la page");
    await writeAudit(tx, { actorId: userId, action: "NINJA_CLAIMED", entityType: "NinjaProfile", entityId: target.id,
      reason: "Fiche exacte sélectionnée et confirmée lors de l’arrivée",
      previousValues: { userId: null }, newValues: { userId, code: target.code },
    });
    return target.id;
  });
}
