"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@koeki/database";
import { allocatePayment, ryo } from "@koeki/domain";
import { buildDebtLines, getRpService, loadNinjaFiscal } from "@/lib/data";
import { awardPoints, exemptionBalance, grantExemption, isUniqueViolation, nextPaymentReceipt, refreshAssessmentStatus, withReceiptRetry, writeAudit } from "@/lib/finance";
import { demoMode, getSession, requireWriteAccess } from "@/lib/session";

const createNinjaSchema = z.object({
  firstName: z.string().trim().min(1, "Le prénom est obligatoire").max(80),
  lastName: z.string().trim().min(1, "Le nom est obligatoire").max(80),
  gradeId: z.string().min(1, "Le grade est obligatoire"),
  alias: z.string().trim().max(80).optional().transform((value) => value || null),
  clan: z.string().trim().max(80).optional().transform((value) => value || null),
  notes: z.string().trim().max(2000).optional().transform((value) => value || null)
});

export async function createNinja(formData: FormData) {
  const session = await requireWriteAccess("ninjas:write");
  const parsed = createNinjaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/ninjas/new?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const grade = await prisma.ninjaGrade.findUnique({ where: { id: parsed.data.gradeId } });
  if (!grade) redirect("/ninjas/new?erreur=Grade%20inconnu");
  let ninjaId: string | null = null;
  for (let attempt = 0; attempt < 3 && !ninjaId; attempt++) {
    const last = await prisma.ninjaProfile.findFirst({ orderBy: { code: "desc" }, select: { code: true } });
    const next = `NIN-${String((last ? Number(last.code.slice(4)) : 0) + 1).padStart(6, "0")}`;
    try {
      ninjaId = await prisma.$transaction(async (tx) => {
        const ninja = await tx.ninjaProfile.create({ data: { code: next, firstName: parsed.data.firstName, lastName: parsed.data.lastName, alias: parsed.data.alias, clan: parsed.data.clan, notes: parsed.data.notes, currentGradeId: grade.id } });
        await tx.ninjaGradeHistory.create({ data: { ninjaId: ninja.id, gradeId: grade.id, effectiveFrom: new Date(), reason: "Création du dossier", changedById: session.userId } });
        await writeAudit(tx, { actorId: session.userId, action: "NINJA_CREATED", entityType: "NinjaProfile", entityId: ninja.id, newValues: { code: next, firstName: parsed.data.firstName, lastName: parsed.data.lastName, grade: grade.code } });
        return ninja.id;
      });
    } catch (error) { if (!isUniqueViolation(error)) throw error; }
  }
  if (!ninjaId) redirect("/ninjas/new?erreur=Conflit%20de%20code%2C%20r%C3%A9essayez");
  redirect(`/ninjas/${ninjaId}`);
}

async function nextNinjaCode() {
  const last = await prisma.ninjaProfile.findFirst({ orderBy: { code: "desc" }, select: { code: true } });
  return `NIN-${String((last ? Number(last.code.slice(4)) : 0) + 1).padStart(6, "0")}`;
}

/** Self-service: an invited agent registers their own ninja sheet, linked to their account. */
export async function createOwnProfile(formData: FormData) {
  if (demoMode) throw new Error("Mode démonstration : les écritures sont désactivées");
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  const existing = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId } });
  if (existing) redirect(`/ninjas/${existing.id}`);
  const parsed = createNinjaSchema.omit({ notes: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/profil?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const grade = await prisma.ninjaGrade.findUnique({ where: { id: parsed.data.gradeId } });
  if (!grade) redirect("/profil?erreur=Grade%20inconnu");
  let ninjaId: string | null = null;
  for (let attempt = 0; attempt < 3 && !ninjaId; attempt++) {
    const code = await nextNinjaCode();
    try {
      ninjaId = await prisma.$transaction(async (tx) => {
        const ninja = await tx.ninjaProfile.create({ data: { code, firstName: parsed.data.firstName, lastName: parsed.data.lastName, alias: parsed.data.alias, clan: parsed.data.clan, currentGradeId: grade!.id, userId: session.userId } });
        await tx.ninjaGradeHistory.create({ data: { ninjaId: ninja.id, gradeId: grade!.id, effectiveFrom: new Date(), reason: "Auto-enregistrement à l’arrivée", changedById: session.userId } });
        await writeAudit(tx, { actorId: session.userId, action: "NINJA_SELF_REGISTERED", entityType: "NinjaProfile", entityId: ninja.id, newValues: { code, firstName: parsed.data.firstName, lastName: parsed.data.lastName, grade: grade!.code } });
        return ninja.id;
      });
    } catch (error) { if (!isUniqueViolation(error)) throw error; }
  }
  if (!ninjaId) redirect("/profil?erreur=Conflit%20de%20code%2C%20r%C3%A9essayez");
  redirect(`/ninjas/${ninjaId}`);
}

/** Links an existing unclaimed record to the signed-in account (imported registers have no linked users). */
export async function claimOwnProfile(formData: FormData) {
  if (demoMode) throw new Error("Mode démonstration : les écritures sont désactivées");
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  const existing = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId } });
  if (existing) redirect(`/ninjas/${existing.id}`);
  const ninjaId = formData.get("ninjaId");
  if (typeof ninjaId !== "string" || !ninjaId) redirect("/profil?erreur=S%C3%A9lectionnez%20une%20fiche");
  const claimed = await prisma.$transaction(async (tx) => {
    const updated = await tx.ninjaProfile.updateMany({ where: { id: ninjaId as string, userId: null, status: "ACTIVE" }, data: { userId: session.userId, version: { increment: 1 } } });
    if (updated.count === 1) await writeAudit(tx, { actorId: session.userId, action: "NINJA_CLAIMED", entityType: "NinjaProfile", entityId: ninjaId as string, reason: "Fiche existante liée au compte lors de l’arrivée" });
    return updated.count === 1;
  });
  if (!claimed) redirect("/profil?erreur=Cette%20fiche%20est%20d%C3%A9j%C3%A0%20li%C3%A9e%20%C3%A0%20un%20autre%20compte");
  redirect(`/ninjas/${ninjaId}`);
}

const updateNinjaSchema = createNinjaSchema.extend({
  ninjaId: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
}).omit({ gradeId: true });

export async function updateNinja(formData: FormData) {
  const session = await requireWriteAccess("ninjas:write");
  const parsed = updateNinjaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/ninjas?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const { ninjaId, ...data } = parsed.data!;
  const previous = await prisma.ninjaProfile.findUnique({ where: { id: ninjaId } });
  if (!previous) redirect("/ninjas?erreur=Dossier%20introuvable");
  if (previous!.status === "ARCHIVED") redirect(`/ninjas?erreur=${encodeURIComponent("Ce dossier est archivé — restaurez-le explicitement avant de le modifier")}`);
  await prisma.$transaction(async (tx) => {
    await tx.ninjaProfile.update({ where: { id: ninjaId }, data: { ...data, version: { increment: 1 } } });
    await writeAudit(tx, { actorId: session.userId, action: "NINJA_UPDATED", entityType: "NinjaProfile", entityId: ninjaId,
      previousValues: { firstName: previous!.firstName, lastName: previous!.lastName, alias: previous!.alias, clan: previous!.clan, status: previous!.status },
      newValues: { firstName: data.firstName, lastName: data.lastName, alias: data.alias, clan: data.clan, status: data.status } });
  });
  redirect(`/ninjas/${ninjaId}`);
}

export async function restoreNinja(formData: FormData) {
  const session = await requireWriteAccess("ninjas:write");
  const ninjaId = formData.get("ninjaId");
  if (typeof ninjaId !== "string" || !ninjaId) redirect("/ninjas");
  await prisma.$transaction(async (tx) => {
    const restored = await tx.ninjaProfile.updateMany({ where: { id: ninjaId as string, status: "ARCHIVED" }, data: { status: "ACTIVE", version: { increment: 1 } } });
    if (restored.count === 1) await writeAudit(tx, { actorId: session.userId, action: "NINJA_RESTORED", entityType: "NinjaProfile", entityId: ninjaId as string });
  });
  redirect(`/ninjas/${ninjaId}`);
}

/** Hard-deletes only spotless records; anything with financial history is archived instead. */
export async function deleteNinja(formData: FormData) {
  const session = await requireWriteAccess("ninjas:write");
  const ninjaId = formData.get("ninjaId");
  if (typeof ninjaId !== "string" || !ninjaId || formData.get("confirm") !== "on") redirect(`/ninjas/${ninjaId}/modifier?erreur=Cochez%20la%20confirmation`);
  const ninja = await prisma.ninjaProfile.findUnique({ where: { id: ninjaId as string }, include: { _count: { select: { assessments: true, payments: true, pointEntries: true, resourceTransactions: true, invitations: true, exemptionEntries: true } } } });
  if (!ninja) redirect("/ninjas?erreur=Dossier%20introuvable");
  const counts = ninja!._count;
  const hasHistory = counts.assessments + counts.payments + counts.pointEntries + counts.resourceTransactions + counts.invitations + counts.exemptionEntries > 0;
  const archive = () => prisma.$transaction(async (tx) => {
    await tx.ninjaProfile.update({ where: { id: ninjaId as string }, data: { status: "ARCHIVED", userId: null, version: { increment: 1 } } });
    await writeAudit(tx, { actorId: session.userId, action: "NINJA_ARCHIVED", entityType: "NinjaProfile", entityId: ninjaId as string, reason: "Historique financier présent : archivage au lieu d’une suppression" });
  });
  let outcome: "supprime" | "archive" = "supprime";
  if (hasHistory) { await archive(); outcome = "archive"; }
  else {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.ninjaGradeHistory.deleteMany({ where: { ninjaId: ninjaId as string } });
        await tx.ninjaProfile.delete({ where: { id: ninjaId as string } });
        await writeAudit(tx, { actorId: session.userId, action: "NINJA_DELETED", entityType: "NinjaProfile", entityId: ninjaId as string, newValues: { code: ninja!.code } });
      });
    } catch (error) {
      // Any surviving reference (written between the check and the delete) falls back to archiving.
      if (error instanceof Prisma.PrismaClientKnownRequestError) { await archive(); outcome = "archive"; }
      else throw error;
    }
  }
  redirect(`/ninjas?info=${encodeURIComponent(`Dossier ${ninja!.code} ${outcome === "supprime" ? "supprimé définitivement" : "archivé (historique financier conservé)"}`)}`);
}

const paymentSchema = z.object({
  ninjaId: z.string().min(1),
  amount: z.coerce.number().int().positive("Le montant doit être un entier positif"),
  method: z.enum(["ESPECES", "TRANSFERT", "EXONERATION", "AUTRE"]),
  reference: z.string().trim().max(120).optional().transform((value) => value || null),
  idempotencyKey: z.string().uuid()
});

export async function recordPayment(formData: FormData) {
  const session = await requireWriteAccess("payments:write");
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/ninjas?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const { ninjaId, amount, method, reference, idempotencyKey } = parsed.data;
  const back = (message: string) => redirect(`/ninjas/${ninjaId}?erreur=${encodeURIComponent(message)}`);
  const preview = await loadNinjaFiscal(ninjaId);
  if (!preview) back("Ninja introuvable");
  if (!buildDebtLines(preview!).length) back("Aucune dette ouverte pour ce ninja");
  const service = await getRpService();
  let receipt = "";
  try {
    receipt = await withReceiptRetry(() => prisma.$transaction(async (tx) => {
      // Serialize concurrent payments on the same record, then recompute the allocation on locked state.
      await tx.$executeRaw`SELECT id FROM "NinjaProfile" WHERE id = ${ninjaId} FOR UPDATE`;
      const assessments = await loadNinjaFiscal(ninjaId, tx);
      const debtLines = buildDebtLines(assessments ?? []);
      if (!debtLines.length) throw new Error("VALIDATION:Aucune dette ouverte pour ce ninja");
      const allocation = allocatePayment(ryo(amount), debtLines);
      if (allocation.unallocated > 0n) throw new Error("VALIDATION:Le montant dépasse la dette ouverte — réduisez le paiement");
      const balanceBefore = debtLines.reduce((total, line) => total + line.remaining, 0n);
      if (method === "EXONERATION") {
        const credit = await exemptionBalance(tx, ninjaId);
        if (credit < BigInt(amount)) throw new Error(`VALIDATION:Crédit d’exonération insuffisant (${credit.toLocaleString("fr-FR")} ¥ disponibles)`);
      }
      const receiptNumber = await nextPaymentReceipt(tx);
      const payment = await tx.taxPayment.create({ data: {
        receiptNumber, ninjaId, recordedById: session.userId, amount: BigInt(amount), method, reference, status: "VALIDATED",
        balanceBefore, balanceAfter: balanceBefore - BigInt(amount), idempotencyKey, validatedAt: new Date()
      } });
      await tx.taxPaymentAllocation.createMany({ data: allocation.allocations.map((entry, index) => ({ paymentId: payment.id, assessmentId: entry.assessmentId, amount: entry.amount, allocationOrder: index + 1 })) });
      if (method === "EXONERATION") await grantExemption(tx, { ninjaId, amount: -BigInt(amount), sourceType: "TaxPayment", sourceId: payment.id, reason: `Taxe payée par exonération (${receiptNumber})` });
      const touched = [...new Set(allocation.allocations.map((entry) => entry.assessmentId))];
      const overdueTouched = assessments!.some((assessment) => touched.includes(assessment.id) && assessment.dueAt < new Date());
      for (const assessmentId of touched) await refreshAssessmentStatus(tx, assessmentId, service.currentRpYear());
      await awardPoints(tx, { ninjaId, eventType: "TAX_PAYMENT", amount: BigInt(amount), sourceType: "TaxPayment", sourceId: payment.id });
      if (!overdueTouched) await awardPoints(tx, { ninjaId, eventType: "ON_TIME_PAYMENT", amount: BigInt(amount), sourceType: "TaxPayment", sourceId: payment.id });
      await writeAudit(tx, { actorId: session.userId, action: "PAYMENT_RECORDED", entityType: "TaxPayment", entityId: payment.id, reason: `Paiement de ${amount} Ryō (${receiptNumber})`, newValues: { amount, method, allocations: allocation.allocations.map((entry) => ({ assessmentId: entry.assessmentId, amount: Number(entry.amount) })) } });
      return receiptNumber;
    }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    if (isUniqueViolation(error)) back("Ce paiement a déjà été enregistré (double soumission détectée)");
    throw error;
  }
  redirect(`/ninjas/${ninjaId}?recu=${encodeURIComponent(receipt)}`);
}

const gradeChangeSchema = z.object({ ninjaId: z.string().min(1), gradeId: z.string().min(1), reason: z.string().trim().min(3, "Un motif est obligatoire").max(300) });

export async function changeGrade(formData: FormData) {
  const session = await requireWriteAccess("ninjas:write");
  const parsed = gradeChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/ninjas?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const { ninjaId, gradeId, reason } = parsed.data;
  const [ninja, grade] = await Promise.all([
    prisma.ninjaProfile.findUnique({ where: { id: ninjaId }, include: { currentGrade: true } }),
    prisma.ninjaGrade.findUnique({ where: { id: gradeId } })
  ]);
  if (!ninja || !grade) redirect(`/ninjas/${ninjaId}?erreur=Dossier%20ou%20grade%20introuvable`);
  if (ninja!.currentGradeId !== gradeId) await prisma.$transaction(async (tx) => {
    await tx.ninjaGradeHistory.updateMany({ where: { ninjaId, effectiveTo: null }, data: { effectiveTo: new Date() } });
    await tx.ninjaGradeHistory.create({ data: { ninjaId, gradeId, effectiveFrom: new Date(), reason, changedById: session.userId } });
    await tx.ninjaProfile.update({ where: { id: ninjaId }, data: { currentGradeId: gradeId, version: { increment: 1 } } });
    await writeAudit(tx, { actorId: session.userId, action: "GRADE_CHANGED", entityType: "NinjaProfile", entityId: ninjaId, reason, previousValues: { grade: ninja!.currentGrade.code }, newValues: { grade: grade!.code } });
  });
  redirect(`/ninjas/${ninjaId}`);
}
