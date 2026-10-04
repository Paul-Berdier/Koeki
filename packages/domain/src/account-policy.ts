import { canAny, type Role } from "./permissions";

export interface AccessAccount { id: string; roles: readonly Role[]; revokedAt: Date | null; connectable?: boolean }
export type AccountOperation = "revoke" | "reactivate" | "roles";
export const isLeadershipRole = (role: string) => role === "SUPER_ADMIN" || role === "KOEKI_MANAGER";

/** Called again from inside the serialized mutation, never trusted from a form. */
export function assertAccountChange(input: {
  actor: AccessAccount; target: AccessAccount; operation: AccountOperation;
  requestedRoles?: readonly Role[]; activeSuperAdmins: number;
}) {
  const { actor, target, operation, activeSuperAdmins } = input;
  if (actor.revokedAt || !canAny(actor.roles, `users:${operation}`)) throw new Error("Accès refusé");
  if (operation === "revoke" && actor.id === target.id) throw new Error("Impossible de désactiver votre propre accès");
  if (!canAny(actor.roles, "users:leadership") && target.roles.some(isLeadershipRole)) throw new Error("Seul un super-administrateur peut modifier un compte dirigeant");
  const requested = input.requestedRoles ?? target.roles;
  if (operation === "roles" && requested.length === 0) throw new Error("Conservez au moins un rôle ; utilisez la désactivation pour retirer l’accès");
  if (!canAny(actor.roles, "users:leadership") && requested.some(isLeadershipRole)) throw new Error("Seul un super-administrateur peut attribuer un rôle dirigeant");
  if (operation === "roles" && target.revokedAt) throw new Error("Réactivez explicitement ce compte avant de modifier ses rôles");
  const removesSuper = operation === "revoke" || (operation === "roles" && !requested.includes("SUPER_ADMIN"));
  if (!target.revokedAt && target.connectable !== false && target.roles.includes("SUPER_ADMIN") && removesSuper && activeSuperAdmins <= 1) throw new Error("Le dernier super-administrateur actif doit être conservé");
}

export function assertInvitationRole(actor: AccessAccount, role: Role) {
  if (actor.revokedAt || !canAny(actor.roles, "users:roles")) throw new Error("Accès refusé");
  if (isLeadershipRole(role) && !canAny(actor.roles, "users:leadership")) throw new Error("Seul un super-administrateur peut inviter un dirigeant");
}
