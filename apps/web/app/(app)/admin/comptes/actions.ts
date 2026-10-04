"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES } from "@koeki/domain";
import { changeAccount } from "@/lib/account-service";
import { requireWriteAccess } from "@/lib/session";

export type AccountActionState = { ok: boolean; message: string } | null;
const schema = z.object({ userId: z.string().min(1), operation: z.enum(["revoke", "reactivate", "roles", "remove-agent"]), reason: z.string().trim().min(3, "Précisez un motif d’au moins 3 caractères").max(1000), replacementAgentId: z.string().optional() });

export async function accountAction(_previous: AccountActionState, data: FormData): Promise<AccountActionState> {
  const parsed = schema.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const { operation, userId, reason, replacementAgentId } = parsed.data;
  try {
    const session = await requireWriteAccess(operation === "revoke" ? "users:revoke" : operation === "reactivate" ? "users:reactivate" : "users:roles");
    const roles = ROLES.filter((role) => data.get(`role_${role}`) === "on");
    const result = await changeAccount({ actorId: session.userId, targetId: userId, operation, reason, roles, replacementAgentId: replacementAgentId || null });
    revalidatePath("/", "layout");
    return { ok: true, message: result.changed ? operation === "revoke" ? "Accès désactivé ; anciennes sessions invalidées." : operation === "reactivate" ? "Accès réactivé ; une nouvelle connexion est nécessaire." : "Rôles mis à jour ; historique conservé." : "La demande est déjà appliquée." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "La modification n’a pas abouti" };
  }
}
