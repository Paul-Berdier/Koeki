"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@koeki/database";
import { requireWriteAccess } from "@/lib/session";
import { claimExactProfile } from "@/lib/profile-claim";

export async function confirmOwnProfile(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const session = await requireWriteAccess("self:read");
  let id: string;
  try {
    id = await claimExactProfile(session.userId, form.get("ninjaRef"), form.get("confirmIdentity") === "on");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) return { error: "La fiche ou le compte a changé. Rechargez la page pour vérifier votre sélection." };
    return { error: error instanceof Error ? error.message : "Rattachement impossible : aucune modification validée." };
  }
  // Keep redirect outside catch and refresh the authenticated shell as well.
  revalidatePath("/", "layout");
  redirect(`/ninjas/${encodeURIComponent(id)}`);
}
