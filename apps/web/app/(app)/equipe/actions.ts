"use server";
import { prisma } from "@koeki/database";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireWriteAccess } from "@/lib/session";
import { assertAssignee, assertTeamActor } from "@/lib/team-service";
import { reportDayBoundary } from "@/lib/report-period";
import { writeAudit } from "@/lib/finance";

function failure(error: unknown) {
  const message = error instanceof Error && error.message.startsWith("VALIDATION:") ? error.message.slice(11) : error instanceof z.ZodError ? error.issues[0]?.message ?? "Saisie invalide" : "Action refusée ou saisie invalide";
  return { error: message };
}
function returnToTeam(formData: FormData, fallback: string) {
  const destination = String(formData.get("returnTo") ?? "");
  return destination.length <= 2048 && /^\/equipe(?:\/[a-zA-Z0-9_-]+)?(?:\?[a-zA-Z0-9_%&=+.-]*)?$/.test(destination) ? destination : fallback;
}
/** Compatibility for stale forms: never assign a ninja, even to a manager. */
export async function assignDossier(_formData: FormData) {
  await requireWriteAccess("team:assign");
  return { error: "Les ninjas n’ont pas d’agent référent. Chaque agent intervient librement sur le registre partagé." };
}
export async function addAgentNote(formData: FormData) {
  const session = await requireWriteAccess("team:notes"), userId = String(formData.get("userId") ?? "");
  try {
    const data = z.object({ userId: z.string().min(1), body: z.string().trim().min(5).max(4000) }).parse(Object.fromEntries(formData));
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "team:notes");
      const note = await tx.agentNote.create({ data: { ...data, authorId: session.userId } });
      await writeAudit(tx, { actorId: session.userId, action: "AGENT_NOTE_CREATED", entityType: "AgentNote", entityId: note.id });
    });
  } catch (error) { return failure(error); }
  redirect(returnToTeam(formData, `/equipe/${encodeURIComponent(userId)}?vue=accompagnement`));
}
export async function updateParticipation(formData: FormData) {
  const session = await requireWriteAccess("team:assign"), userId = String(formData.get("userId") ?? "");
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
  redirect(returnToTeam(formData, `/equipe/${encodeURIComponent(userId)}?vue=accompagnement`));
}
