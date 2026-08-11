export const ROLES = ["SUPER_ADMIN", "KOEKI_MANAGER", "ECONOMIC_AGENT", "NINJA", "AUDITOR"] as const;
export type Role = typeof ROLES[number];
export type Permission = "users:manage" | "settings:manage" | "ninjas:write" | "taxes:write" | "payments:write" | "inventory:write" | "reports:read" | "reports:read-all" | "reports:write" | "reports:review" | "audit:read" | "self:read";
const matrix: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(["users:manage","settings:manage","ninjas:write","taxes:write","payments:write","inventory:write","reports:read","reports:read-all","reports:write","reports:review","audit:read","self:read"]),
  KOEKI_MANAGER: new Set(["settings:manage","ninjas:write","taxes:write","payments:write","inventory:write","reports:read","reports:read-all","reports:write","reports:review","audit:read","self:read"]),
  // Launch phase: economic agents handle daily operations, but report review and
  // account revocation stay reserved to managers and super-administrators.
  ECONOMIC_AGENT: new Set(["settings:manage","ninjas:write","taxes:write","payments:write","inventory:write","reports:read","reports:write","audit:read","self:read"]),
  NINJA: new Set(["self:read"]), AUDITOR: new Set(["reports:read","reports:read-all","audit:read","self:read"])
};
export function can(role: Role, permission: Permission) { return matrix[role].has(permission); }
export function assertPermission(role: Role, permission: Permission) { if (!can(role, permission)) throw new Error("FORBIDDEN"); }
