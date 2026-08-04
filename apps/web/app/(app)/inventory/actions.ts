"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@koeki/database";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { hasPermission, requireWriteAccess } from "@/lib/session";

const adjustmentSchema = z.object({
  resourceId: z.string().min(1, "Sélectionnez une ressource"),
  quantity: z.coerce.number().refine((value) => Number.isFinite(value) && value !== 0, "La quantité doit être non nulle"),
  justification: z.string().trim().min(3, "Une justification est obligatoire").max(300),
  allowNegative: z.literal("on").optional(),
  idempotencyKey: z.string().uuid()
});

export async function recordAdjustment(formData: FormData) {
  const session = await requireWriteAccess("inventory:write");
  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/inventory?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const { resourceId, quantity, justification, allowNegative, idempotencyKey } = parsed.data!;
  const overrideAllowed = allowNegative === "on" && hasPermission(session, "settings:manage");
  try {
    await prisma.$transaction(async (tx) => {
      const resource = await tx.resource.findUnique({ where: { id: resourceId } });
      if (!resource) throw new Error("VALIDATION:Ressource introuvable");
      const aggregate = await tx.inventoryMovement.aggregate({ where: { resourceId }, _sum: { quantity: true } });
      const nextStock = Number(aggregate._sum.quantity ?? 0) + quantity;
      if (nextStock < 0 && !overrideAllowed) throw new Error("VALIDATION:Le stock deviendrait négatif — autorisation managériale explicite requise");
      await tx.inventoryMovement.create({ data: { resourceId, type: "MANUAL_ADJUSTMENT", quantity: new Prisma.Decimal(quantity), agentId: session.userId, justification, idempotencyKey } });
      await writeAudit(tx, { actorId: session.userId, action: nextStock < 0 ? "INVENTORY_ADJUSTED_NEGATIVE" : "INVENTORY_ADJUSTED", entityType: "Resource", entityId: resourceId, reason: justification, newValues: { quantity, nextStock } });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    if (isUniqueViolation(error)) back("Ajustement déjà enregistré (double soumission détectée)");
    throw error;
  }
  redirect("/inventory");
}
