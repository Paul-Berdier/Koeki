import { can, type Role } from "@koeki/domain";

/** Union of every role; shared by the shell and permission regression tests. */
export function allowedNavigation(roles: Role[]): string[] {
  const permits = (permission: Parameters<typeof can>[1]) =>
    roles.some((role) => can(role, permission));
  const routes = [
    "/",
    "/profil",
    "/resources",
    "/dons",
    "/crafting",
    "/events",
    "/notifications",
  ];
  if (permits("business:read"))
    routes.push("/operations", "/ninjas", "/recouvrement", "/equipement");
  if (permits("inventory:write")) routes.push("/resources/transaction");
  if (permits("inventory:read"))
    routes.push("/inventory", "/inventory/movements");
  if (permits("inventory:count")) routes.push("/inventory/counts");
  if (permits("statistics:read")) routes.push("/statistics");
  if (permits("reports:read")) routes.push("/reports");
  if (permits("tasks:read")) routes.push("/taches");
  if (permits("ranking:read")) routes.push("/classement");
  if (permits("team:read")) routes.push("/equipe");
  if (permits("audit:read")) routes.push("/audit");
  if (permits("settings:manage")) routes.push("/admin");
  if (permits("users:read")) routes.push("/admin/comptes");
  return routes;
}
