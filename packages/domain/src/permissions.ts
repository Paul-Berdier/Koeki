export const ROLES = ["SUPER_ADMIN", "KOEKI_MANAGER", "ECONOMIC_AGENT", "NINJA", "AUDITOR"] as const;
export type Role = typeof ROLES[number];
export type Permission = "users:manage" | "settings:manage" | "ninjas:write" | "taxes:write" | "payments:write" | "inventory:write" | "reports:write" | "audit:read" | "self:read";
const matrix: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(["users:manage","settings:manage","ninjas:write","taxes:write","payments:write","inventory:write","reports:write","audit:read","self:read"]),
  KOEKI_MANAGER: new Set(["settings:manage","ninjas:write","taxes:write","payments:write","inventory:write","reports:write","audit:read","self:read"]),
  ECONOMIC_AGENT: new Set(["payments:write","inventory:write","reports:write","self:read"]), NINJA: new Set(["self:read"]), AUDITOR: new Set(["audit:read","self:read"])
};
export function can(role: Role, permission: Permission) { return matrix[role].has(permission); }
export function assertPermission(role: Role, permission: Permission) { if (!can(role, permission)) throw new Error("FORBIDDEN"); }
