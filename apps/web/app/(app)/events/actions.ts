"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@koeki/database";
import { lockActiveNinja, writeAudit } from "@/lib/finance";
import { requireWriteAccess } from "@/lib/session";

const eventSchema = z.object({
  name: z.string().trim().min(2, "Le nom est obligatoire").max(120),
  kind: z.enum(["TOURNOI", "THEATRE", "JEU", "AUTRE"]),
  description: z.string().trim().max(1000).optional().transform((value) => value || null),
  resourceFocus: z.string().trim().max(120).optional().transform((value) => value || null),
  startsAt: z.coerce.date(),
  endsAt: z.union([z.literal(""), z.coerce.date()]).optional().transform((value) => (value instanceof Date ? value : null)),
  prize: z.coerce.number().int().min(0).max(100_000_000).default(0),
  rewardPoints: z.coerce.number().int().min(0).max(1_000_000).default(0)
});

export async function createEvent(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/events?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const data = parsed.data!;
  if (data.endsAt && data.endsAt < data.startsAt) back("La fin doit suivre le début");
  await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({ data: { ...data, prize: BigInt(data.prize), status: data.startsAt > new Date() ? "PLANNED" : "OPEN", createdById: session.userId } });
    await writeAudit(tx, { actorId: session.userId, action: "EVENT_CREATED", entityType: "Event", entityId: event.id, newValues: { name: data.name, kind: data.kind, prize: data.prize, rewardPoints: data.rewardPoints } });
  });
  redirect("/events");
}

const finishSchema = z.object({
  eventId: z.string().min(1, "Sélectionnez un événement"),
  winnerId: z.string().optional().transform((value) => value || null),
  participants: z.coerce.number().int().min(0).max(100_000).default(0)
});

export async function finishEvent(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const parsed = finishSchema.safeParse(Object.fromEntries(formData));
  const back = (message: string): never => redirect(`/events?erreur=${encodeURIComponent(message)}`);
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? "Saisie invalide");
  const { eventId, winnerId, participants } = parsed.data!;
  await prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || (event.status !== "OPEN" && event.status !== "PLANNED")) throw new Error("VALIDATION:Événement introuvable ou déjà clôturé");
    if (winnerId && !await lockActiveNinja(tx, winnerId)) throw new Error("VALIDATION:Le vainqueur sélectionné n’est plus actif");
    const winner = winnerId ? await tx.ninjaProfile.findUnique({ where: { id: winnerId } }) : null;
    if (winnerId && !winner) throw new Error("VALIDATION:Vainqueur introuvable");
    const finished = await tx.event.updateMany({
      where: { id: eventId, status: { in: ["OPEN", "PLANNED"] } },
      data: { status: "FINISHED", winnerId, participantCount: participants || event.participantCount, endsAt: event.endsAt ?? new Date() }
    });
    if (finished.count !== 1) throw new Error("VALIDATION:Événement déjà traité");
    if (winner && event.rewardPoints > 0) {
      const existing = await tx.pointLedgerEntry.findUnique({ where: { sourceType_sourceId_eventType: { sourceType: "Event", sourceId: event.id, eventType: "SPECIAL_EVENT" } } });
      if (!existing) await tx.pointLedgerEntry.create({ data: { ninjaId: winner.id, eventType: "SPECIAL_EVENT", points: event.rewardPoints, sourceType: "Event", sourceId: event.id, reason: `Vainqueur — ${event.name}` } });
    }
    await writeAudit(tx, { actorId: session.userId, action: "EVENT_FINISHED", entityType: "Event", entityId: eventId, reason: winner ? `Vainqueur : ${winner.firstName} ${winner.lastName} (${Number(event.prize)} Ryō, ${event.rewardPoints} pts)` : "Clôturé sans vainqueur", newValues: { winnerId, participants } });
  }).catch((error) => {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) back(error.message.slice("VALIDATION:".length));
    throw error;
  });
  redirect("/events");
}

export async function cancelEvent(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  const eventId = formData.get("eventId");
  if (typeof eventId !== "string" || !eventId) redirect("/events");
  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.event.updateMany({ where: { id: eventId as string, status: { in: ["OPEN", "PLANNED"] } }, data: { status: "CANCELLED" } });
    if (cancelled.count === 1) await writeAudit(tx, { actorId: session.userId, action: "EVENT_CANCELLED", entityType: "Event", entityId: eventId as string });
  });
  redirect("/events");
}
