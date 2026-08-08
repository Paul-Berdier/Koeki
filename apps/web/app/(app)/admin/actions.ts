"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@koeki/database";
import { createInvitationToken } from "@koeki/domain";
import { getRpService } from "@/lib/data";
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
    const ninja = await prisma.ninjaProfile.findUnique({ where: { id: ninjaProfileId }, include: { invitations: { where: { status: "PENDING", revokedAt: null, expiresAt: { gt: new Date() } } } } });
    if (!ninja) back("Ninja introuvable");
    if (ninja!.userId) back("Ce ninja est déjà associé à un compte");
    if (ninja!.invitations.length) back("Une invitation encore valable existe déjà pour ce ninja — révoquez-la d’abord");
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

/** Replaces a user's role set. Super-admins can grant everything; managers can grant
 *  everything except SUPER_ADMIN and cannot touch a super-admin's account. Roles are read
 *  from the database on every request, so the change applies immediately. */
export async function updateUserRoles(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const isSuper = hasPermission(session, "users:manage");
  const back = (message: string): never => redirect(`/admin?erreur=${encodeURIComponent(message)}`);
  const userId = formData.get("userId");
  if (typeof userId !== "string" || !userId) back("Utilisateur manquant");
  const [roles, target] = await Promise.all([
    prisma.role.findMany(),
    prisma.user.findUnique({ where: { id: userId as string }, include: { roles: { include: { role: true } }, ninjaProfile: { select: { firstName: true, lastName: true } } } })
  ]);
  if (!target) back("Utilisateur introuvable");
  const displayName = target!.ninjaProfile ? `${target!.ninjaProfile.firstName} ${target!.ninjaProfile.lastName}`.trim() : target!.name ?? target!.email ?? target!.id;
  const requested = roles.filter((role) => formData.get(`role_${role.code}`) === "on");
  const currentCodes = target!.roles.map((entry) => entry.role.code);
  if (!isSuper && currentCodes.includes("SUPER_ADMIN")) back("Seul un super-administrateur peut modifier les rôles d’un super-administrateur");
  if (!isSuper && requested.some((role) => role.code === "SUPER_ADMIN")) back("Seul un super-administrateur peut attribuer le rôle super-administrateur");
  if (!requested.length) back("Attribuez au moins un rôle — pour couper l’accès, utilisez la révocation");
  if (currentCodes.includes("SUPER_ADMIN") && !requested.some((role) => role.code === "SUPER_ADMIN")) {
    const otherSupers = await prisma.userRole.count({ where: { role: { code: "SUPER_ADMIN" }, userId: { not: target!.id }, user: { revokedAt: null } } });
    if (otherSupers === 0) back("Impossible de retirer le rôle du dernier super-administrateur actif");
  }
  const requestedIds = new Set(requested.map((role) => role.id));
  const currentIds = new Set(target!.roles.map((entry) => entry.roleId));
  const toAdd = requested.filter((role) => !currentIds.has(role.id));
  const toRemove = target!.roles.filter((entry) => !requestedIds.has(entry.roleId));
  if (!toAdd.length && !toRemove.length) redirect(`/admin?info=${encodeURIComponent("Rôles inchangés — rien à faire")}`);
  await prisma.$transaction(async (tx) => {
    if (toRemove.length) await tx.userRole.deleteMany({ where: { userId: target!.id, roleId: { in: toRemove.map((entry) => entry.roleId) } } });
    if (toAdd.length) await tx.userRole.createMany({ data: toAdd.map((role) => ({ userId: target!.id, roleId: role.id, assignedById: session.userId })) });
    await writeAudit(tx, { actorId: session.userId, action: "USER_ROLES_UPDATED", entityType: "User", entityId: target!.id, reason: `Rôles de ${displayName}`,
      previousValues: { roles: currentCodes }, newValues: { roles: requested.map((role) => role.code) } });
  });
  redirect(`/admin?info=${encodeURIComponent(`Rôles de ${displayName} mis à jour — effet immédiat`)}`);
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

/** Publishes a new weekly-tax scale (one amount per grade, historized as a new policy
 *  version) and immediately rebills the current RP week at the new amounts. Lines already
 *  touched (payments, exemptions, penalties, adjustments) and the old register's
 *  advance-paid weeks are left untouched; regenerated taxes are auto-covered by any
 *  exemption credit, like every Sunday. */
export async function updateTaxRates(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const back = (message: string): never => redirect(`/admin?erreur=${encodeURIComponent(message)}`);
  const grades = await prisma.ninjaGrade.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const rates = new Map<string, bigint>();
  for (const grade of grades) {
    const raw = formData.get(`rate_${grade.id}`);
    if (typeof raw !== "string" || raw.trim() === "") back(`Montant manquant pour ${grade.label}`);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 100_000_000) back(`Montant invalide pour ${grade.label} (entier en Ryō)`);
    rates.set(grade.id, BigInt(value));
  }
  const active = await prisma.taxPolicy.findFirst({ where: { isActive: true }, include: { rates: true } });
  if (active && grades.every((grade) => (active.rates.find((rate) => rate.gradeId === grade.id)?.amount ?? 0n) === rates.get(grade.id))) redirect(`/admin?info=${encodeURIComponent("Barème inchangé — rien à faire")}`);
  const service = await getRpService();
  const rpYear = service.currentRpYear();
  let version = 0, rebilled = 0, exempted = 0;
  await prisma.$transaction(async (tx) => {
    const name = active?.name ?? "Barème Kōeki";
    const latest = await tx.taxPolicy.findFirst({ where: { name }, orderBy: { version: "desc" } });
    version = (latest?.version ?? 0) + 1;
    if (active) await tx.taxPolicy.update({ where: { id: active.id }, data: { isActive: false, effectiveToRpYear: rpYear } });
    const policy = await tx.taxPolicy.create({ data: { name, version, effectiveFromRpYear: rpYear, isActive: true, rates: { createMany: { data: grades.map((grade) => ({ gradeId: grade.id, amount: rates.get(grade.id)! })) } } } });
    const year = await tx.taxYear.findUnique({ where: { rpYear } });
    if (year) {
      const untouched = await tx.taxAssessment.findMany({ where: {
        taxYearId: year.id, taxPolicy: { name: { not: "Ancien registre" } },
        allocations: { none: {} }, exemptions: { none: {} }, penalties: { none: {} }, adjustments: { none: {} }
      }, select: { id: true } });
      if (untouched.length) await tx.taxAssessment.deleteMany({ where: { id: { in: untouched.map((entry) => entry.id) } } });
      const ninjas = await tx.ninjaProfile.findMany({ where: { status: "ACTIVE" }, include: { currentGrade: true } });
      const result = await tx.taxAssessment.createMany({ data: ninjas.map((ninja) => ({
        ninjaId: ninja.id, taxYearId: year.id, taxPolicyId: policy.id, gradeCodeSnapshot: ninja.currentGrade.code, gradeLabelSnapshot: ninja.currentGrade.label,
        originalAmount: rates.get(ninja.currentGradeId) ?? 0n, dueAt: year.dueAt, status: year.dueAt > new Date() ? "UPCOMING" as const : "DUE" as const
      })), skipDuplicates: true });
      rebilled = result.count;
      const fresh = await tx.taxAssessment.findMany({ where: { taxYearId: year.id, taxPolicyId: policy.id, originalAmount: { gt: 0 } }, select: { id: true, ninjaId: true, originalAmount: true } });
      for (const assessment of fresh) {
        const already = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "TaxAssessment", sourceId: assessment.id } } });
        if (already) continue;
        const balance = (await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId: assessment.ninjaId }, _sum: { amount: true } }))._sum.amount ?? 0n;
        if (balance <= 0n) continue;
        const use = balance < assessment.originalAmount ? balance : assessment.originalAmount;
        await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: -use, sourceType: "TaxAssessment", sourceId: assessment.id, reason: `Exonération automatique — taxe année RP ${rpYear}` } });
        await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: use, reason: "Exonération automatique (crédit de dons/rachats)", grantedById: session.userId } });
        if (use >= assessment.originalAmount) await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID" } });
        exempted++;
      }
    }
    await writeAudit(tx, { actorId: session.userId, action: "TAX_POLICY_UPDATED", entityType: "TaxPolicy", entityId: policy.id, reason: `Barème v${version} publié — semaine RP ${rpYear} refacturée (${rebilled} taxes régénérées, ${exempted} couvertes par crédit)`, newValues: Object.fromEntries(grades.map((grade) => [grade.label, Number(rates.get(grade.id))])) });
  }, { timeout: 180_000, maxWait: 15_000 });
  redirect(`/admin?info=${encodeURIComponent(`Barème v${version} appliqué — ${rebilled} taxes refacturées pour la semaine en cours${exempted ? `, dont ${exempted} couvertes par le crédit d’exonération` : ""}`)}`);
}

/** Opens (or completes) the current RP week for every active ninja at the active scale,
 *  without waiting for Sunday's worker run. Idempotent: existing lines are left alone. */
export async function billCurrentWeek() {
  const session = await requireWriteAccess("settings:manage");
  const policy = await prisma.taxPolicy.findFirst({ where: { isActive: true }, include: { rates: true } });
  if (!policy) redirect("/admin?erreur=Aucune%20politique%20fiscale%20active");
  const service = await getRpService();
  const rpYear = service.currentRpYear();
  const ninjas = await prisma.ninjaProfile.findMany({ where: { status: "ACTIVE" }, include: { currentGrade: true } });
  const rates = new Map(policy!.rates.map((rate) => [rate.gradeId, rate.amount]));
  let created = 0, exempted = 0;
  await prisma.$transaction(async (tx) => {
    const year = await tx.taxYear.upsert({ where: { rpYear }, create: { rpYear, taxPolicyId: policy!.id, startsAt: service.startOfRpYear(rpYear), endsAt: service.endOfRpYear(rpYear), dueAt: service.dueAt(rpYear), generatedAt: new Date() }, update: { generatedAt: new Date() } });
    const result = await tx.taxAssessment.createMany({ data: ninjas.map((ninja) => ({
      ninjaId: ninja.id, taxYearId: year.id, taxPolicyId: policy!.id, gradeCodeSnapshot: ninja.currentGrade.code, gradeLabelSnapshot: ninja.currentGrade.label,
      originalAmount: rates.get(ninja.currentGradeId) ?? 0n, dueAt: year.dueAt, status: year.dueAt > new Date() ? "UPCOMING" as const : "DUE" as const
    })), skipDuplicates: true });
    created = result.count;
    const fresh = await tx.taxAssessment.findMany({ where: { taxYearId: year.id, originalAmount: { gt: 0 }, status: { in: ["UPCOMING", "DUE"] } }, select: { id: true, ninjaId: true, originalAmount: true } });
    for (const assessment of fresh) {
      const already = await tx.exemptionLedgerEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "TaxAssessment", sourceId: assessment.id } } });
      if (already) continue;
      const balance = (await tx.exemptionLedgerEntry.aggregate({ where: { ninjaId: assessment.ninjaId }, _sum: { amount: true } }))._sum.amount ?? 0n;
      if (balance <= 0n) continue;
      const use = balance < assessment.originalAmount ? balance : assessment.originalAmount;
      await tx.exemptionLedgerEntry.create({ data: { ninjaId: assessment.ninjaId, amount: -use, sourceType: "TaxAssessment", sourceId: assessment.id, reason: `Exonération automatique — taxe semaine RP ${rpYear}` } });
      await tx.taxExemption.create({ data: { assessmentId: assessment.id, amount: use, reason: "Exonération automatique (crédit de dons/rachats)", grantedById: session.userId } });
      if (use >= assessment.originalAmount) await tx.taxAssessment.update({ where: { id: assessment.id }, data: { status: "PAID" } });
      exempted++;
    }
    const marker = { lastRpYear: rpYear, at: new Date().toISOString() };
    await tx.appSetting.upsert({ where: { key: "taxGeneration" }, create: { key: "taxGeneration", value: marker }, update: { value: marker, version: { increment: 1 } } });
    await writeAudit(tx, { actorId: session.userId, action: "TAX_WEEK_BILLED", entityType: "TaxYear", entityId: year.id, reason: `Semaine RP ${rpYear} ouverte manuellement — ${created} taxes créées, ${exempted} couvertes par le crédit d’exonération` });
  }, { timeout: 180_000, maxWait: 15_000 });
  redirect(`/admin?info=${encodeURIComponent(created ? `Semaine RP ${rpYear} facturée — ${created} taxe${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}${exempted ? `, dont ${exempted} couverte${exempted > 1 ? "s" : ""} par le crédit d’exonération` : ""}` : `Semaine RP ${rpYear} déjà facturée pour tous les ninjas actifs`)}`);
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
