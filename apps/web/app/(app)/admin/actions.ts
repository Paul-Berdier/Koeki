"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/domain";
import { isUniqueViolation, writeAudit } from "@/lib/finance";
import { hasPermission, requireWriteAccess } from "@/lib/session";

const invitationSchema = z.object({
  roleId: z.string().min(1, "Choisissez un rôle"),
  ninjaProfileId: z.string().optional().transform((value) => value || null),
  expiresDays: z.coerce.number().int().min(1).max(30)
});

export async function createInvitation(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = invitationSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/admin?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const { roleId, ninjaProfileId, expiresDays } = parsed.data!;
  const pepper = process.env.INVITE_TOKEN_PEPPER;
  if (!pepper) back("INVITE_TOKEN_PEPPER n’est pas configuré sur le serveur");
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) back("Rôle inconnu");
  if (role!.code === "SUPER_ADMIN" && !hasPermission(session, "users:manage")) back("Seul un super-administrateur peut inviter un super-administrateur");
  if (ninjaProfileId) {
    const ninja = await prisma.ninjaProfile.findUnique({ where: { id: ninjaProfileId }, include: { invitations: { where: { status: "PENDING" } } } });
    if (!ninja) back("Ninja introuvable");
    if (ninja!.userId) back("Ce ninja est déjà associé à un compte");
    if (ninja!.invitations.length) back("Une invitation en attente existe déjà pour ce ninja");
  }
  const { token, tokenHash } = createInvitationToken(pepper!);
  const expiresAt = new Date(Date.now() + expiresDays * 86_400_000);
  try {
    await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.create({ data: { tokenHash, roleId, ninjaProfileId, createdById: session.userId, expiresAt } });
      await writeAudit(tx, { actorId: session.userId, action: "INVITATION_CREATED", entityType: "Invitation", entityId: invitation.id, newValues: { role: role!.code, ninjaProfileId, expiresAt: expiresAt.toISOString() } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) back("Collision de jeton improbable — réessayez");
    throw error;
  }
  (await cookies()).set("koeki_last_invite", JSON.stringify({ token, role: role!.code, expiresAt: expiresAt.toISOString() }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/admin" });
  redirect("/admin");
}

export async function dismissLastInvite() {
  await requireWriteAccess("settings:manage");
  (await cookies()).delete({ name: "koeki_last_invite", path: "/admin" });
  redirect("/admin");
}

export async function revokeInvitation(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const invitationId = formData.get("invitationId");
  if (typeof invitationId !== "string" || !invitationId) redirect("/admin");
  await prisma.$transaction(async (tx) => {
    const updated = await tx.invitation.updateMany({ where: { id: invitationId as string, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    if (updated.count === 1) await writeAudit(tx, { actorId: session.userId, action: "INVITATION_REVOKED", entityType: "Invitation", entityId: invitationId as string });
  });
  redirect("/admin");
}

const penaltySchema = z.object({
  // Saisi en pourcentage (ex. 10 ou 12,5), stocké en points de base pour un calcul entier exact.
  percent: z.union([z.literal(""), z.string().trim().transform((value) => Number(value.replace(",", "."))).pipe(z.number().min(0.01, "Taux invalide").max(100, "Taux maximum : 100 %"))]).transform((value) => (value === "" ? null : Math.round((value as number) * 100))),
  basis: z.enum(["ORIGINAL_TAX", "REMAINING_PRINCIPAL", "CURRENT_DEBT"]),
  maxApplications: z.coerce.number().int().min(1).max(20),
  maxDebt: z.coerce.number().int().min(0),
  isRateValidated: z.literal("on").optional(),
  isEnabled: z.literal("on").optional()
});

export async function updatePenaltySettings(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = penaltySchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/admin?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const data = parsed.data!;
  const validated = data.isRateValidated === "on" && data.percent !== null;
  const enabled = data.isEnabled === "on" && validated;
  if (data.isEnabled === "on" && !validated) back("Impossible d’activer l’automatisation sans taux défini et validé");
  const previous = await prisma.appSetting.findUnique({ where: { key: "latePenalty" } });
  const value = {
    latePenaltyPercentBps: data.percent, latePenaltyBasis: data.basis, latePenaltyFrequencyRpYears: 1,
    maxPenaltyApplications: data.maxApplications, maxAssessmentDebt: String(data.maxDebt), isPenaltyAutomationEnabled: enabled, isRateValidated: validated
  };
  await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({ where: { key: "latePenalty" }, create: { key: "latePenalty", value, updatedById: session.userId }, update: { value, version: { increment: 1 }, updatedById: session.userId } });
    await writeAudit(tx, { actorId: session.userId, action: "PENALTY_SETTINGS_UPDATED", entityType: "AppSetting", entityId: "latePenalty", previousValues: previous?.value ?? undefined, newValues: value });
  });
  redirect("/admin");
}

const approvalSchema = z.object({ amount: z.coerce.number().int().min(0), isValidated: z.literal("on").optional() });

export async function updateApprovalThreshold(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = approvalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/admin?erreur=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Saisie invalide")}`);
  const value = { amount: String(parsed.data!.amount), isValidated: parsed.data!.isValidated === "on" };
  const previous = await prisma.appSetting.findUnique({ where: { key: "approvalThreshold" } });
  await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({ where: { key: "approvalThreshold" }, create: { key: "approvalThreshold", value, updatedById: session.userId }, update: { value, version: { increment: 1 }, updatedById: session.userId } });
    await writeAudit(tx, { actorId: session.userId, action: "APPROVAL_THRESHOLD_UPDATED", entityType: "AppSetting", entityId: "approvalThreshold", previousValues: previous?.value ?? undefined, newValues: value });
  });
  redirect("/admin");
}

export async function revokeUserAccess(formData: FormData) {
  const session = await requireWriteAccess("users:manage");
  const userId = formData.get("userId");
  if (typeof userId !== "string" || !userId) redirect("/admin");
  if (userId === session.userId) redirect("/admin?erreur=Impossible%20de%20r%C3%A9voquer%20votre%20propre%20acc%C3%A8s");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId as string }, data: { revokedAt: new Date(), sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: userId as string } });
    await writeAudit(tx, { actorId: session.userId, action: "USER_ACCESS_REVOKED", entityType: "User", entityId: userId as string });
  });
  redirect("/admin");
}
