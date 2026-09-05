"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@koeki/database";
import { formatQuantityWithUnit, parseQuantityInput, type InventoryMovementTypeCode } from "@koeki/domain";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { recordMovement, reconcileInventory, resyncInventoryCache, reverseMovement } from "@/lib/inventory-ledger";
import type { ActionState } from "@/lib/inventory-types";
import { hasPermission, requireWriteAccess } from "@/lib/session";

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.trim() : "");

const movementSchema = z.object({
  resourceId: z.string().min(1, "Choisissez une ressource"),
  direction: z.enum(["in", "out"]),
  quantity: z.string().min(1, "Indiquez une quantité"),
  counterpartyMode: z.enum(["ninja", "external", "none"]).default("none"),
  ninjaId: z.string().optional(),
  counterpartyLabel: z.string().max(120).optional(),
  reason: z.string().max(80).optional(),
  reasonOther: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  allowNegative: z.literal("on").optional(),
  idempotencyKey: z.string().uuid("Rechargez la page et réessayez")
});

/** Manual type from the direction and the chosen reason (transfers, losses and returns keep their own type). */
function manualType(direction: "in" | "out", reason: string): InventoryMovementTypeCode {
  const key = reason.toLowerCase();
  if (direction === "in") return key === "retour" ? "RETURN_IN" : key === "transfert" ? "TRANSFER_IN" : "IN";
  return key === "perte" ? "LOSS" : key === "transfert" ? "TRANSFER_OUT" : "OUT";
}

function revalidateInventory(resourceId?: string) {
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  if (resourceId) revalidatePath(`/inventory/${resourceId}`);
  revalidatePath("/resources");
}

function failure(error: unknown): ActionState {
  if (error instanceof Error && error.message.startsWith("VALIDATION:")) return { ok: false, error: error.message.slice("VALIDATION:".length) };
  if (isUniqueViolation(error)) return { ok: false, error: "Ce mouvement a déjà été enregistré (double soumission détectée)" };
  if (error instanceof Error && (error.message === "FORBIDDEN" || error.message === "UNAUTHENTICATED")) return { ok: false, error: "Accès refusé" };
  if (error instanceof Error && error.message.startsWith("Mode démonstration")) return { ok: false, error: error.message };
  throw error;
}

/** Entry or exit recorded from the register (row buttons or the global "Nouveau mouvement"). */
export async function recordManualMovement(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireWriteAccess("inventory:write");
    const parsed = movementSchema.safeParse({
      resourceId: text(formData.get("resourceId")), direction: text(formData.get("direction")), quantity: text(formData.get("quantity")),
      counterpartyMode: text(formData.get("counterpartyMode")) || "none", ninjaId: text(formData.get("ninjaId")), counterpartyLabel: text(formData.get("counterpartyLabel")),
      reason: text(formData.get("reason")), reasonOther: text(formData.get("reasonOther")), notes: text(formData.get("notes")),
      allowNegative: formData.get("allowNegative") === "on" ? "on" : undefined, idempotencyKey: text(formData.get("idempotencyKey"))
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
    const input = parsed.data;
    const resource = await prisma.resource.findUnique({ where: { id: input.resourceId }, include: { unit: true, category: true } });
    if (!resource) return { ok: false, error: "Ressource introuvable" };
    const quantity = parseQuantityInput(input.quantity, resource.unit.decimals, resource.unit.label);
    if (!quantity.ok) return { ok: false, error: quantity.error };
    if (quantity.value <= 0) return { ok: false, error: "La quantité doit être supérieure à zéro" };
    const reason = (input.reason && input.reason !== "Autre" ? input.reason : input.reasonOther ?? "").trim();
    if (reason.length < 2) return { ok: false, error: input.direction === "out" ? "Indiquez le motif de la sortie" : "Indiquez le motif de l’entrée" };
    const counterparty = input.counterpartyMode === "ninja"
      ? (input.ninjaId ? { type: "NINJA" as const, ninjaId: input.ninjaId } : null)
      : input.counterpartyMode === "external" ? (input.counterpartyLabel ? { type: "EXTERNAL" as const, label: input.counterpartyLabel } : null) : null;
    if (input.direction === "out" && !counterparty) return { ok: false, error: "Indiquez qui a pris la ressource (ninja ou personne externe)" };
    if (input.counterpartyMode === "ninja" && !counterparty) return { ok: false, error: "Choisissez un ninja dans la liste" };
    const allowNegative = input.allowNegative === "on" && hasPermission(session, "inventory:adjust");
    if (input.allowNegative === "on" && !allowNegative) return { ok: false, error: "Seul un responsable peut autoriser un stock négatif" };
    if (allowNegative && !input.notes?.trim()) return { ok: false, error: "Un stock négatif exige une justification dans la note" };
    const signed = input.direction === "out" ? -quantity.value : quantity.value;
    const type = manualType(input.direction, reason);
    const recorded = await prisma.$transaction(async (tx) => {
      const movement = await recordMovement(tx, { resourceId: resource.id, type, quantity: signed, agentId: session.userId, reason, notes: input.notes, counterparty, idempotencyKey: input.idempotencyKey, allowNegative });
      await writeAudit(tx, {
        actorId: session.userId, action: input.direction === "out" ? (movement.after.isNegative() ? "INVENTORY_OUT_NEGATIVE" : "INVENTORY_OUT") : "INVENTORY_IN", entityType: "InventoryMovement", entityId: movement.id,
        reason: `${resource.name} ${signed > 0 ? "+" : ""}${quantity.value} ${resource.unit.label} — ${reason}${counterparty ? ` (${counterparty.type === "NINJA" ? "ninja" : "externe"})` : ""}`,
        newValues: { resourceId: resource.id, type, quantity: signed, before: Number(movement.before), after: Number(movement.after) }
      });
      return movement;
    });
    revalidateInventory(resource.id);
    const label = formatQuantityWithUnit(quantity.value, resource.unit);
    return { ok: true, message: `${resource.name} : ${input.direction === "out" ? "−" : "+"}${label} enregistré${input.direction === "out" ? "e" : "e"} — nouveau stock ${formatQuantityWithUnit(Number(recorded.after), resource.unit)}` };
  } catch (error) { return failure(error); }
}

const adjustmentSchema = z.object({
  resourceId: z.string().min(1, "Choisissez une ressource"),
  quantity: z.string().min(1, "Indiquez une quantité"),
  sign: z.enum(["+", "-"]),
  reason: z.string().trim().min(3, "Une justification est obligatoire").max(300),
  notes: z.string().max(1000).optional(),
  allowNegative: z.literal("on").optional(),
  idempotencyKey: z.string().uuid("Rechargez la page et réessayez")
});

/** Manager adjustment outside a count (e.g. breakage found on the shelf). Signed, justified, audited. */
export async function recordAdjustment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireWriteAccess("inventory:adjust");
    const parsed = adjustmentSchema.safeParse({ resourceId: text(formData.get("resourceId")), quantity: text(formData.get("quantity")), sign: text(formData.get("sign")) || "+", reason: text(formData.get("reason")), notes: text(formData.get("notes")), allowNegative: formData.get("allowNegative") === "on" ? "on" : undefined, idempotencyKey: text(formData.get("idempotencyKey")) });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
    const input = parsed.data;
    const resource = await prisma.resource.findUnique({ where: { id: input.resourceId }, include: { unit: true } });
    if (!resource) return { ok: false, error: "Ressource introuvable" };
    const quantity = parseQuantityInput(input.quantity, resource.unit.decimals, resource.unit.label);
    if (!quantity.ok) return { ok: false, error: quantity.error };
    if (quantity.value <= 0) return { ok: false, error: "La quantité doit être supérieure à zéro" };
    const signed = input.sign === "-" ? -quantity.value : quantity.value;
    const movement = await prisma.$transaction(async (tx) => {
      const recorded = await recordMovement(tx, { resourceId: resource.id, type: signed < 0 ? "ADJUSTMENT_OUT" : "ADJUSTMENT_IN", quantity: signed, agentId: session.userId, reason: input.reason, notes: input.notes, idempotencyKey: input.idempotencyKey, allowNegative: input.allowNegative === "on" });
      await writeAudit(tx, { actorId: session.userId, action: recorded.after.isNegative() ? "INVENTORY_ADJUSTED_NEGATIVE" : "INVENTORY_ADJUSTED", entityType: "InventoryMovement", entityId: recorded.id, reason: `${resource.name} ${signed > 0 ? "+" : ""}${signed} ${resource.unit.label} — ${input.reason}`, newValues: { resourceId: resource.id, quantity: signed, before: Number(recorded.before), after: Number(recorded.after) } });
      return recorded;
    });
    revalidateInventory(resource.id);
    return { ok: true, message: `Ajustement enregistré — ${resource.name} : ${formatQuantityWithUnit(Number(movement.after), resource.unit)}` };
  } catch (error) { return failure(error); }
}

const reversalSchema = z.object({ movementId: z.string().min(1), reason: z.string().trim().min(3, "Indiquez pourquoi ce mouvement est annulé").max(300), allowNegative: z.literal("on").optional(), idempotencyKey: z.string().uuid("Rechargez la page et réessayez") });

/** Correction by reversal: the original line stays, an opposite line references it. */
export async function reverseMovementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireWriteAccess("inventory:adjust");
    const parsed = reversalSchema.safeParse({ movementId: text(formData.get("movementId")), reason: text(formData.get("reason")), allowNegative: formData.get("allowNegative") === "on" ? "on" : undefined, idempotencyKey: text(formData.get("idempotencyKey")) });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
    const input = parsed.data;
    const reversed = await prisma.$transaction(async (tx) => {
      const recorded = await reverseMovement(tx, { movementId: input.movementId, agentId: session.userId, reason: input.reason, idempotencyKey: input.idempotencyKey, allowNegative: input.allowNegative === "on" });
      await writeAudit(tx, { actorId: session.userId, action: "INVENTORY_REVERSED", entityType: "InventoryMovement", entityId: recorded.originalId, reason: input.reason, newValues: { reversalId: recorded.id, quantity: Number(recorded.quantity), before: Number(recorded.before), after: Number(recorded.after) } });
      return recorded;
    });
    const resource = await prisma.inventoryMovement.findUnique({ where: { id: reversed.id }, select: { resourceId: true } });
    revalidateInventory(resource?.resourceId);
    return { ok: true, message: `Mouvement annulé — ${reversed.resourceName} : ${formatQuantityWithUnit(Number(reversed.after), { label: reversed.unitLabel, decimals: reversed.unitDecimals })}` };
  } catch (error) { return failure(error); }
}

/** Explicit resynchronisation of the stock cache from the ledger (never automatic). */
export async function resyncInventory() {
  const session = await requireWriteAccess("inventory:adjust");
  const mismatches = await reconcileInventory(prisma);
  if (mismatches.length) {
    await prisma.$transaction(async (tx) => {
      const fixed = await resyncInventoryCache(tx, mismatches.map((row) => row.resourceId));
      await writeAudit(tx, { actorId: session.userId, action: "INVENTORY_RECONCILED", entityType: "Resource", entityId: "ledger", reason: `${fixed} cache(s) de stock réaligné(s) sur le ledger`, previousValues: mismatches.map((row) => ({ code: row.code, cache: Number(row.cache), ledger: Number(row.ledger) })) });
    });
  }
  revalidateInventory();
  redirect(`/inventory?info=${encodeURIComponent(mismatches.length ? `${mismatches.length} écart(s) réconcilié(s) — le stock affiché suit à nouveau le ledger` : "Inventaire cohérent : aucun écart entre le ledger et le stock affiché")}`);
}
