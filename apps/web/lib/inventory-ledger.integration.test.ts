import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Prisma, prisma } from "@koeki/database";
import { confirmStocktake, ledgerStock, openStocktake, reconcileInventory, recordMovement, resyncInventoryCache, reverseMovement } from "./inventory-ledger";
import { applyValidatedTransaction } from "./finance";
import { cachedQuantity, createTestNinja, createTestResource, createTestUser, ensureReferential, ledgerSum } from "./test-fixtures";

const dbReady = inject("dbReady");

describe.skipIf(!dbReady)("inventory ledger (PostgreSQL)", () => {
  let ref: Awaited<ReturnType<typeof ensureReferential>>;
  let agent: { id: string };
  let ninja: { id: string; firstName: string; lastName: string };

  beforeAll(async () => {
    ref = await ensureReferential();
    agent = await createTestUser("Yuki Sabaku");
    ninja = await createTestNinja(ref.grade.id, "Aoki", "Hoki");
  });
  afterAll(async () => { await prisma.$disconnect(); });

  describe("catalogue", () => {
    it("creates a resource with a unit and refuses a duplicate code", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id, name: "Fer test" });
      expect(resource.inventoryStatus).toBe("NOT_INVENTORIED");
      expect(Number(resource.currentQuantity)).toBe(0);
      await expect(prisma.resource.create({ data: { code: resource.code, name: "Doublon", categoryId: ref.category.id, unitId: ref.kg.id, minimumStock: 0, criticalStock: 0 } })).rejects.toMatchObject({ code: "P2002" });
    });
    it("refuses movements on a deactivated resource", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id, isActive: false });
      await expect(prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 5, agentId: agent.id, reason: "Test", idempotencyKey: randomUUID() }))).rejects.toThrow(/désactivée/);
    });
  });

  describe("initialisation", () => {
    it("keeps a fresh resource NOT_INVENTORIED, then a first count writes INITIAL_BALANCE even at zero", async () => {
      const iron = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id, name: "Fer initial" });
      const wool = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id, name: "Laine initiale" });
      const session = await prisma.$transaction((tx) => openStocktake(tx, { kind: "INITIAL", startedById: agent.id, counts: [{ resourceId: iron.id, counted: 520 }, { resourceId: wool.id, counted: 0 }] }));
      expect(session.status).toBe("OPEN");
      const result = await prisma.$transaction((tx) => confirmStocktake(tx, { sessionId: session.id, agentId: agent.id }));
      expect(result).toMatchObject({ counted: 2, movements: 2, adjusted: 0 });
      const [ironAfter, woolAfter, ironMovement, woolMovement] = await Promise.all([
        prisma.resource.findUniqueOrThrow({ where: { id: iron.id } }), prisma.resource.findUniqueOrThrow({ where: { id: wool.id } }),
        prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: iron.id } }), prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: wool.id } })
      ]);
      expect(ironAfter.inventoryStatus).toBe("COUNTED");
      expect(Number(ironAfter.currentQuantity)).toBe(520);
      expect(ironAfter.lastCountedAt).not.toBeNull();
      expect(ironMovement).toMatchObject({ type: "INITIAL_BALANCE", sourceType: "StocktakeSession", sourceId: session.id });
      expect(Number(ironMovement.quantityBefore)).toBe(0);
      expect(Number(ironMovement.quantityAfter)).toBe(520);
      // A verified zero is a real count: the resource is inventoried and the ledger keeps the proof.
      expect(woolAfter.inventoryStatus).toBe("COUNTED");
      expect(Number(woolAfter.currentQuantity)).toBe(0);
      expect(woolMovement.type).toBe("INITIAL_BALANCE");
      expect(Number(woolMovement.quantity)).toBe(0);
      // Confirming twice is refused.
      await expect(prisma.$transaction((tx) => confirmStocktake(tx, { sessionId: session.id, agentId: agent.id }))).rejects.toThrow(/déjà clôturé/);
    });
    it("uses the ledger sum as the starting point when movements already exist", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "BUYBACK_IN", quantity: 10, agentId: agent.id, reason: "Rachat", idempotencyKey: randomUUID() }));
      const session = await prisma.$transaction((tx) => openStocktake(tx, { kind: "INITIAL", startedById: agent.id, counts: [{ resourceId: resource.id, counted: 520 }] }));
      await prisma.$transaction((tx) => confirmStocktake(tx, { sessionId: session.id, agentId: agent.id }));
      const opening = await prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: resource.id, type: "INITIAL_BALANCE" } });
      expect(Number(opening.quantity)).toBe(510);
      expect(Number(opening.quantityBefore)).toBe(10);
      expect(Number(opening.quantityAfter)).toBe(520);
      expect(await ledgerSum(resource.id)).toBe(520);
      expect(await cachedQuantity(resource.id)).toBe(520);
    });
  });

  describe("entries and exits", () => {
    it("records an entry with before/after, agent, counterparty and reason", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      const recorded = await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 50, agentId: agent.id, reason: "Don", notes: "Livraison", counterparty: { type: "NINJA", ninjaId: ninja.id }, idempotencyKey: randomUUID() }));
      expect(Number(recorded.before)).toBe(0);
      expect(Number(recorded.after)).toBe(50);
      const movement = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: recorded.id } });
      expect(movement).toMatchObject({ agentId: agent.id, counterpartyType: "NINJA", counterpartyNinjaId: ninja.id, counterpartyLabel: "Aoki Hoki", reason: "Don", notes: "Livraison" });
      expect(await cachedQuantity(resource.id)).toBe(50);
    });
    it("records an exit taken by an external person and refuses to go below zero", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 10, agentId: agent.id, reason: "Achat", idempotencyKey: randomUUID() }));
      const exit = await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "OUT", quantity: -4, agentId: agent.id, reason: "Mission", counterparty: { type: "EXTERNAL", label: "Caravane du sud" }, idempotencyKey: randomUUID() }));
      expect(Number(exit.after)).toBe(6);
      await expect(prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "OUT", quantity: -15, agentId: agent.id, reason: "Mission", counterparty: { type: "EXTERNAL", label: "X" }, idempotencyKey: randomUUID() })))
        .rejects.toThrow(/Stock insuffisant.*disponible : 6 kg.*demandé : 15 kg/);
      expect(await ledgerSum(resource.id)).toBe(6);
      expect(await cachedQuantity(resource.id)).toBe(6);
    });
    it("allows a negative stock only with the explicit override", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      const forced = await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "OUT", quantity: -3, agentId: agent.id, reason: "Perte", allowNegative: true, idempotencyKey: randomUUID() }));
      expect(Number(forced.after)).toBe(-3);
      expect(await cachedQuantity(resource.id)).toBe(-3);
    });
    it("enforces the unit precision and refuses zero quantities", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      await expect(prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 1.5, agentId: agent.id, reason: "Don", idempotencyKey: randomUUID() }))).rejects.toThrow(/entières/);
      await expect(prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 0, agentId: agent.id, reason: "Don", idempotencyKey: randomUUID() }))).rejects.toThrow(/différente de zéro/);
      const kgResource = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      const recorded = await prisma.$transaction((tx) => recordMovement(tx, { resourceId: kgResource.id, type: "IN", quantity: "12.5", agentId: agent.id, reason: "Don", idempotencyKey: randomUUID() }));
      expect(Number(recorded.after)).toBe(12.5);
    });
    it("replays of the same idempotency key are rejected by the database", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      const key = randomUUID();
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 2, agentId: agent.id, reason: "Don", idempotencyKey: key }));
      await expect(prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 2, agentId: agent.id, reason: "Don", idempotencyKey: key }))).rejects.toMatchObject({ code: "P2002" });
      expect(await ledgerSum(resource.id)).toBe(2);
    });
  });

  describe("stocktake adjustments", () => {
    it("turns counted differences into signed adjustments and leaves exact counts untouched", async () => {
      const iron = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      const copper = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      const wood = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      for (const [resource, quantity] of [[iron, 520], [copper, 190], [wood, 350]] as const) {
        await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "INITIAL_BALANCE", quantity, agentId: agent.id, reason: "Inventaire initial", markCounted: true, idempotencyKey: randomUUID() }));
      }
      const session = await prisma.$transaction((tx) => openStocktake(tx, { kind: "COUNT", startedById: agent.id, counts: [{ resourceId: iron.id, counted: 500 }, { resourceId: copper.id, counted: 195 }, { resourceId: wood.id, counted: 350 }] }));
      expect(session.entries.map((entry) => Number(entry.difference)).sort()).toEqual([-20, 0, 5]);
      const result = await prisma.$transaction((tx) => confirmStocktake(tx, { sessionId: session.id, agentId: agent.id }));
      expect(result).toMatchObject({ counted: 3, movements: 2, adjusted: 2 });
      const [ironAdj, copperAdj, woodEntry] = await Promise.all([
        prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: iron.id, type: "ADJUSTMENT_OUT" } }),
        prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: copper.id, type: "ADJUSTMENT_IN" } }),
        prisma.stocktakeEntry.findUniqueOrThrow({ where: { sessionId_resourceId: { sessionId: session.id, resourceId: wood.id } } })
      ]);
      expect(Number(ironAdj.quantity)).toBe(-20);
      expect(Number(ironAdj.quantityBefore)).toBe(520);
      expect(Number(ironAdj.quantityAfter)).toBe(500);
      expect(Number(copperAdj.quantity)).toBe(5);
      expect(woodEntry.adjustmentMovementId).toBeNull();
      expect(await cachedQuantity(iron.id)).toBe(500);
      expect(await cachedQuantity(copper.id)).toBe(195);
      const archived = await prisma.stocktakeSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(archived.status).toBe("COMPLETED");
      expect(archived.completedAt).not.toBeNull();
    });
    it("recomputes the expected stock at confirmation time when the stock moved in between", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "INITIAL_BALANCE", quantity: 100, agentId: agent.id, reason: "Inventaire initial", markCounted: true, idempotencyKey: randomUUID() }));
      const session = await prisma.$transaction((tx) => openStocktake(tx, { kind: "COUNT", startedById: agent.id, counts: [{ resourceId: resource.id, counted: 90 }] }));
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "OUT", quantity: -30, agentId: agent.id, reason: "Mission", counterparty: { type: "EXTERNAL", label: "X" }, idempotencyKey: randomUUID() }));
      await prisma.$transaction((tx) => confirmStocktake(tx, { sessionId: session.id, agentId: agent.id }));
      const entry = await prisma.stocktakeEntry.findUniqueOrThrow({ where: { sessionId_resourceId: { sessionId: session.id, resourceId: resource.id } }, include: { adjustmentMovement: true } });
      expect(Number(entry.expectedQuantity)).toBe(70);
      expect(Number(entry.difference)).toBe(20);
      expect(entry.adjustmentMovement?.type).toBe("ADJUSTMENT_IN");
      expect(await cachedQuantity(resource.id)).toBe(90);
    });
  });

  describe("corrections", () => {
    it("reverses a line with an opposite REVERSAL, keeps the original and refuses a second reversal", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "INITIAL_BALANCE", quantity: 100, agentId: agent.id, reason: "Inventaire initial", markCounted: true, idempotencyKey: randomUUID() }));
      const wrong = await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "OUT", quantity: -20, agentId: agent.id, reason: "Fabrication", counterparty: { type: "NINJA", ninjaId: ninja.id }, idempotencyKey: randomUUID() }));
      const reversal = await prisma.$transaction((tx) => reverseMovement(tx, { movementId: wrong.id, agentId: agent.id, reason: "Erreur de saisie", idempotencyKey: randomUUID() }));
      expect(Number(reversal.quantity)).toBe(20);
      expect(Number(reversal.after)).toBe(100);
      const stored = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: reversal.id } });
      expect(stored).toMatchObject({ type: "REVERSAL", reversedMovementId: wrong.id, counterpartyNinjaId: ninja.id, sourceType: "InventoryMovement", sourceId: wrong.id });
      expect(stored.reason).toMatch(/^Annulation — Erreur de saisie/);
      const original = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: wrong.id } });
      expect(Number(original.quantity)).toBe(-20);
      await expect(prisma.$transaction((tx) => reverseMovement(tx, { movementId: wrong.id, agentId: agent.id, reason: "Encore", idempotencyKey: randomUUID() }))).rejects.toThrow(/déjà été corrigé/);
      await expect(prisma.$transaction((tx) => reverseMovement(tx, { movementId: reversal.id, agentId: agent.id, reason: "Encore", idempotencyKey: randomUUID() }))).rejects.toThrow(/ne se corrige pas/);
      expect(await ledgerSum(resource.id)).toBe(100);
      expect(await cachedQuantity(resource.id)).toBe(100);
    });
  });

  describe("integrations", () => {
    it("a validated buyback or donation feeds the ledger with the ninja as counterparty", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      const key = randomUUID();
      const transaction = await prisma.resourceTransaction.create({ data: { receiptNumber: `BUY-TEST-${key.slice(0, 8)}`, type: "BUYBACK", status: "VALIDATED", ninjaId: ninja.id, agentId: agent.id, totalAmount: 250_000n, idempotencyKey: key, validatedAt: new Date() } });
      await prisma.$transaction((tx) => applyValidatedTransaction(tx, { id: transaction.id, type: "BUYBACK", ninjaId: ninja.id, receiptNumber: transaction.receiptNumber, totalAmount: 250_000n, idempotencyKey: key }, [{ resourceId: resource.id, quantity: 10, unitPrice: 25_000n, exemptionPerUnit: 0n, pointsPerUnit: 0 }], agent.id));
      const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: resource.id } });
      expect(movement).toMatchObject({ type: "BUYBACK_IN", transactionId: transaction.id, sourceType: "ResourceTransaction", sourceId: transaction.id, counterpartyType: "NINJA", counterpartyNinjaId: ninja.id, counterpartyLabel: "Aoki Hoki", agentId: agent.id });
      expect(movement.reason).toBe(`Rachat ${transaction.receiptNumber}`);
      expect(Number(movement.quantityAfter)).toBe(10);
      expect(await cachedQuantity(resource.id)).toBe(10);
      const donationKey = randomUUID();
      const donation = await prisma.resourceTransaction.create({ data: { receiptNumber: `DON-TEST-${donationKey.slice(0, 8)}`, type: "DONATION", status: "VALIDATED", ninjaId: ninja.id, agentId: agent.id, totalAmount: 0n, idempotencyKey: donationKey, validatedAt: new Date() } });
      await prisma.$transaction((tx) => applyValidatedTransaction(tx, { id: donation.id, type: "DONATION", ninjaId: ninja.id, receiptNumber: donation.receiptNumber, totalAmount: 0n, idempotencyKey: donationKey }, [{ resourceId: resource.id, quantity: 20, unitPrice: 0n, exemptionPerUnit: 0n, pointsPerUnit: 0 }], agent.id));
      const don = await prisma.inventoryMovement.findFirstOrThrow({ where: { resourceId: resource.id, type: "DONATION_IN" } });
      expect(don.reason).toBe(`Don ${donation.receiptNumber}`);
      expect(Number(don.quantityBefore)).toBe(10);
      expect(Number(don.quantityAfter)).toBe(30);
      expect(await cachedQuantity(resource.id)).toBe(30);
    });
    it("a craft consumes ingredients and produces outputs through the same ledger", async () => {
      const iron = await createTestResource({ categoryId: ref.category.id, unitId: ref.kg.id });
      const kunai = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: iron.id, type: "INITIAL_BALANCE", quantity: 50, agentId: agent.id, reason: "Inventaire initial", markCounted: true, idempotencyKey: randomUUID() }));
      const execution = await prisma.$transaction(async (tx) => {
        const recipe = await tx.craftRecipe.create({ data: { code: `REC-TEST-${randomUUID().slice(0, 6)}`, version: 1, name: "Kunai test", category: "Armes", description: "", difficulty: "Facile", durationRpMinutes: 30, cost: 0n, status: "ACTIVE" } });
        const craft = await tx.craftExecution.create({ data: { recipeId: recipe.id, quantity: 5, status: "CONFIRMED", confirmedById: agent.id, idempotencyKey: randomUUID() } });
        await recordMovement(tx, { resourceId: iron.id, type: "CRAFT_CONSUMPTION", quantity: -20, agentId: agent.id, reason: `Fabrication ${recipe.code} ×5`, craftExecutionId: craft.id, idempotencyKey: `${craft.idempotencyKey}:in:${iron.id}` });
        await recordMovement(tx, { resourceId: kunai.id, type: "CRAFT_OUTPUT", quantity: 5, agentId: agent.id, reason: `Fabrication ${recipe.code} ×5`, craftExecutionId: craft.id, idempotencyKey: `${craft.idempotencyKey}:out:${kunai.id}` });
        return craft;
      });
      expect(await cachedQuantity(iron.id)).toBe(30);
      expect(await cachedQuantity(kunai.id)).toBe(5);
      const lines = await prisma.inventoryMovement.findMany({ where: { craftExecutionId: execution.id } });
      expect(lines.map((line) => line.sourceType)).toEqual(["CraftExecution", "CraftExecution"]);
      await expect(prisma.$transaction((tx) => recordMovement(tx, { resourceId: iron.id, type: "CRAFT_CONSUMPTION", quantity: -31, agentId: agent.id, reason: "Fabrication", idempotencyKey: randomUUID() }))).rejects.toThrow(/Stock insuffisant/);
    });
  });

  describe("concurrency and integrity", () => {
    it("two simultaneous exits never produce a negative stock nor a lost update", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "INITIAL_BALANCE", quantity: 10, agentId: agent.id, reason: "Inventaire initial", markCounted: true, idempotencyKey: randomUUID() }));
      const exit = () => prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "OUT", quantity: -8, agentId: agent.id, reason: "Mission", counterparty: { type: "EXTERNAL", label: "X" }, idempotencyKey: randomUUID() }));
      const results = await Promise.allSettled([exit(), exit(), exit()]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected").every((result) => String((result as PromiseRejectedResult).reason.message).includes("Stock insuffisant"))).toBe(true);
      expect(await ledgerSum(resource.id)).toBe(2);
      expect(await cachedQuantity(resource.id)).toBe(2);
    });
    it("many parallel entries keep the cache equal to the ledger", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      await Promise.all(Array.from({ length: 12 }, (_, index) => prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: index + 1, agentId: agent.id, reason: "Don", idempotencyKey: randomUUID() }))));
      const total = (12 * 13) / 2;
      expect(await ledgerSum(resource.id)).toBe(total);
      expect(await cachedQuantity(resource.id)).toBe(total);
      const lines = await prisma.inventoryMovement.findMany({ where: { resourceId: resource.id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
      // Each line chains on the previous one: before(n) == after(n-1).
      for (let index = 1; index < lines.length; index++) expect(Number(lines[index]!.quantityBefore)).toBe(Number(lines[index - 1]!.quantityAfter));
    });
    it("the database refuses to edit or delete a validated line", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      const recorded = await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 3, agentId: agent.id, reason: "Don", idempotencyKey: randomUUID() }));
      await expect(prisma.inventoryMovement.update({ where: { id: recorded.id }, data: { quantity: new Prisma.Decimal(30) } })).rejects.toThrow(/immutable/);
      await expect(prisma.inventoryMovement.delete({ where: { id: recorded.id } })).rejects.toThrow(/immutable/);
      // Non-essential annotations stay editable (notes), the stock facts do not.
      await expect(prisma.inventoryMovement.update({ where: { id: recorded.id }, data: { notes: "Précision ajoutée" } })).resolves.toMatchObject({ notes: "Précision ajoutée" });
    });
    it("a legacy writer that omits before/after gets them filled by the database trigger", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 7, agentId: agent.id, reason: "Don", idempotencyKey: randomUUID() }));
      const legacy = await prisma.inventoryMovement.create({ data: { resourceId: resource.id, type: "MANUAL_ADJUSTMENT", quantity: -2, agentId: agent.id, reason: "Ancienne révision", idempotencyKey: randomUUID() } });
      const stored = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: legacy.id } });
      expect(Number(stored.quantityBefore)).toBe(7);
      expect(Number(stored.quantityAfter)).toBe(5);
      expect(await cachedQuantity(resource.id)).toBe(5);
    });
    it("reconciliation reports a corrupted cache and only an explicit resync repairs it", async () => {
      const resource = await createTestResource({ categoryId: ref.category.id, unitId: ref.unite.id });
      await prisma.$transaction((tx) => recordMovement(tx, { resourceId: resource.id, type: "IN", quantity: 9, agentId: agent.id, reason: "Don", idempotencyKey: randomUUID() }));
      await prisma.$executeRaw`UPDATE "Resource" SET "currentQuantity" = 42 WHERE "id" = ${resource.id}`;
      const mismatches = await reconcileInventory(prisma);
      const mine = mismatches.find((row) => row.resourceId === resource.id);
      expect(mine).toBeDefined();
      expect(Number(mine!.ledger)).toBe(9);
      expect(Number(mine!.cache)).toBe(42);
      expect(await ledgerStock(prisma, resource.id).then(Number)).toBe(9);
      const fixed = await prisma.$transaction((tx) => resyncInventoryCache(tx, [resource.id]));
      expect(fixed).toBe(1);
      expect(await cachedQuantity(resource.id)).toBe(9);
      expect((await reconcileInventory(prisma)).some((row) => row.resourceId === resource.id)).toBe(false);
    });
  });
});
