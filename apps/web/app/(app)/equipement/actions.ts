"use server";

import { redirect } from "next/navigation";
import { prisma } from "@koeki/database";
import { lockActiveNinja, writeAudit } from "@/lib/finance";
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
  const slots: Record<string, { tier: string; type: string | null }> = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const tier = formData.get(`slot_${slot}_tier`);
    const type = formData.get(`slot_${slot}_type`);
    if (typeof tier !== "string" || !TIERS.includes(tier)) back(`Tier invalide pour ${slot}`);
    if (typeof type !== "string" || !TYPES.includes(type)) back(`Type invalide pour ${slot}`);
    slots[slot] = { tier: tier as string, type: tier === "Aucun" || !type ? null : (type as string) };
  }
  let ninjaName = "";
  try {
    await prisma.$transaction(async (tx) => {
      if (!await lockActiveNinja(tx, ninjaId as string)) throw new Error("VALIDATION:La panoplie d’un ninja inactif ou décédé ne peut plus être modifiée");
      const [ninja, previous] = await Promise.all([
        tx.ninjaProfile.findUnique({ where: { id: ninjaId as string }, select: { firstName: true, lastName: true } }),
        tx.ninjaEquipment.findUnique({ where: { ninjaId: ninjaId as string } })
      ]);
      if (!ninja) throw new Error("VALIDATION:Ninja introuvable");
      ninjaName = `${ninja.firstName} ${ninja.lastName}`;
      await tx.ninjaEquipment.upsert({ where: { ninjaId: ninjaId as string }, create: { ninjaId: ninjaId as string, slots, updatedById: session.userId }, update: { slots, updatedById: session.userId } });
      await writeAudit(tx, { actorId: session.userId, action: previous ? "EQUIPMENT_UPDATED" : "EQUIPMENT_CREATED", entityType: "NinjaEquipment", entityId: ninjaId as string, reason: `Panoplie de ${ninjaName}`, previousValues: previous?.slots ?? undefined, newValues: slots });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    throw error;
  }
  redirect(`/equipement?info=${encodeURIComponent(`Panoplie de ${ninjaName} enregistrée`)}`);
}
