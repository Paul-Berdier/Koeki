import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { prisma } from "@koeki/database";
import type { Permission, Role } from "@koeki/domain";
import { cachedQuantity, createTestNinja, createTestResource, createTestUser, ensureReferential, ledgerSum } from "@/lib/test-fixtures";

// The server actions are exercised end to end (FormData → validation → ledger → audit) with the
// session and Next.js cache invalidation replaced by test doubles. Roles are switched per test to
// check the permission matrix: a plain agent moves stock, only a manager adjusts or corrects.
const sessionState = { userId: "", roles: ["ECONOMIC_AGENT"] as string[] };
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const { can } = await import("@koeki/domain");
  const session = () => ({ userId: sessionState.userId, name: "Agent Test", roles: sessionState.roles as Role[] });
  const has = (permission: Permission) => sessionState.roles.some((role) => can(role as Role, permission));
  return {
    demoMode: false,
    getSession: async () => session(),
    requireSession: async () => session(),
    hasPermission: (_session: unknown, permission: Permission) => has(permission),
    requirePermission: async (permission: Permission) => { if (!has(permission)) throw new Error("FORBIDDEN"); return session(); },
    requireWriteAccess: async (permission: Permission) => { if (!has(permission)) throw new Error("FORBIDDEN"); return session(); },
    roleLabels: {}
  };
});

const { recordAdjustment, recordManualMovement, reverseMovementAction } = await import("./actions");

const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.append(key, value); return data; };
const dbReady = inject("dbReady");

describe.skipIf(!dbReady)("inventory server actions (PostgreSQL)", () => {
  let ref: Awaited<ReturnType<typeof ensureReferential>>;
  let ninja: { id: string };
  let iron: { id: string; name: string };

  beforeAll(async () => {
    ref = await ensureReferential();
    const agent = await createTestUser("Agent Yuki");
    sessionState.userId = agent.id;
    ninja = await createTestNinja(ref.grade.id, "Aoki", "Hoki");
    iron = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id, name: "Fer (actions)" });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("agent scenario: search Fer, take 25 kg for Aoki, reason Fabrication — the ledger and the audit trail agree", async () => {
    sessionState.roles = ["ECONOMIC_AGENT"];
    const entry = await recordManualMovement(null, form({ resourceId: iron.id, direction: "in", quantity: "520", counterpartyMode: "none", reason: "Achat", idempotencyKey: randomUUID() }));
    expect(entry).toMatchObject({ ok: true });
    const exit = await recordManualMovement(null, form({ resourceId: iron.id, direction: "out", quantity: "25", counterpartyMode: "ninja", ninjaId: ninja.id, reason: "Fabrication", notes: "Kunai", idempotencyKey: randomUUID() }));
    expect(exit).toMatchObject({ ok: true });
    expect(exit && exit.ok ? exit.message : "").toMatch(/−25 kg.*nouveau stock 495 kg/);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: iron.id, type: "OUT" } });
    expect(movement).toMatchObject({ agentId: sessionState.userId, counterpartyType: "NINJA", counterpartyNinjaId: ninja.id, counterpartyLabel: "Aoki Hoki", reason: "Fabrication", notes: "Kunai" });
    expect(Number(movement.quantityBefore)).toBe(520);
    expect(Number(movement.quantityAfter)).toBe(495);
    expect(await ledgerSum(iron.id)).toBe(495);
    expect(await cachedQuantity(iron.id)).toBe(495);
    const audit = await prisma.auditLog.findFirst({ where: { action: "INVENTORY_OUT", entityId: movement.id } });
    expect(audit?.actorId).toBe(sessionState.userId);
  });

  it("an exit requires who took the goods and a reason, and refuses insufficient stock", async () => {
    sessionState.roles = ["ECONOMIC_AGENT"];
    expect(await recordManualMovement(null, form({ resourceId: iron.id, direction: "out", quantity: "5", counterpartyMode: "none", reason: "Mission", idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, error: expect.stringMatching(/qui a pris/) });
    expect(await recordManualMovement(null, form({ resourceId: iron.id, direction: "out", quantity: "5", counterpartyMode: "external", counterpartyLabel: "Marchand", reason: "", idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, error: expect.stringMatching(/motif/) });
    expect(await recordManualMovement(null, form({ resourceId: iron.id, direction: "out", quantity: "9999", counterpartyMode: "external", counterpartyLabel: "Marchand", reason: "Vente", idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, error: expect.stringMatching(/Stock insuffisant/) });
    expect(await recordManualMovement(null, form({ resourceId: iron.id, direction: "out", quantity: "1,5555", counterpartyMode: "external", counterpartyLabel: "Marchand", reason: "Vente", idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, error: expect.stringMatching(/décimale/) });
    expect(await cachedQuantity(iron.id)).toBe(495);
  });

  it("a plain agent cannot force a negative stock, adjust or correct; a manager can", async () => {
    sessionState.roles = ["ECONOMIC_AGENT"];
    expect(await recordManualMovement(null, form({ resourceId: iron.id, direction: "out", quantity: "9999", counterpartyMode: "external", counterpartyLabel: "X", reason: "Perte", notes: "forcé", allowNegative: "on", idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, error: expect.stringMatching(/responsable/) });
    expect(await recordAdjustment(null, form({ resourceId: iron.id, quantity: "1", sign: "-", reason: "Casse", idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, error: "Accès refusé" });
    const exit = await prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: iron.id, type: "OUT" } });
    expect(await reverseMovementAction(null, form({ movementId: exit.id, reason: "Erreur", idempotencyKey: randomUUID() }))).toMatchObject({ ok: false, error: "Accès refusé" });

    sessionState.roles = ["KOEKI_MANAGER"];
    expect(await recordAdjustment(null, form({ resourceId: iron.id, quantity: "5", sign: "-", reason: "Casse constatée en rayon", idempotencyKey: randomUUID() }))).toMatchObject({ ok: true });
    expect(await cachedQuantity(iron.id)).toBe(490);
    const reversal = await reverseMovementAction(null, form({ movementId: exit.id, reason: "Erreur de saisie — mauvais ninja", idempotencyKey: randomUUID() }));
    expect(reversal).toMatchObject({ ok: true });
    expect(await cachedQuantity(iron.id)).toBe(515);
    const stored = await prisma.inventoryMovement.findFirstOrThrow({ where: { reversedMovementId: exit.id } });
    expect(stored.type).toBe("REVERSAL");
    expect(Number(stored.quantity)).toBe(25);
    const audit = await prisma.auditLog.findFirst({ where: { action: "INVENTORY_REVERSED", entityId: exit.id } });
    expect(audit).not.toBeNull();
  });

  it("refuses a replayed idempotency key and reports it as a double submission", async () => {
    sessionState.roles = ["ECONOMIC_AGENT"];
    const key = randomUUID();
    expect(await recordManualMovement(null, form({ resourceId: iron.id, direction: "in", quantity: "1", counterpartyMode: "none", reason: "Retour", idempotencyKey: key }))).toMatchObject({ ok: true });
    expect(await recordManualMovement(null, form({ resourceId: iron.id, direction: "in", quantity: "1", counterpartyMode: "none", reason: "Retour", idempotencyKey: key }))).toMatchObject({ ok: false, error: expect.stringMatching(/double soumission/) });
    const returned = await prisma.inventoryMovement.findFirst({ where: { resourceId: iron.id, type: "RETURN_IN" } });
    expect(returned).not.toBeNull();
  });
});
