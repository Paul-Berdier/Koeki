"use server";

import type { EquipmentSaveResult } from "@/lib/equipment";
import { prisma } from "@koeki/database";
import { lockActiveNinja, writeAudit } from "@/lib/finance";
import { requireWriteAccess } from "@/lib/session";

const EQUIPMENT_SLOTS = ["haut", "bas", "bottes", "boucles", "bague", "collier", "gants"] as const;
const TIERS = ["Aucun", "T1", "T2", "T3", "T4"];
const TYPES = ["", "Armure", "Jutsu", "Ténacité"];

/** Replaces a Jonin's full loadout — one JSON row per ninja, audited. */
export async function updateEquipment(formData: FormData): Promise<EquipmentSaveResult> {
  const session = await requireWriteAccess("inventory:write");

  const ninjaId = formData.get("ninjaId");
  if (typeof ninjaId !== "string" || !ninjaId) return { ok: false, error: "Sélectionnez un ninja" };
  const slots: Record<string, { tier: string; type: string | null }> = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const tier = formData.get(`slot_${slot}_tier`);
    const type = formData.get(`slot_${slot}_type`);
    if (typeof tier !== "string" || !TIERS.includes(tier)) return { ok: false, error: `Tier invalide pour ${slot}` };
    if (typeof type !== "string" || !TYPES.includes(type)) return { ok: false, error: `Type invalide pour ${slot}` };
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
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) return { ok: false, error: error.message.slice("VALIDATION:".length) };
    throw error;
  }
  return { ok: true, ninjaId: ninjaId as string, slots, message: `Panoplie de ${ninjaName} enregistrée` };
}
