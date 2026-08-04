"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@koeki/database";
import { awardPoints, isUniqueViolation, nextTransactionReceipt, writeAudit, type Tx } from "@/lib/finance";
import { hasPermission, requireWriteAccess } from "@/lib/session";

const QUANTITY_SCALE = 10_000n;
const toScaled = (quantity: number) => BigInt(Math.round(quantity * 10_000));

async function activePrice(tx: Tx, resourceId: string) {
  const price = await tx.resourcePriceHistory.findFirst({ where: { resourceId, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: "desc" } });
  return price?.pricePerUnit ?? null;
}

async function applyValidatedTransaction(tx: Tx, transaction: { id: string; type: "DONATION" | "BUYBACK"; ninjaId: string; receiptNumber: string; totalAmount: bigint; idempotencyKey: string }, items: Array<{ resourceId: string; quantity: number; unitPrice: bigint }>, actorId: string) {
  for (const item of items) await tx.inventoryMovement.create({ data: {
    resourceId: item.resourceId, type: transaction.type === "BUYBACK" ? "BUYBACK_IN" : "DONATION_IN", quantity: new Prisma.Decimal(item.quantity),
    unitCost: item.unitPrice, transactionId: transaction.id, agentId: actorId, justification: `Reçu ${transaction.receiptNumber}`, idempotencyKey: `${transaction.idempotencyKey}:${item.resourceId}`
  } });
  const points = await awardPoints(tx, { ninjaId: transaction.ninjaId, eventType: transaction.type === "BUYBACK" ? "RESOURCE_SALE" : "DONATION", amount: transaction.totalAmount, sourceType: "ResourceTransaction", sourceId: transaction.id });
  if (points > 0) await tx.resourceTransaction.update({ where: { id: transaction.id }, data: { totalPoints: points } });
}

const transactionSchema = z.object({
  type: z.enum(["DONATION", "BUYBACK"]),
  ninjaId: z.string().min(1, "Sélectionnez un ninja"),
  idempotencyKey: z.string().uuid()
});

export async function recordResourceTransaction(formData: FormData) {
  const session = await requireWriteAccess("inventory:write");
  const parsed = transactionSchema.safeParse({ type: formData.get("type"), ninjaId: formData.get("ninjaId"), idempotencyKey: formData.get("idempotencyKey") });
  const back = (message: string): never => redirect(`/resources/transaction?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const { type, ninjaId, idempotencyKey } = parsed.data!;
  const lines: Array<{ resourceId: string; quantity: number }> = [];
  for (let index = 1; index <= 5; index++) {
    const resourceId = formData.get(`resourceId_${index}`);
    const quantityRaw = formData.get(`quantity_${index}`);
    if (typeof resourceId === "string" && resourceId && typeof quantityRaw === "string" && quantityRaw) {
      const quantity = Number(quantityRaw.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) back(`Quantité invalide sur la ligne ${index}`);
      if (lines.some((line) => line.resourceId === resourceId)) back("Une même ressource apparaît deux fois");
      lines.push({ resourceId, quantity });
    }
  }
  if (!lines.length) back("Ajoutez au moins une ressource");
  const ninja = await prisma.ninjaProfile.findUnique({ where: { id: ninjaId } });
  if (!ninja) back("Ninja introuvable");
  let receipt = "";
  try {
    receipt = await prisma.$transaction(async (tx) => {
      const items: Array<{ resourceId: string; quantity: number; unitPrice: bigint; lineTotal: bigint }> = [];
      for (const line of lines) {
        const resource = await tx.resource.findUnique({ where: { id: line.resourceId } });
        if (!resource || !resource.isActive) throw new Error("VALIDATION:Ressource inconnue ou inactive");
        const price = await activePrice(tx, line.resourceId);
        if (type === "BUYBACK" && (price === null || price <= 0n)) throw new Error(`VALIDATION:Aucun prix actif pour ${resource.name} — configurez-le avant tout rachat`);
        const unitPrice = price ?? 0n;
        items.push({ resourceId: line.resourceId, quantity: line.quantity, unitPrice, lineTotal: (unitPrice * toScaled(line.quantity)) / QUANTITY_SCALE });
      }
      const totalAmount = items.reduce((total, item) => total + item.lineTotal, 0n);
      const approvalSetting = await tx.appSetting.findUnique({ where: { key: "approvalThreshold" } });
      const approval = approvalSetting?.value as { amount?: string; isValidated?: boolean } | undefined;
      const needsApproval = type === "BUYBACK" && approval?.isValidated === true && totalAmount > BigInt(approval.amount ?? "50000") && !hasPermission(session, "settings:manage");
      const receiptNumber = await nextTransactionReceipt(tx, type);
      const transaction = await tx.resourceTransaction.create({ data: {
        receiptNumber, type, status: needsApproval ? "PENDING_APPROVAL" : "VALIDATED", ninjaId, agentId: session.userId, totalAmount, idempotencyKey, validatedAt: needsApproval ? null : new Date()
      } });
      await tx.resourceTransactionItem.createMany({ data: items.map((item) => ({ transactionId: transaction.id, resourceId: item.resourceId, quantity: new Prisma.Decimal(item.quantity), unitPriceSnapshot: item.unitPrice, lineTotal: item.lineTotal })) });
      if (!needsApproval) await applyValidatedTransaction(tx, { id: transaction.id, type, ninjaId, receiptNumber, totalAmount, idempotencyKey }, items, session.userId);
      await writeAudit(tx, { actorId: session.userId, action: type === "BUYBACK" ? (needsApproval ? "BUYBACK_PENDING_APPROVAL" : "BUYBACK_RECORDED") : "DONATION_RECORDED", entityType: "ResourceTransaction", entityId: transaction.id, reason: `${type === "BUYBACK" ? "Rachat" : "Don"} ${receiptNumber} — ${Number(totalAmount)} Ryō`, newValues: { items: items.map((item) => ({ resourceId: item.resourceId, quantity: item.quantity, unitPrice: Number(item.unitPrice) })) } });
      return receiptNumber;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    if (isUniqueViolation(error)) back("Cette transaction a déjà été enregistrée (double soumission détectée)");
    throw error;
  }
  redirect(`/resources?recu=${encodeURIComponent(receipt)}`);
}

export async function approveTransaction(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const transactionId = formData.get("transactionId");
  if (typeof transactionId !== "string" || !transactionId) redirect("/resources");
  try {
    await prisma.$transaction(async (tx) => {
      const transaction = await tx.resourceTransaction.findUnique({ where: { id: transactionId }, include: { items: true } });
      if (!transaction || transaction.status !== "PENDING_APPROVAL") throw new Error("VALIDATION:Transaction déjà traitée");
      await tx.resourceTransaction.update({ where: { id: transactionId }, data: { status: "VALIDATED", validatedAt: new Date() } });
      await applyValidatedTransaction(tx, { id: transaction.id, type: transaction.type, ninjaId: transaction.ninjaId, receiptNumber: transaction.receiptNumber, totalAmount: transaction.totalAmount, idempotencyKey: transaction.idempotencyKey }, transaction.items.map((item) => ({ resourceId: item.resourceId, quantity: Number(item.quantity), unitPrice: item.unitPriceSnapshot })), transaction.agentId);
      await writeAudit(tx, { actorId: session.userId, action: "BUYBACK_APPROVED", entityType: "ResourceTransaction", entityId: transactionId, reason: `Validation managériale du reçu ${transaction.receiptNumber}` });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) redirect(`/resources?erreur=${encodeURIComponent(error.message.slice("VALIDATION:".length))}`);
    if (isUniqueViolation(error)) redirect("/resources?erreur=Mouvements%20d%C3%A9j%C3%A0%20appliqu%C3%A9s");
    throw error;
  }
  redirect("/resources");
}

const priceSchema = z.object({ resourceId: z.string().min(1), price: z.coerce.number().int().min(0, "Prix invalide"), reason: z.string().trim().min(3, "Un motif est obligatoire").max(300) });

export async function updatePrice(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = priceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/resources?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const { resourceId, price, reason } = parsed.data!;
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource) redirect("/resources?erreur=Ressource%20introuvable");
  await prisma.$transaction(async (tx) => {
    const previous = await activePrice(tx, resourceId);
    const now = new Date();
    await tx.resourcePriceHistory.updateMany({ where: { resourceId, effectiveTo: null }, data: { effectiveTo: now } });
    await tx.resourcePriceHistory.create({ data: { resourceId, pricePerUnit: BigInt(price), effectiveFrom: now, createdById: session.userId } });
    await writeAudit(tx, { actorId: session.userId, action: "PRICE_UPDATED", entityType: "Resource", entityId: resourceId, reason, previousValues: { pricePerUnit: previous === null ? null : Number(previous) }, newValues: { pricePerUnit: price } });
  });
  redirect("/resources");
}
