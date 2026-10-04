"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@koeki/database";
import { assertTaskTransition, can, TASK_STATUSES, type TaskStatus } from "@koeki/domain";
import { requireWriteAccess } from "@/lib/session";
import { assertAssignee, assertTeamActor, notifyInternal } from "@/lib/team-service";
import { reportDayBoundary } from "@/lib/report-period";
import { writeAudit } from "@/lib/finance";

const optionalId = z.string().trim().max(100).optional().transform((value) => value || null);
const taskSchema = z.object({ title: z.string().trim().min(3).max(160), description: z.string().trim().min(5).max(4000), assigneeId: optionalId, ninjaId: optionalId, reportId: optionalId, priority: z.enum(["LOW", "NORMAL", "HIGH"]), dueAt: z.string().optional() });
function fail(error: unknown) { const message = error instanceof Error && error.message.startsWith("VALIDATION:") ? error.message.slice(11) : error instanceof z.ZodError ? error.issues[0]?.message ?? "Saisie invalide" : "Action refusée ou saisie invalide"; return { error: message }; }

export async function createTask(formData: FormData) {
  const session = await requireWriteAccess("tasks:manage");
  try {
    const data = taskSchema.parse(Object.fromEntries(formData));
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "tasks:manage");
      await assertAssignee(tx, data.assigneeId);
      if (data.ninjaId && !await tx.ninjaProfile.findUnique({ where: { id: data.ninjaId }, select: { id: true } })) throw new Error("VALIDATION:Dossier introuvable");
      if (data.reportId && !await tx.agentReport.findFirst({ where: { id: data.reportId, OR: [{ authorId: session.userId }, { status: { not: "DRAFT" } }] }, select: { id: true } })) throw new Error("FORBIDDEN");
      const task = await tx.followUpTask.create({ data: { ...data, dueAt: data.dueAt ? reportDayBoundary(data.dueAt, true) : null, createdById: session.userId, transitions: { create: { actorId: session.userId, toStatus: "TODO", reason: "Création de la tâche" } } } });
      await tx.assignmentHistory.create({ data: { taskId: task.id, assignedAgentId: data.assigneeId, actorId: session.userId, reason: "Affectation initiale" } });
      if (task.assigneeId) await notifyInternal(tx, { userId: task.assigneeId, title: "Nouvelle tâche", body: task.title, href: `/taches?id=${task.id}`, dedupeKey: `task:${task.id}:assigned:1` });
      await writeAudit(tx, { actorId: session.userId, action: "TASK_CREATED", entityType: "FollowUpTask", entityId: task.id });
    });
  } catch (error) { return fail(error); }
  redirect("/taches");
}

export async function transitionTask(formData: FormData) {
  const session = await requireWriteAccess("tasks:read");
  try {
    const data = z.object({ taskId: z.string().min(1), version: z.coerce.number().int().positive(), status: z.enum(TASK_STATUSES), reason: z.string().trim().max(4000) }).parse(Object.fromEntries(formData));
    await prisma.$transaction(async (tx) => {
      const actor = await assertTeamActor(tx, session.userId, "tasks:read");
      const task = await tx.followUpTask.findUnique({ where: { id: data.taskId } });
      if (!task) throw new Error("FORBIDDEN");
      const manager = actor.roles.some(({ role }) => can(role.code, "tasks:manage"));
      assertTaskTransition({ from: task.status as TaskStatus, to: data.status, manager, assignedToActor: task.assigneeId === session.userId, reason: data.reason });
      const result = await tx.followUpTask.updateMany({ where: { id: task.id, version: data.version }, data: { status: data.status, resolution: ["DONE", "CANCELLED"].includes(data.status) ? data.reason : null, version: { increment: 1 } } });
      if (result.count !== 1) throw new Error("VALIDATION:Tâche modifiée entre-temps. Rechargez la page");
      await tx.taskTransition.create({ data: { taskId: task.id, actorId: session.userId, fromStatus: task.status, toStatus: data.status, reason: data.reason || null } });
      await writeAudit(tx, { actorId: session.userId, action: "TASK_TRANSITION", entityType: "FollowUpTask", entityId: task.id, reason: data.reason });
    });
  } catch (error) { return fail(error); }
  redirect("/taches");
}

export async function updateTaskAssignment(formData: FormData) {
  const session = await requireWriteAccess("tasks:manage");
  try {
    const data = z.object({ taskId: z.string().min(1), version: z.coerce.number().int().positive(), assigneeId: optionalId, priority: z.enum(["LOW", "NORMAL", "HIGH"]), dueAt: z.string().optional(), reason: z.string().trim().min(5).max(1000) }).parse(Object.fromEntries(formData));
    await prisma.$transaction(async (tx) => {
      await assertTeamActor(tx, session.userId, "tasks:manage");
      await assertAssignee(tx, data.assigneeId);
      const task = await tx.followUpTask.findUnique({ where: { id: data.taskId } });
      if (!task) throw new Error("FORBIDDEN");
      const updated = await tx.followUpTask.updateMany({ where: { id: task.id, version: data.version }, data: { assigneeId: data.assigneeId, priority: data.priority, dueAt: data.dueAt ? reportDayBoundary(data.dueAt, true) : null, version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("VALIDATION:Tâche modifiée entre-temps");
      await tx.assignmentHistory.create({ data: { taskId: task.id, previousAgentId: task.assigneeId, assignedAgentId: data.assigneeId, actorId: session.userId, reason: data.reason } });
      if (data.assigneeId) await notifyInternal(tx, { userId: data.assigneeId, title: "Tâche mise à jour", body: task.title, href: `/taches?id=${task.id}`, dedupeKey: `task:${task.id}:assigned:${data.version + 1}` });
      await writeAudit(tx, { actorId: session.userId, action: "TASK_ASSIGNED", entityType: "FollowUpTask", entityId: task.id, reason: data.reason });
    });
  } catch (error) { return fail(error); }
  redirect("/taches");
}
