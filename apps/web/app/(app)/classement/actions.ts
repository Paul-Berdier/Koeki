"use server";
import { redirect } from "next/navigation";
import { publishRanking, prisma } from "@koeki/database";
import { requireWriteAccess } from "@/lib/session";

export async function closeRanking(form: FormData) {
  const actor = await requireWriteAccess("ranking:manage");
  const weekKey = String(form.get("week") ?? ""), reason = String(form.get("reason") ?? "").trim(), rawVersion = String(form.get("version") ?? "");
  try {
    await publishRanking(prisma, { weekKey, actorId: actor.userId, ...(reason ? { correctionReason: reason } : {}), ...(rawVersion ? { expectedVersion: Number(rawVersion) } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "La clôture n’a pas abouti";
    redirect(`/classement?semaine=${encodeURIComponent(weekKey)}&erreur=${encodeURIComponent(message)}`);
  }
  redirect(`/classement?semaine=${encodeURIComponent(weekKey)}&succes=1`);
}
