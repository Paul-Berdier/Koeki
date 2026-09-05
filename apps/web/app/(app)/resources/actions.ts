"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@koeki/database";
import { suggestResourceCode } from "@koeki/domain";
import { activePrice, applyValidatedTransaction, isUniqueViolation, lockActiveNinja, lockResources, nextTransactionReceipt, parseFourDecimal, scaledTimes, withReceiptRetry, writeAudit } from "@/lib/finance";
import { hasPermission, requireWriteAccess } from "@/lib/session";

const MAX_UNIT_PRICE = 100_000_000;
/** Treasury resources (Ryōs) are money, not goods: they never enter a don or a rachat. */
const TREASURY_CATEGORY_CODE = "TREASURY";
const canApproveBuybacks = (roles: readonly string[]) => roles.some((role) => role === "SUPER_ADMIN" || role === "KOEKI_MANAGER");

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
  const lines: Array<{ resourceId: string; quantity: number; negotiated: bigint | null }> = [];
  for (let index = 1; index <= 8; index++) {
    const resourceId = formData.get(`resourceId_${index}`);
    const quantityRaw = formData.get(`quantity_${index}`);
    if (typeof resourceId === "string" && resourceId && typeof quantityRaw === "string" && quantityRaw) {
      const quantity = parseFourDecimal(quantityRaw) ?? back(`Quantité invalide sur la ligne ${index} (4 décimales maximum)`);
      if (quantity <= 0 || quantity > 1_000_000) back(`Quantité invalide sur la ligne ${index} (entre 0,0001 et 1 000 000)`);
      if (lines.some((line) => line.resourceId === resourceId)) back("Une même ressource apparaît deux fois");
      // Buyback price is negotiable downwards: the agent may enter a unit price below the catalog maximum.
      let negotiated: bigint | null = null;
      const priceRaw = formData.get(`unitPrice_${index}`);
      if (type === "BUYBACK" && typeof priceRaw === "string" && priceRaw !== "") {
        const price = Number(priceRaw);
        if (!Number.isSafeInteger(price) || price < 1 || price > MAX_UNIT_PRICE) back(`Prix négocié invalide sur la ligne ${index} (entier en Ryō, de 1 à ${MAX_UNIT_PRICE.toLocaleString("fr-FR")})`);
        negotiated = BigInt(price);
      }
      lines.push({ resourceId, quantity, negotiated });
    }
  }
  if (!lines.length) back("Ajoutez au moins une ressource — tapez son nom puis choisissez une proposition de la liste");
  let receipt = "";
  try {
    receipt = await withReceiptRetry(() => prisma.$transaction(async (tx) => {
      if (!await lockActiveNinja(tx, ninjaId)) throw new Error("VALIDATION:Ninja introuvable ou dossier inactif");
      const items: Array<{ resourceId: string; quantity: number; unitPrice: bigint; lineTotal: bigint; exemptionPerUnit: bigint; pointsPerUnit: number }> = [];
      for (const line of lines) {
        const resource = await tx.resource.findUnique({ where: { id: line.resourceId }, include: { category: true, unit: true } });
        if (!resource || !resource.isActive) throw new Error("VALIDATION:Ressource inconnue ou inactive");
        if (resource.category.code === TREASURY_CATEGORY_CODE) throw new Error(`VALIDATION:${resource.name} est de la trésorerie, pas une ressource à donner ou racheter`);
        if (resource.unit.decimals === 0 && !Number.isInteger(line.quantity)) throw new Error(`VALIDATION:${resource.name} se compte en ${resource.unit.label}s entières`);
        const price = await activePrice(tx, line.resourceId);
        if (type === "BUYBACK" && (price === null || price <= 0n)) throw new Error(`VALIDATION:Aucun prix actif pour ${resource.name} — configurez-le avant tout rachat`);
        if (type === "BUYBACK" && line.negotiated !== null && price !== null && line.negotiated > price) throw new Error(`VALIDATION:Prix négocié au-dessus du catalogue pour ${resource.name} (maximum ${Number(price).toLocaleString("fr-FR")} ¥/u)`);
        const unitPrice = type === "BUYBACK" && line.negotiated !== null ? line.negotiated : price ?? 0n;
        items.push({ resourceId: line.resourceId, quantity: line.quantity, unitPrice, lineTotal: scaledTimes(line.quantity, unitPrice), exemptionPerUnit: resource.exemptionPerUnit, pointsPerUnit: resource.pointsPerUnit });
      }
      const totalAmount = items.reduce((total, item) => total + item.lineTotal, 0n);
      const approvalSetting = await tx.appSetting.findUnique({ where: { key: "approvalThreshold" } });
      const approval = approvalSetting?.value as { amount?: string; isValidated?: boolean } | undefined;
      const needsApproval = type === "BUYBACK" && approval?.isValidated === true && totalAmount > BigInt(approval.amount ?? "50000") && !canApproveBuybacks(session.roles);
      const receiptNumber = await nextTransactionReceipt(tx, type);
      const transaction = await tx.resourceTransaction.create({ data: {
        receiptNumber, type, status: needsApproval ? "PENDING_APPROVAL" : "VALIDATED", ninjaId, agentId: session.userId, totalAmount, idempotencyKey, validatedAt: needsApproval ? null : new Date()
      } });
      await tx.resourceTransactionItem.createMany({ data: items.map((item) => ({ transactionId: transaction.id, resourceId: item.resourceId, quantity: new Prisma.Decimal(item.quantity), unitPriceSnapshot: item.unitPrice, lineTotal: item.lineTotal })) });
      if (!needsApproval) await applyValidatedTransaction(tx, { id: transaction.id, type, ninjaId, receiptNumber, totalAmount, idempotencyKey }, items, session.userId);
      await writeAudit(tx, { actorId: session.userId, action: type === "BUYBACK" ? (needsApproval ? "BUYBACK_PENDING_APPROVAL" : "BUYBACK_RECORDED") : "DONATION_RECORDED", entityType: "ResourceTransaction", entityId: transaction.id, reason: `${type === "BUYBACK" ? "Rachat" : "Don"} ${receiptNumber} — ${Number(totalAmount)} Ryō`, newValues: { items: items.map((item) => ({ resourceId: item.resourceId, quantity: item.quantity, unitPrice: Number(item.unitPrice) })) } });
      return receiptNumber;
    }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    if (isUniqueViolation(error)) back("Cette transaction a déjà été enregistrée (double soumission détectée)");
    throw error;
  }
  redirect(`/resources?recu=${encodeURIComponent(receipt)}`);
}

export async function approveTransaction(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  if (!canApproveBuybacks(session.roles)) redirect("/resources?erreur=Validation%20r%C3%A9serv%C3%A9e%20aux%20responsables");
  const transactionId = formData.get("transactionId");
  if (typeof transactionId !== "string" || !transactionId) redirect("/resources");
  try {
    await prisma.$transaction(async (tx) => {
      const transaction = await tx.resourceTransaction.findUnique({ where: { id: transactionId }, include: { items: { include: { resource: { select: { exemptionPerUnit: true, pointsPerUnit: true, isActive: true } } } } } });
      if (!transaction || transaction.type !== "BUYBACK" || transaction.status !== "PENDING_APPROVAL") throw new Error("VALIDATION:Rachat déjà traité ou introuvable");
      if (!await lockActiveNinja(tx, transaction.ninjaId)) throw new Error("VALIDATION:Le dossier ninja n’est plus actif");
      if (transaction.items.some((item) => !item.resource.isActive)) throw new Error("VALIDATION:Une ressource du rachat est devenue inactive");
      const approved = await tx.resourceTransaction.updateMany({
        where: { id: transactionId, type: "BUYBACK", status: "PENDING_APPROVAL" },
        data: { status: "VALIDATED", validatedAt: new Date() }
      });
      if (approved.count !== 1) throw new Error("VALIDATION:Rachat déjà traité");
      await applyValidatedTransaction(tx, { id: transaction.id, type: transaction.type, ninjaId: transaction.ninjaId, receiptNumber: transaction.receiptNumber, totalAmount: transaction.totalAmount, idempotencyKey: transaction.idempotencyKey }, transaction.items.map((item) => ({ resourceId: item.resourceId, quantity: Number(item.quantity), unitPrice: item.unitPriceSnapshot, exemptionPerUnit: item.resource.exemptionPerUnit, pointsPerUnit: item.resource.pointsPerUnit })), transaction.agentId);
      await writeAudit(tx, { actorId: session.userId, action: "BUYBACK_APPROVED", entityType: "ResourceTransaction", entityId: transactionId, reason: `Validation managériale du reçu ${transaction.receiptNumber}` });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) redirect(`/resources?erreur=${encodeURIComponent(error.message.slice("VALIDATION:".length))}`);
    if (isUniqueViolation(error)) redirect("/resources?erreur=Mouvements%20d%C3%A9j%C3%A0%20appliqu%C3%A9s");
    throw error;
  }
  redirect("/resources");
}

const stockLevelSchema = z.preprocess(
  (value) => value === undefined || value === null || value === "" ? "0" : typeof value === "number" ? String(value) : value,
  z.string().trim()
    .refine((value) => parseFourDecimal(value) !== null, "Quantité invalide (4 décimales maximum)")
    .transform((value) => parseFourDecimal(value)!)
    .pipe(z.number().min(0).max(1_000_000_000))
);

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const parseAliases = (raw: string | undefined) => [...new Set((raw ?? "").split(/[,;\n]/).map((alias) => alias.trim()).filter(Boolean))].slice(0, 12);

const resourceSchema = z.object({
  name: z.string().trim().min(2, "Le nom est obligatoire").max(120),
  code: z.string().trim().max(40).optional().transform((value) => (value ?? "").toUpperCase()),
  categoryId: z.string().min(1, "La catégorie est obligatoire"),
  unitId: z.string().min(1, "L’unité est obligatoire"),
  aliases: z.string().max(400).optional(),
  description: z.string().trim().max(500).optional().transform((value) => value || null),
  minimumStock: stockLevelSchema,
  criticalStock: stockLevelSchema,
  demand: z.enum(["NONE", "NEEDED", "CRITICAL"]).default("NONE"),
  pointsPerUnit: z.coerce.number().int("Points invalides (entier)").min(0).max(1_000_000).default(0),
  exemptionPerUnit: z.coerce.number().int("Exonération invalide (entier en Ryō)").min(0).max(100_000_000_000).default(0)
});

/** Managers create resources with a stable code (suggested from the name, editable). No quantity here:
 *  the opening stock always comes from a counted INITIAL_BALANCE. */
export async function createResource(formData: FormData) {
  const session = await requireWriteAccess("inventory:catalog");
  const back = (message: string): never => redirect(`/resources/new?erreur=${encodeURIComponent(message)}`);
  const parsed = resourceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const priceRaw = formData.get("price");
  const price = typeof priceRaw === "string" && priceRaw !== "" ? Number(priceRaw) : null;
  if (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > MAX_UNIT_PRICE)) back(`Prix invalide (entier en Ryō, maximum ${MAX_UNIT_PRICE.toLocaleString("fr-FR")})`);
  const data = parsed.data!;
  // Value scales (prix, points, exonération, besoin du village) belong to settings:manage — a
  // catalog manager without it creates the resource with neutral values.
  const canScale = hasPermission(session, "settings:manage");
  if (!canScale) { data.pointsPerUnit = 0; data.exemptionPerUnit = 0; data.demand = "NONE"; }
  if (price !== null && !canScale) back("Le prix relève des responsables (settings:manage)");
  if (data.criticalStock > data.minimumStock) back("Le seuil critique doit être inférieur ou égal au seuil bas");
  if (data.code && !CODE_PATTERN.test(data.code)) back("Code invalide : 3 à 40 caractères, majuscules, chiffres et tirets (ex. RES-IRON)");
  const [unit, existingByName] = await Promise.all([prisma.resourceUnit.findUnique({ where: { id: data.unitId } }), prisma.resource.findFirst({ where: { name: { equals: data.name, mode: "insensitive" } }, select: { code: true } })]);
  if (!unit) back("Unité inconnue");
  if (existingByName) back(`Une ressource « ${data.name} » existe déjà (${existingByName.code}) — utilisez des alias plutôt qu’un doublon`);
  if ((data.minimumStock % 1 !== 0 || data.criticalStock % 1 !== 0) && unit!.decimals === 0) back(`Les seuils se saisissent en ${unit!.label}s entières`);
  const base = data.code || suggestResourceCode(data.name);
  let created = false;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const code = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      await prisma.$transaction(async (tx) => {
        const resource = await tx.resource.create({ data: { code, name: data.name, categoryId: data.categoryId, unitId: data.unitId, description: data.description, demand: data.demand, minimumStock: new Prisma.Decimal(data.minimumStock), criticalStock: new Prisma.Decimal(data.criticalStock), pointsPerUnit: data.pointsPerUnit, exemptionPerUnit: BigInt(data.exemptionPerUnit) } });
        const aliases = parseAliases(data.aliases);
        if (aliases.length) await tx.resourceAlias.createMany({ data: aliases.map((alias) => ({ resourceId: resource.id, alias })), skipDuplicates: true });
        if (price !== null && price > 0) await tx.resourcePriceHistory.create({ data: { resourceId: resource.id, pricePerUnit: BigInt(price), effectiveFrom: new Date(), createdById: session.userId } });
        await writeAudit(tx, { actorId: session.userId, action: "RESOURCE_CREATED", entityType: "Resource", entityId: resource.id, newValues: { code, name: data.name, unit: unit!.code, price, pointsPerUnit: data.pointsPerUnit, exemptionPerUnit: data.exemptionPerUnit, minimumStock: data.minimumStock, criticalStock: data.criticalStock, aliases } });
      });
      created = true;
    } catch (error) { if (!isUniqueViolation(error)) throw error; if (data.code) back(`Le code ${data.code} est déjà utilisé`); }
  }
  if (!created) back("Conflit de code, réessayez");
  redirect("/inventory?info=" + encodeURIComponent(`Ressource « ${data.name} » créée — son stock sera fixé par le premier comptage`));
}

const updateResourceSchema = resourceSchema.extend({
  resourceId: z.string().min(1),
  isActive: z.literal("on").optional(),
  price: z.preprocess((value) => (value === null || value === "" ? undefined : value), z.coerce.number().int("Prix invalide (entier en Ryō)").min(0, "Prix invalide").max(MAX_UNIT_PRICE, `Prix maximum : ${MAX_UNIT_PRICE.toLocaleString("fr-FR")} Ryō`).optional()),
  priceReason: z.string().trim().max(300).optional()
});

export async function updateResource(formData: FormData) {
  const session = await requireWriteAccess("inventory:catalog");
  const parsed = updateResourceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/resources?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const { resourceId, isActive, price, priceReason, ...data } = parsed.data!;
  const back = (message: string): never => redirect(`/resources/${resourceId}/modifier?erreur=${encodeURIComponent(message)}`);
  if (data.criticalStock > data.minimumStock) back("Le seuil critique doit être inférieur ou égal au seuil bas");
  if (data.code && !CODE_PATTERN.test(data.code)) back("Code invalide : 3 à 40 caractères, majuscules, chiffres et tirets (ex. RES-IRON)");
  const previous = await prisma.resource.findUnique({ where: { id: resourceId }, include: { unit: true, aliases: true, _count: { select: { movements: true } } } });
  if (!previous) redirect("/resources?erreur=Ressource%20introuvable");
  const unit = await prisma.resourceUnit.findUnique({ where: { id: data.unitId } });
  if (!unit) back("Unité inconnue");
  // V1 rule: one reference unit per resource — it is frozen once the ledger holds lines.
  if (previous!.unitId !== data.unitId && previous!._count.movements > 0) back(`L’unité de ${previous!.name} est verrouillée par son historique (${previous!._count.movements} mouvement${previous!._count.movements > 1 ? "s" : ""}) — créez une nouvelle ressource pour changer d’unité`);
  const code = data.code || previous!.code;
  const aliases = parseAliases(data.aliases);
  // Without settings:manage the value scales are kept exactly as they were.
  const canScale = hasPermission(session, "settings:manage");
  if (!canScale) { data.pointsPerUnit = previous!.pointsPerUnit; data.exemptionPerUnit = Number(previous!.exemptionPerUnit); data.demand = previous!.demand === "NEEDED" || previous!.demand === "CRITICAL" ? previous!.demand : "NONE"; }
  const thresholdsChanged = Number(previous!.minimumStock) !== data.minimumStock || Number(previous!.criticalStock) !== data.criticalStock;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.resource.update({ where: { id: resourceId }, data: { code, name: data.name, categoryId: data.categoryId, unitId: data.unitId, description: data.description, demand: data.demand, minimumStock: new Prisma.Decimal(data.minimumStock), criticalStock: new Prisma.Decimal(data.criticalStock), pointsPerUnit: data.pointsPerUnit, exemptionPerUnit: BigInt(data.exemptionPerUnit), isActive: isActive === "on" } });
      // Aliases are replaced as a set; a renamed code stays searchable through its old value.
      const nextAliases = [...new Set([...aliases, ...(code !== previous!.code ? [previous!.code] : [])])];
      await tx.resourceAlias.deleteMany({ where: { resourceId, alias: { notIn: nextAliases } } });
      if (nextAliases.length) await tx.resourceAlias.createMany({ data: nextAliases.map((alias) => ({ resourceId, alias })), skipDuplicates: true });
      await writeAudit(tx, { actorId: session.userId, action: previous!.isActive && isActive !== "on" ? "RESOURCE_DEACTIVATED" : !previous!.isActive && isActive === "on" ? "RESOURCE_REACTIVATED" : thresholdsChanged ? "RESOURCE_THRESHOLDS_UPDATED" : "RESOURCE_UPDATED", entityType: "Resource", entityId: resourceId,
        previousValues: { code: previous!.code, name: previous!.name, unit: previous!.unit.code, minimumStock: Number(previous!.minimumStock), criticalStock: Number(previous!.criticalStock), pointsPerUnit: previous!.pointsPerUnit, exemptionPerUnit: Number(previous!.exemptionPerUnit), isActive: previous!.isActive, aliases: previous!.aliases.map((alias) => alias.alias) },
        newValues: { code, name: data.name, unit: unit!.code, minimumStock: data.minimumStock, criticalStock: data.criticalStock, pointsPerUnit: data.pointsPerUnit, exemptionPerUnit: data.exemptionPerUnit, isActive: isActive === "on", aliases: nextAliases } });
      if (price !== undefined) {
        if (!canScale) throw new Error("VALIDATION:Le prix relève des responsables (settings:manage)");
        const current = await activePrice(tx, resourceId);
        const changed = current === null ? price > 0 : BigInt(price) !== current;
        if (changed) {
          if (!priceReason || priceReason.length < 3) throw new Error("VALIDATION:Un motif d’au moins 3 caractères est obligatoire pour changer le prix");
          const now = new Date();
          await tx.resourcePriceHistory.updateMany({ where: { resourceId, effectiveTo: null }, data: { effectiveTo: now } });
          await tx.resourcePriceHistory.create({ data: { resourceId, pricePerUnit: BigInt(price), effectiveFrom: now, createdById: session.userId } });
          await writeAudit(tx, { actorId: session.userId, action: "PRICE_UPDATED", entityType: "Resource", entityId: resourceId, reason: priceReason, previousValues: { pricePerUnit: current === null ? null : Number(current) }, newValues: { pricePerUnit: price } });
        }
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    if (isUniqueViolation(error)) back(`Le code ${code} est déjà utilisé par une autre ressource`);
    throw error;
  }
  redirect(`/inventory/${resourceId}?info=${encodeURIComponent("Fiche mise à jour")}`);
}

/** Hard-deletes only unused resources; anything referenced by movements, prices, transactions, recipes or counts is deactivated. */
export async function deleteResource(formData: FormData) {
  const session = await requireWriteAccess("inventory:catalog");
  const resourceId = formData.get("resourceId");
  if (typeof resourceId !== "string" || !resourceId || formData.get("confirm") !== "on") redirect("/resources?erreur=Confirmation%20requise");
  const resource = await prisma.resource.findUnique({ where: { id: resourceId as string }, include: { _count: { select: { movements: true, prices: true, transactionItems: true, recipeIngredients: true, recipeOutputs: true, stocktakeEntries: true } } } });
  if (!resource) redirect("/resources?erreur=Ressource%20introuvable");
  const counts = resource!._count;
  const inUse = counts.movements + counts.prices + counts.transactionItems + counts.recipeIngredients + counts.recipeOutputs + counts.stocktakeEntries > 0;
  await prisma.$transaction(async (tx) => {
    if (inUse) {
      await tx.resource.update({ where: { id: resourceId as string }, data: { isActive: false } });
      await writeAudit(tx, { actorId: session.userId, action: "RESOURCE_DEACTIVATED", entityType: "Resource", entityId: resourceId as string, reason: "Historique présent : désactivation au lieu d’une suppression" });
    } else {
      await tx.resource.delete({ where: { id: resourceId as string } });
      await writeAudit(tx, { actorId: session.userId, action: "RESOURCE_DELETED", entityType: "Resource", entityId: resourceId as string, newValues: { code: resource!.code } });
    }
  });
  redirect("/resources");
}

const priceSchema = z.object({
  resourceId: z.string().min(1),
  price: z.coerce.number().int().min(0, "Prix invalide").max(MAX_UNIT_PRICE, `Prix maximum : ${MAX_UNIT_PRICE.toLocaleString("fr-FR")} Ryō`),
  reason: z.string().trim().min(3, "Un motif est obligatoire").max(300)
});

export async function updatePrice(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = priceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/resources?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const { resourceId, price, reason } = parsed.data!;
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await lockResources(tx, [resourceId]);
      if (!locked.has(resourceId)) throw new Error("VALIDATION:Ressource introuvable");
      const previous = await activePrice(tx, resourceId);
      const now = new Date();
      await tx.resourcePriceHistory.updateMany({ where: { resourceId, effectiveTo: null }, data: { effectiveTo: now } });
      await tx.resourcePriceHistory.create({ data: { resourceId, pricePerUnit: BigInt(price), effectiveFrom: now, createdById: session.userId } });
      await writeAudit(tx, { actorId: session.userId, action: "PRICE_UPDATED", entityType: "Resource", entityId: resourceId, reason, previousValues: { pricePerUnit: previous === null ? null : Number(previous) }, newValues: { pricePerUnit: price } });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) redirect(`/resources?erreur=${encodeURIComponent(error.message.slice("VALIDATION:".length))}`);
    if (isUniqueViolation(error)) redirect("/resources?erreur=Un%20autre%20prix%20vient%20d%E2%80%99%C3%AAtre%20enregistr%C3%A9");
    throw error;
  }
  redirect("/resources");
}

const categorySchema = z.object({ label: z.string().trim().min(2, "Le libellé est obligatoire").max(60), code: z.string().trim().max(30).optional().transform((value) => (value ?? "").toUpperCase()) });

/** Catalog referential: categories are configurable, never hard-coded in the interface. */
export async function createCategory(formData: FormData) {
  const session = await requireWriteAccess("inventory:catalog");
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/resources?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const { label } = parsed.data!;
  const code = parsed.data!.code || suggestResourceCode(label).replace(/^RES-/, "").slice(0, 30);
  if (!/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(code)) back("Code de catégorie invalide (majuscules, chiffres, tirets)");
  try {
    await prisma.$transaction(async (tx) => {
      const last = await tx.resourceCategory.aggregate({ _max: { sortOrder: true } });
      const category = await tx.resourceCategory.create({ data: { code, label, sortOrder: Math.min(899, (last._max.sortOrder ?? 0) + 10) } });
      await writeAudit(tx, { actorId: session.userId, action: "CATEGORY_CREATED", entityType: "ResourceCategory", entityId: category.id, newValues: { code, label } });
    });
  } catch (error) { if (isUniqueViolation(error)) back(`La catégorie ${code} existe déjà`); throw error; }
  redirect(`/resources?info=${encodeURIComponent(`Catégorie « ${label} » créée`)}`);
}

const unitSchema = z.object({ label: z.string().trim().min(1, "Le libellé est obligatoire").max(20), code: z.string().trim().max(20).optional().transform((value) => (value ?? "").toUpperCase()), decimals: z.coerce.number().int().min(0).max(4).default(0) });

export async function createUnit(formData: FormData) {
  const session = await requireWriteAccess("inventory:catalog");
  const parsed = unitSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/resources?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const { label, decimals } = parsed.data!;
  const code = parsed.data!.code || suggestResourceCode(label).replace(/^RES-/, "").slice(0, 20);
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) back("Code d’unité invalide (majuscules, chiffres, tirets)");
  try {
    await prisma.$transaction(async (tx) => {
      const last = await tx.resourceUnit.aggregate({ _max: { sortOrder: true } });
      const unit = await tx.resourceUnit.create({ data: { code, label, decimals, sortOrder: (last._max.sortOrder ?? 0) + 10 } });
      await writeAudit(tx, { actorId: session.userId, action: "UNIT_CREATED", entityType: "ResourceUnit", entityId: unit.id, newValues: { code, label, decimals } });
    });
  } catch (error) { if (isUniqueViolation(error)) back(`L’unité ${code} existe déjà`); throw error; }
  redirect(`/resources?info=${encodeURIComponent(`Unité « ${label} » créée`)}`);
}
