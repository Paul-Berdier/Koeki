import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import { canAny, type Role } from "@koeki/domain";
import type { SessionInfo } from "./session";
import { createTestResource, createTestUser, ensureReferential } from "./test-fixtures";
import { getResourceValues, resourceValuesRevision, resourceValuesSchema, saveResourceValues } from "./resource-values";

vi.mock("./session", () => ({
  demoMode: false,
  hasPermission: (session: SessionInfo, permission: Parameters<typeof canAny>[1]) => canAny(session.roles, permission),
}));

const form = { resourceId: "fixture", revision: "a".repeat(64), price: "240", pointsPerUnit: "3", exemptionPerUnit: "18", demand: "NEEDED", reason: "Révision du barème de test" };
describe("resource value input", () => {
  it.each(["-1", "1.5", "NaN", "9007199254740993"])("rejects invalid prices (%s)", (price) => {
    expect(resourceValuesSchema.safeParse({ ...form, price }).success).toBe(false);
  });
  it("supports explicitly zero values and an undefined initial price", () => {
    expect(resourceValuesSchema.parse({ ...form, price: "0", pointsPerUnit: "0", exemptionPerUnit: "0" })).toMatchObject({ price: 0, pointsPerUnit: 0, exemptionPerUnit: 0 });
    expect(resourceValuesSchema.parse({ ...form, price: "" }).price).toBe("");
  });
});

describe.skipIf(!inject("dbReady"))("resource value editing (PostgreSQL)", () => {
  let refs: Awaited<ReturnType<typeof ensureReferential>>;
  let manager: SessionInfo, agent: SessionInfo;
  async function identity(role: Role): Promise<SessionInfo> {
    const user = await createTestUser(`Valeurs ${role} ${randomUUID()}`);
    const record = await prisma.role.upsert({ where: { code: role }, create: { code: role, label: role }, update: {} });
    await prisma.userRole.create({ data: { userId: user.id, roleId: record.id } });
    return { userId: user.id, name: user.name!, roles: [role] };
  }
  beforeAll(async () => { refs = await ensureReferential(); manager = await identity("KOEKI_MANAGER"); agent = await identity("ECONOMIC_AGENT"); });

  it("updates only the requested scale and preserves stock and old price snapshots", async () => {
    const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.unite.id });
    const old = await prisma.resourcePriceHistory.create({ data: { resourceId: resource.id, pricePerUnit: 100n, effectiveFrom: new Date("2020-01-01"), createdById: manager.userId } });
    const input = { ...form, resourceId: resource.id, revision: resourceValuesRevision(resource, 100n) };
    expect(await saveResourceValues(manager, input)).toEqual({ changed: true });
    const updated = await prisma.resource.findUniqueOrThrow({ where: { id: resource.id } });
    expect(updated).toMatchObject({ pointsPerUnit: 3, exemptionPerUnit: 18n, demand: "NEEDED", categoryId: resource.categoryId, unitId: resource.unitId });
    expect(updated.currentQuantity.toString()).toBe(resource.currentQuantity.toString());
    expect(await prisma.inventoryMovement.count({ where: { resourceId: resource.id } })).toBe(0);
    const preceding = await prisma.resourcePriceHistory.findUniqueOrThrow({ where: { id: old.id } });
    expect(preceding.pricePerUnit).toBe(100n);
    expect(preceding.effectiveTo).not.toBeNull();
    expect(await prisma.resourcePriceHistory.findFirst({ where: { resourceId: resource.id, effectiveTo: null } })).toMatchObject({ pricePerUnit: 240n, createdById: manager.userId });
    expect(await prisma.auditLog.count({ where: { entityId: resource.id, action: "RESOURCE_VALUES_UPDATED", reason: form.reason } })).toBe(1);
    await expect(saveResourceValues(manager, { ...input, price: "999" })).rejects.toThrow(/ont changé/);
    const fresh = await getResourceValues(manager, { resourceId: resource.id });
    expect(fresh.resources[0]).toMatchObject({ price: 240n, pointsPerUnit: 3, exemptionPerUnit: 18n });
    expect(await saveResourceValues(manager, { ...input, revision: fresh.resources[0]!.revision })).toEqual({ changed: false });
  });

  it("serializes competing scale edits instead of silently overwriting a manager", async () => {
    const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.unite.id });
    const input = { ...form, resourceId: resource.id, revision: resourceValuesRevision(resource, null) };
    const attempts = await Promise.allSettled([saveResourceValues(manager, { ...input, price: "100" }), saveResourceValues(manager, { ...input, price: "200" })]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.resourcePriceHistory.count({ where: { resourceId: resource.id, effectiveTo: null } })).toBe(1);
  });

  it("blocks ordinary agents and stale manager grants without changing resources", async () => {
    const resource = await createTestResource({ categoryId: refs.category.id, unitId: refs.unite.id });
    const input = { ...form, resourceId: resource.id, revision: resourceValuesRevision(resource, null) };
    await expect(saveResourceValues(agent, input)).rejects.toThrow("FORBIDDEN");
    await expect(getResourceValues(agent)).rejects.toThrow("FORBIDDEN");
    const stale = await identity("KOEKI_MANAGER");
    await prisma.user.update({ where: { id: stale.userId }, data: { revokedAt: new Date() } });
    await expect(saveResourceValues(stale, input)).rejects.toThrow();
    expect(await prisma.resourcePriceHistory.count({ where: { resourceId: resource.id } })).toBe(0);
  });
});
