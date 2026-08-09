"use server";

import { redirect } from "next/navigation";
import { prisma } from "@koeki/database";
import { writeAudit } from "@/lib/finance";
import { requireWriteAccess } from "@/lib/session";

const EQUIPMENT_SLOTS = ["haut", "bas", "bottes", "boucles", "bague", "collier", "gants"] as const;
const TIERS = ["Aucun", "T1", "T2", "T3", "T4"];
const TYPES = ["", "Armure", "Jutsu", "Ténacité"];

/** Replaces a Jonin's full loadout — one JSON row per ninja, audited. */
export async function updateEquipment(formData: FormData) {
  const session = await requireWriteAccess("inventory:write");
  const back = (message: string): never => redirect(`/equipement?erreur=${encodeURIComponent(message)}`);
  const ninjaId = formData.get("ninjaId");
  if (typeof ninjaId !== "string" || !ninjaId) back("Sélectionnez un ninja");
  const ninja = await prisma.ninjaProfile.findUnique({ where: { id: ninjaId as string }, select: { firstName: true, lastName: true, status: true } });
  if (!ninja || ninja.status !== "ACTIVE") back(ninja ? "La panoplie d’un ninja inactif ou décédé ne peut plus être modifiée" : "Ninja introuvable");
  const slots: Record<string, { tier: string; type: string | null }> = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const tier = formData.get(`slot_${slot}_tier`);
    const type = formData.get(`slot_${slot}_type`);
    if (typeof tier !== "string" || !TIERS.includes(tier)) back(`Tier invalide pour ${slot}`);
    if (typeof type !== "string" || !TYPES.includes(type)) back(`Type invalide pour ${slot}`);
    slots[slot] = { tier: tier as string, type: tier === "Aucun" || !type ? null : (type as string) };
  }
  const previous = await prisma.ninjaEquipment.findUnique({ where: { ninjaId: ninjaId as string } });
  await prisma.$transaction(async (tx) => {
    await tx.ninjaEquipment.upsert({ where: { ninjaId: ninjaId as string }, create: { ninjaId: ninjaId as string, slots, updatedById: session.userId }, update: { slots, updatedById: session.userId } });
    await writeAudit(tx, { actorId: session.userId, action: previous ? "EQUIPMENT_UPDATED" : "EQUIPMENT_CREATED", entityType: "NinjaEquipment", entityId: ninjaId as string, reason: `Panoplie de ${ninja!.firstName} ${ninja!.lastName}`, previousValues: previous?.slots ?? undefined, newValues: slots });
  });
  redirect(`/equipement?info=${encodeURIComponent(`Panoplie de ${ninja!.firstName} ${ninja!.lastName} enregistrée`)}`);
}
