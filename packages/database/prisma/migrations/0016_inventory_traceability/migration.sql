-- Inventory traceability: units, aliases, stock cache, before/after snapshots, counterparties,
-- reversals and stocktake sessions. Strictly additive: no table dropped, no column renamed,
-- no row deleted. Existing movements are backfilled; existing resources stay NOT_INVENTORIED
-- because none of them has ever been physically counted.
BEGIN;

-- New enum values are only used by the application after this migration has committed.
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'INITIAL_BALANCE';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'IN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'OUT';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_OUT';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'RETURN_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'REVERSAL';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TYPE "InventoryStatus" AS ENUM ('NOT_INVENTORIED', 'COUNTED');
CREATE TYPE "CounterpartyType" AS ENUM ('NINJA', 'EXTERNAL');
CREATE TYPE "StocktakeKind" AS ENUM ('INITIAL', 'COUNT');
CREATE TYPE "StocktakeStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- Units of measure (the 0007 referential was dropped; this one carries a precision).
CREATE TABLE "ResourceUnit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ResourceUnit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResourceUnit_code_key" ON "ResourceUnit"("code");

-- Stable identifiers: "unit-unite" is the database default of Resource.unitId, which keeps the
-- previous application revision able to create resources during a rolling deployment.
INSERT INTO "ResourceUnit" ("id", "code", "label", "decimals", "sortOrder") VALUES
  ('unit-unite', 'UNIT', 'unité', 0, 10),
  ('unit-piece', 'PIECE', 'pièce', 0, 20),
  ('unit-kg', 'KG', 'kg', 3, 30),
  ('unit-g', 'G', 'g', 0, 40),
  ('unit-m', 'M', 'm', 2, 50),
  ('unit-l', 'L', 'L', 2, 60),
  ('unit-lot', 'LOT', 'lot', 0, 70),
  ('unit-ryo', 'RYO', 'Ryō', 0, 80)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "ResourceCategory" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "Resource"
  ADD COLUMN "unitId" TEXT NOT NULL DEFAULT 'unit-unite',
  ADD COLUMN "inventoryStatus" "InventoryStatus" NOT NULL DEFAULT 'NOT_INVENTORIED',
  ADD COLUMN "currentQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN "lastMovementAt" TIMESTAMP(3),
  ADD COLUMN "lastCountedAt" TIMESTAMP(3),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ResourceUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Resource_categoryId_isActive_idx" ON "Resource"("categoryId", "isActive");
CREATE INDEX "Resource_inventoryStatus_idx" ON "Resource"("inventoryStatus");

CREATE TABLE "ResourceAlias" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "ResourceAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResourceAlias_resourceId_alias_key" ON "ResourceAlias"("resourceId", "alias");
CREATE INDEX "ResourceAlias_alias_idx" ON "ResourceAlias"("alias");
ALTER TABLE "ResourceAlias" ADD CONSTRAINT "ResourceAlias_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
  ADD COLUMN "quantityBefore" DECIMAL(20,4),
  ADD COLUMN "quantityAfter" DECIMAL(20,4),
  ADD COLUMN "counterpartyType" "CounterpartyType",
  ADD COLUMN "counterpartyNinjaId" TEXT,
  ADD COLUMN "counterpartyLabel" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "reversedMovementId" TEXT;
CREATE UNIQUE INDEX "InventoryMovement_reversedMovementId_key" ON "InventoryMovement"("reversedMovementId");
CREATE INDEX "InventoryMovement_occurredAt_idx" ON "InventoryMovement"("occurredAt");
CREATE INDEX "InventoryMovement_agentId_occurredAt_idx" ON "InventoryMovement"("agentId", "occurredAt");
CREATE INDEX "InventoryMovement_counterpartyNinjaId_occurredAt_idx" ON "InventoryMovement"("counterpartyNinjaId", "occurredAt");
CREATE INDEX "InventoryMovement_type_occurredAt_idx" ON "InventoryMovement"("type", "occurredAt");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_counterpartyNinjaId_fkey" FOREIGN KEY ("counterpartyNinjaId") REFERENCES "NinjaProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_reversedMovementId_fkey" FOREIGN KEY ("reversedMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StocktakeSession" (
    "id" TEXT NOT NULL,
    "kind" "StocktakeKind" NOT NULL DEFAULT 'COUNT',
    "status" "StocktakeStatus" NOT NULL DEFAULT 'OPEN',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "StocktakeSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StocktakeSession_status_startedAt_idx" ON "StocktakeSession"("status", "startedAt");

CREATE TABLE "StocktakeEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "expectedQuantity" DECIMAL(20,4) NOT NULL,
    "countedQuantity" DECIMAL(20,4) NOT NULL,
    "difference" DECIMAL(20,4) NOT NULL,
    "adjustmentMovementId" TEXT,

    CONSTRAINT "StocktakeEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StocktakeEntry_adjustmentMovementId_key" ON "StocktakeEntry"("adjustmentMovementId");
CREATE UNIQUE INDEX "StocktakeEntry_sessionId_resourceId_key" ON "StocktakeEntry"("sessionId", "resourceId");
CREATE INDEX "StocktakeEntry_resourceId_idx" ON "StocktakeEntry"("resourceId");
ALTER TABLE "StocktakeEntry" ADD CONSTRAINT "StocktakeEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StocktakeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StocktakeEntry" ADD CONSTRAINT "StocktakeEntry_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeEntry" ADD CONSTRAINT "StocktakeEntry_adjustmentMovementId_fkey" FOREIGN KEY ("adjustmentMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill. Railway keeps the previous container alive during the hand-over:
-- lock the ledger so no line slips between the running-sum snapshot and the cache.
-- ---------------------------------------------------------------------------
LOCK TABLE "InventoryMovement", "Resource" IN EXCLUSIVE MODE;

-- Every historical line receives its before/after snapshot from the running balance.
WITH "running" AS (
  SELECT "id",
         SUM("quantity") OVER (PARTITION BY "resourceId" ORDER BY "occurredAt", "id"
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "after"
  FROM "InventoryMovement"
)
UPDATE "InventoryMovement" AS "movement"
SET "quantityAfter" = "running"."after",
    "quantityBefore" = "running"."after" - "movement"."quantity"
FROM "running"
WHERE "movement"."id" = "running"."id"
  AND "movement"."quantityAfter" IS NULL;

-- Transaction-backed lines: the counterparty is the ninja of the receipt.
UPDATE "InventoryMovement" AS "movement"
SET "counterpartyType" = 'NINJA',
    "counterpartyNinjaId" = "transaction"."ninjaId",
    "counterpartyLabel" = TRIM("ninja"."firstName" || ' ' || "ninja"."lastName"),
    "sourceType" = 'ResourceTransaction',
    "sourceId" = "transaction"."id"
FROM "ResourceTransaction" AS "transaction"
JOIN "NinjaProfile" AS "ninja" ON "ninja"."id" = "transaction"."ninjaId"
WHERE "movement"."transactionId" = "transaction"."id"
  AND "movement"."sourceType" IS NULL;

UPDATE "InventoryMovement"
SET "sourceType" = 'CraftExecution', "sourceId" = "craftExecutionId"
WHERE "craftExecutionId" IS NOT NULL AND "sourceType" IS NULL;

-- Stock cache = ledger sum.
UPDATE "Resource" AS "resource"
SET "currentQuantity" = COALESCE("ledger"."total", 0),
    "lastMovementAt" = "ledger"."last"
FROM (
  SELECT "resourceId", SUM("quantity") AS "total", MAX("occurredAt") AS "last"
  FROM "InventoryMovement"
  GROUP BY "resourceId"
) AS "ledger"
WHERE "resource"."id" = "ledger"."resourceId";

-- ---------------------------------------------------------------------------
-- Defence in depth (same approach as 0013 / 0015): the database itself keeps the stock
-- cache in step with the ledger and refuses to alter or delete a validated line, whatever
-- application revision or script is writing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION koeki_inventory_movement_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_stock numeric(20, 4);
BEGIN
  -- A writer that predates before/after snapshots (older revision, script) gets them filled.
  IF NEW."quantityBefore" IS NULL OR NEW."quantityAfter" IS NULL THEN
    SELECT COALESCE(SUM("quantity"), 0) INTO current_stock
    FROM "InventoryMovement"
    WHERE "resourceId" = NEW."resourceId";
    NEW."quantityBefore" := current_stock;
    NEW."quantityAfter" := current_stock + NEW."quantity";
  END IF;
  IF NEW."sourceType" IS NULL THEN
    IF NEW."transactionId" IS NOT NULL THEN
      NEW."sourceType" := 'ResourceTransaction';
      NEW."sourceId" := NEW."transactionId";
    ELSIF NEW."craftExecutionId" IS NOT NULL THEN
      NEW."sourceType" := 'CraftExecution';
      NEW."sourceId" := NEW."craftExecutionId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION koeki_inventory_movement_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Resource"
  SET "currentQuantity" = "currentQuantity" + NEW."quantity",
      "lastMovementAt" = GREATEST(COALESCE("lastMovementAt", NEW."occurredAt"), NEW."occurredAt")
  WHERE "id" = NEW."resourceId";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION koeki_inventory_movement_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'InventoryMovement rows are immutable: record a REVERSAL instead of deleting'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."quantity" <> OLD."quantity"
     OR NEW."resourceId" <> OLD."resourceId"
     OR NEW."type" <> OLD."type"
     OR NEW."occurredAt" <> OLD."occurredAt"
     OR NEW."agentId" <> OLD."agentId"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR (OLD."quantityBefore" IS NOT NULL AND NEW."quantityBefore" IS DISTINCT FROM OLD."quantityBefore")
     OR (OLD."quantityAfter" IS NOT NULL AND NEW."quantityAfter" IS DISTINCT FROM OLD."quantityAfter") THEN
    RAISE EXCEPTION 'InventoryMovement rows are immutable: record a REVERSAL instead of editing'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "InventoryMovement_before_insert" ON "InventoryMovement";
CREATE TRIGGER "InventoryMovement_before_insert"
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION koeki_inventory_movement_before_insert();

DROP TRIGGER IF EXISTS "InventoryMovement_after_insert" ON "InventoryMovement";
CREATE TRIGGER "InventoryMovement_after_insert"
AFTER INSERT ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION koeki_inventory_movement_after_insert();

DROP TRIGGER IF EXISTS "InventoryMovement_immutable" ON "InventoryMovement";
CREATE TRIGGER "InventoryMovement_immutable"
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION koeki_inventory_movement_immutable();

COMMIT;
