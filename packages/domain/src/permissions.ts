export const ROLES = ["SUPER_ADMIN", "KOEKI_MANAGER", "ECONOMIC_AGENT", "NINJA", "AUDITOR"] as const;
export type Role = typeof ROLES[number];
export type Permission =
  | "users:manage" | "settings:manage" | "ninjas:write" | "taxes:write" | "payments:write"
  // Inventory: read the register, record entries/exits, run physical counts, adjust/correct
  // (including the audited negative-stock override), manage the catalog (resources,
  // categories, units, thresholds), export CSV.
  | "inventory:read" | "inventory:write" | "inventory:count" | "inventory:adjust" | "inventory:catalog" | "inventory:export"
  | "reports:read" | "reports:read-all" | "reports:write" | "reports:review" | "audit:read" | "self:read";
const INVENTORY_ALL: Permission[] = ["inventory:read", "inventory:write", "inventory:count", "inventory:adjust", "inventory:catalog", "inventory:export"];
const matrix: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set<Permission>(["users:manage","settings:manage","ninjas:write","taxes:write","payments:write",...INVENTORY_ALL,"reports:read","reports:read-all","reports:write","reports:review","audit:read","self:read"]),
  KOEKI_MANAGER: new Set<Permission>(["settings:manage","ninjas:write","taxes:write","payments:write",...INVENTORY_ALL,"reports:read","reports:read-all","reports:write","reports:review","audit:read","self:read"]),
  // Economic agents handle daily operations only: value scales (resource points,
  // exemptions, catalog prices, tax rates, events, recipes) and administration
  // stay reserved to managers and super-administrators via settings:manage.
  // In the inventory they see, record entries/exits and export; counts, adjustments,
  // corrections and the catalog stay with managers.
  ECONOMIC_AGENT: new Set<Permission>(["ninjas:write","taxes:write","payments:write","inventory:read","inventory:write","inventory:export","reports:read","reports:write","audit:read","self:read"]),
  NINJA: new Set<Permission>(["self:read"]),
  AUDITOR: new Set<Permission>(["inventory:read","inventory:export","reports:read","reports:read-all","audit:read","self:read"])
};
export function can(role: Role, permission: Permission) { return matrix[role].has(permission); }
export function assertPermission(role: Role, permission: Permission) { if (!can(role, permission)) throw new Error("FORBIDDEN"); }
