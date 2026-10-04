"use server";
import { prisma } from "@koeki/database";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireWriteAccess } from "@/lib/session";
import { assertAssignee, assertTeamActor, notifyInternal } from "@/lib/team-service";
import { reportDayBoundary } from "@/lib/report-period";
import { writeAudit } from "@/lib/finance";

function failure(error: unknown) { const message = error instanceof Error && error.message.startsWith("VALIDATION:") ? error.message.slice(11) : error instanceof z.ZodError ? error.issues[0]?.message ?? "Saisie invalide" : "Action refusée ou saisie invalide"; return { error: message }; }
export async function assignDossier(formData: FormData) {
  const session = await requireWriteAccess("team:assign");
  try {
    const data = z.object({ ninjaId: z.string().min(1), assigneeId: z.string().optional().transform((value) => value || null), reason: z.string().trim().min(5).max(1000) }).parse(Object.fromEntries(formData));
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "team:assign");
      await assertAssignee(tx, data.assigneeId);
      await tx.$executeRaw`SELECT "id" FROM "NinjaProfile" WHERE "id" = ${data.ninjaId} FOR UPDATE`;
      const ninja = await tx.ninjaProfile.findUnique({ where: { id: data.ninjaId }, select: { referenceAgentId: true } });
      if (!ninja) throw new Error("VALIDATION:Dossier introuvable");
      if (ninja.referenceAgentId === data.assigneeId) return;
      await tx.ninjaProfile.update({ where: { id: data.ninjaId }, data: { referenceAgentId: data.assigneeId } });
      await tx.assignmentHistory.create({ data: { ninjaId: data.ninjaId, previousAgentId: ninja.referenceAgentId, assignedAgentId: data.assigneeId, actorId: session.userId, reason: data.reason } });
      if (data.assigneeId) await notifyInternal(tx, { userId: data.assigneeId, title: "Dossier affecté", body: "Un dossier vous a été attribué.", href: `/ninjas/${data.ninjaId}`, dedupeKey: `assignment:${data.ninjaId}:${crypto.randomUUID()}` });
      await writeAudit(tx, { actorId: session.userId, action: "DOSSIER_ASSIGNED", entityType: "NinjaProfile", entityId: data.ninjaId, reason: data.reason });
    });
  } catch (error) { return failure(error); }
  redirect("/equipe");
}
export async function addAgentNote(formData: FormData) {
  const session = await requireWriteAccess("team:notes");
  const userId = String(formData.get("userId") ?? "");
  try {
    const data = z.object({ userId: z.string().min(1), body: z.string().trim().min(5).max(4000) }).parse(Object.fromEntries(formData));
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "team:notes");
      const note = await tx.agentNote.create({ data: { ...data, authorId: session.userId } });
      await writeAudit(tx, { actorId: session.userId, action: "AGENT_NOTE_CREATED", entityType: "AgentNote", entityId: note.id });
    });
  } catch (error) { return failure(error); }
  redirect(`/equipe/${encodeURIComponent(userId)}`);
}
export async function updateParticipation(formData: FormData) {
  const session = await requireWriteAccess("team:assign");
  const userId = String(formData.get("userId") ?? "");
  try {
    const data = z.object({ userId: z.string().min(1), intent: z.enum(["join", "leave", "absence"]), startsAt: z.string().optional(), endsAt: z.string().optional(), reason: z.string().trim().min(5).max(1000) }).parse(Object.fromEntries(formData));
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "team:assign");
      if (data.intent === "join") {
        await assertAssignee(tx, userId);
        if (await tx.agentParticipation.findFirst({ where: { userId, endsAt: null } })) throw new Error("VALIDATION:Une participation est déjà ouverte");
        const startsAt = data.startsAt ? reportDayBoundary(data.startsAt) : null;
        if (startsAt && startsAt > new Date()) throw new Error("VALIDATION:L’entrée ne peut pas être future");
        const target = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { roles: { select: { role: { select: { code: true } } } } } });
        const serviceRole = target.roles.some(({ role }) => role.code === "ECONOMIC_AGENT") ? "ECONOMIC_AGENT" : "LEADERSHIP";
        await tx.agentParticipation.create({ data: { userId, startsAt, observedAt: new Date(), dateSource: startsAt ? "DECLARED" : "OBSERVED", serviceRole, rankingEligible: formData.get("rankingEligible") === "on", createdById: session.userId } });
      } else if (data.intent === "leave") {
        await tx.agentParticipation.updateMany({ where: { userId, endsAt: null }, data: { endsAt: new Date() } });
      } else {
        if (!data.startsAt || !data.endsAt) throw new Error("VALIDATION:Précisez les dates d’absence");
        const startsAt = reportDayBoundary(data.startsAt), endsAt = reportDayBoundary(data.endsAt, true);
        if (endsAt <= startsAt) throw new Error("VALIDATION:Période d’absence invalide");
        await tx.agentAbsence.create({ data: { userId, startsAt, endsAt, reason: data.reason, createdById: session.userId } });
      }
      await writeAudit(tx, { actorId: session.userId, action: "AGENT_PARTICIPATION_CHANGED", entityType: "User", entityId: userId, reason: data.reason });
    });
  } catch (error) { return failure(error); }
  redirect(`/equipe/${encodeURIComponent(userId)}`);
}
