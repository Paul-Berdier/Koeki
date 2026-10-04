import { describe, expect, it } from "vitest";
import { assertAccountChange, assertInvitationRole, type AccessAccount } from "./account-policy";
import { can, canAny, ROLES, type Role } from "./permissions";

const account = (id: string, roles: Role[], revokedAt: Date | null = null): AccessAccount => ({ id, roles, revokedAt });
const manager = account("manager", ["KOEKI_MANAGER"]);
const ordinary = account("ordinary", ["ECONOMIC_AGENT", "NINJA"]);
const superAdmin = account("super", ["SUPER_ADMIN"]);
const change = (overrides: Partial<Parameters<typeof assertAccountChange>[0]> = {}) => assertAccountChange({ actor: manager, target: ordinary, operation: "revoke", activeSuperAdmins: 2, ...overrides });

describe("V2 access matrix and account boundaries", () => {
  it.each(ROLES)("restricts complete audit and confidential team data for %s", (role) => {
    const leader = role === "SUPER_ADMIN" || role === "KOEKI_MANAGER";
    for (const permission of ["audit:read", "team:read", "team:notes", "users:read", "users:revoke"] as const) expect(can(role, permission)).toBe(leader);
    expect(can(role, "users:manage")).toBe(role === "SUPER_ADMIN");
    expect(can(role, "users:leadership")).toBe(role === "SUPER_ADMIN");
  });
  it("unions every role while retaining the auditor's explicit business reads", () => {
    expect(canAny(["NINJA", "KOEKI_MANAGER"], "audit:read")).toBe(true);
    expect(canAny(["ECONOMIC_AGENT", "AUDITOR"], "audit:read")).toBe(false);
    for (const permission of ["business:read", "statistics:read", "inventory:read", "reports:read-all"] as const) expect(can("AUDITOR", permission)).toBe(true);
    expect(can("ECONOMIC_AGENT", "ranking:read")).toBe(true);
    expect(can("AUDITOR", "ranking:read")).toBe(false);
  });
  it("allows managers to disable and reactivate ordinary accounts", () => {
    expect(() => change()).not.toThrow();
    expect(() => change({ operation: "reactivate", target: { ...ordinary, revokedAt: new Date() } })).not.toThrow();
  });
  it.each(["revoke", "roles", "reactivate"] as const)("protects all leadership roles against manager %s", (operation) => {
    for (const role of ["SUPER_ADMIN", "KOEKI_MANAGER"] as const) expect(() => change({ operation, target: account("leader", ["NINJA", role]), requestedRoles: ["NINJA"] })).toThrow(/dirigeant/);
  });
  it("rejects forged leadership grants and invitations", () => {
    for (const role of ["SUPER_ADMIN", "KOEKI_MANAGER"] as const) {
      expect(() => change({ operation: "roles", requestedRoles: ["NINJA", role] })).toThrow(/dirigeant/);
      expect(() => assertInvitationRole(manager, role)).toThrow(/dirigeant/);
      expect(() => assertInvitationRole(superAdmin, role)).not.toThrow();
    }
  });
  it("rejects a revoked actor, self revocation, a roleless account and edits of disabled roles", () => {
    expect(() => change({ actor: { ...manager, revokedAt: new Date() } })).toThrow(/refusé/);
    expect(() => change({ actor: superAdmin, target: superAdmin })).toThrow(/propre/);
    expect(() => change({ operation: "roles", requestedRoles: [] })).toThrow(/au moins/);
    expect(() => change({ operation: "roles", target: { ...ordinary, revokedAt: new Date() }, requestedRoles: ["NINJA"] })).toThrow(/Réactivez/);
  });
  it("preserves the last active super administrator for revocation and demotion", () => {
    const secondSuper = account("second", ["SUPER_ADMIN"]);
    expect(() => change({ actor: superAdmin, target: secondSuper, activeSuperAdmins: 1 })).toThrow(/dernier/);
    expect(() => change({ actor: superAdmin, target: secondSuper, operation: "roles", requestedRoles: ["NINJA"], activeSuperAdmins: 1 })).toThrow(/dernier/);
    expect(() => change({ actor: superAdmin, target: secondSuper, activeSuperAdmins: 2 })).not.toThrow();
  });
});
