"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWriteAccess } from "@/lib/session";
import { saveResourceValues } from "@/lib/resource-values";

export async function updateValues(formData: FormData) {
  const session = await requireWriteAccess("settings:manage");
  let result;
  try {
    result = await saveResourceValues(session, Object.fromEntries(formData));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message ?? "Saisie invalide"
      : error instanceof Error && error.message.startsWith("VALIDATION:") ? error.message.slice(11)
      : "Modification refusée. Rechargez la page ou contactez un responsable.";
    redirect(`/resources/valeurs?erreur=${encodeURIComponent(message)}`);
  }
  revalidatePath("/resources", "layout");
  revalidatePath("/inventory", "layout");
  revalidatePath("/dons");
  redirect(`/resources/valeurs?info=${encodeURIComponent(result.changed ? "Valeurs enregistrées. Elles s’appliqueront aux prochaines opérations." : "Les valeurs sont déjà à jour.")}`);
}
