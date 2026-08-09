BEGIN;

-- Railway keeps the previous container alive during a rolling deployment. Block
-- its writes while data is repaired and the invariants are installed, otherwise
-- a conflicting row could appear between a cleanup and its CREATE INDEX/CHECK.
LOCK TABLE
  "NinjaProfile",
  "Invitation",
  "NinjaGradeHistory",
  "ResourcePriceHistory",
  "TaxPayment",
  "TaxPaymentAllocation",
  "TaxAssessment",
  "TaxExemption",
  "ExemptionLedgerEntry"
IN EXCLUSIVE MODE;

-- Only one live invitation may reserve a ninja dossier. Expire stale rows and
-- revoke older concurrent reservations before adding the database invariant.
UPDATE "Invitation"
SET "status" = 'EXPIRED'
WHERE "status" = 'PENDING'
  AND "expiresAt" <= CURRENT_TIMESTAMP;

UPDATE "Invitation" AS "invitation"
SET "status" = 'REVOKED',
    "revokedAt" = COALESCE("invitation"."revokedAt", CURRENT_TIMESTAMP)
FROM "NinjaProfile" AS "ninja"
WHERE "invitation"."ninjaProfileId" = "ninja"."id"
  AND "invitation"."status" = 'PENDING'
  AND ("ninja"."status" <> 'ACTIVE' OR "ninja"."diedAt" IS NOT NULL OR "ninja"."userId" IS NOT NULL);

WITH "rankedInvitations" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "ninjaProfileId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS "position"
  FROM "Invitation"
  WHERE "status" = 'PENDING'
    AND "ninjaProfileId" IS NOT NULL
)
UPDATE "Invitation"
SET "status" = 'REVOKED',
    "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP)
FROM "rankedInvitations"
WHERE "Invitation"."id" = "rankedInvitations"."id"
  AND "rankedInvitations"."position" > 1;

CREATE UNIQUE INDEX "Invitation_one_pending_ninja_idx"
ON "Invitation" ("ninjaProfileId")
WHERE "status" = 'PENDING' AND "ninjaProfileId" IS NOT NULL;

-- A ninja can have only one currently-open grade-history row.
WITH "rankedGradeHistory" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "ninjaId"
      ORDER BY "effectiveFrom" DESC, "id" DESC
    ) AS "position"
  FROM "NinjaGradeHistory"
  WHERE "effectiveTo" IS NULL
)
UPDATE "NinjaGradeHistory"
SET "effectiveTo" = GREATEST("effectiveFrom", CURRENT_TIMESTAMP)
FROM "rankedGradeHistory"
WHERE "NinjaGradeHistory"."id" = "rankedGradeHistory"."id"
  AND "rankedGradeHistory"."position" > 1;

CREATE UNIQUE INDEX "NinjaGradeHistory_one_open_idx"
ON "NinjaGradeHistory" ("ninjaId")
WHERE "effectiveTo" IS NULL;

-- Keep a single open catalog price per resource.
WITH "rankedPrices" AS (
  SELECT
    "id",
    "resourceId",
    "effectiveFrom",
    FIRST_VALUE("effectiveFrom") OVER (
      PARTITION BY "resourceId"
      ORDER BY "effectiveFrom" DESC, "id" DESC
    ) AS "latestEffectiveFrom",
    ROW_NUMBER() OVER (
      PARTITION BY "resourceId"
      ORDER BY "effectiveFrom" DESC, "id" DESC
    ) AS "position"
  FROM "ResourcePriceHistory"
  WHERE "effectiveTo" IS NULL
)
UPDATE "ResourcePriceHistory"
SET "effectiveTo" = "rankedPrices"."latestEffectiveFrom"
FROM "rankedPrices"
WHERE "ResourcePriceHistory"."id" = "rankedPrices"."id"
  AND "rankedPrices"."position" > 1;

CREATE UNIQUE INDEX "ResourcePriceHistory_one_open_idx"
ON "ResourcePriceHistory" ("resourceId")
WHERE "effectiveTo" IS NULL;

-- Collapse any historical duplicate allocation before strengthening the key.
WITH "allocationTotals" AS (
  SELECT
    MIN("id") AS "keeperId",
    "paymentId",
    "assessmentId",
    SUM("amount") AS "totalAmount"
  FROM "TaxPaymentAllocation"
  GROUP BY "paymentId", "assessmentId"
),
"updatedKeepers" AS (
  UPDATE "TaxPaymentAllocation"
  SET "amount" = "allocationTotals"."totalAmount"
  FROM "allocationTotals"
  WHERE "TaxPaymentAllocation"."id" = "allocationTotals"."keeperId"
  RETURNING "TaxPaymentAllocation"."id"
)
DELETE FROM "TaxPaymentAllocation"
USING "allocationTotals"
WHERE "TaxPaymentAllocation"."paymentId" = "allocationTotals"."paymentId"
  AND "TaxPaymentAllocation"."assessmentId" = "allocationTotals"."assessmentId"
  AND "TaxPaymentAllocation"."id" <> "allocationTotals"."keeperId";

DROP INDEX "TaxPaymentAllocation_paymentId_assessmentId_allocationOrder_key";
CREATE UNIQUE INDEX "TaxPaymentAllocation_paymentId_assessmentId_key"
ON "TaxPaymentAllocation" ("paymentId", "assessmentId");

-- The death timestamp is authoritative. Repair the former archive/restore
-- combination before enforcing valid lifecycle combinations.
ALTER TABLE "NinjaProfile" ADD COLUMN "archivedFromStatus" TEXT;

UPDATE "NinjaProfile"
SET "status" = 'DECEASED',
    "version" = "version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('ACTIVE', 'INACTIVE')
  AND "diedAt" IS NOT NULL;

-- Existing archives did not retain their previous lifecycle state. Preserve
-- deceased dossiers and restore every other legacy archive conservatively as inactive.
UPDATE "NinjaProfile"
SET "archivedFromStatus" = CASE
  WHEN "diedAt" IS NOT NULL THEN 'DECEASED'
  ELSE 'INACTIVE'
END
WHERE "status" = 'ARCHIVED';

-- Keep the migration compatible with the previous Railway container during
-- the rolling hand-over: that version neither writes nor clears the new
-- archivedFromStatus column. The trigger also makes the invariant defensive
-- for any future direct database update.
CREATE OR REPLACE FUNCTION "NinjaProfile_preserve_archive_origin"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" <> 'ARCHIVED' AND NEW."status" = 'ARCHIVED' THEN
    NEW."archivedFromStatus" := COALESCE(
      NEW."archivedFromStatus",
      CASE
        WHEN OLD."status" = 'DECEASED' OR OLD."diedAt" IS NOT NULL THEN 'DECEASED'
        WHEN OLD."status" = 'ACTIVE' THEN 'ACTIVE'
        ELSE 'INACTIVE'
      END
    );
  ELSIF OLD."status" = 'ARCHIVED' AND NEW."status" <> 'ARCHIVED' THEN
    IF NEW."status" = 'ACTIVE' AND OLD."archivedFromStatus" IN ('INACTIVE', 'DECEASED') THEN
      NEW."status" := OLD."archivedFromStatus";
    END IF;
    NEW."archivedFromStatus" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "NinjaProfile_preserve_archive_origin_trigger"
BEFORE UPDATE OF "status", "archivedFromStatus" ON "NinjaProfile"
FOR EACH ROW
EXECUTE FUNCTION "NinjaProfile_preserve_archive_origin"();

-- Return exemption credit consumed by a future tax that is cancelled because
-- the ninja died. The deterministic source makes the repair idempotent.
INSERT INTO "ExemptionLedgerEntry" (
  "id", "ninjaId", "amount", "sourceType", "sourceId", "reason", "createdAt"
)
SELECT
  'death-' || MD5("assessment"."id"),
  "assessment"."ninjaId",
  -SUM("entry"."amount"),
  'DeathCancellation',
  "assessment"."id",
  'Restitution du crédit consommé après le décès',
  CURRENT_TIMESTAMP
FROM "TaxAssessment" AS "assessment"
JOIN "NinjaProfile" AS "ninja" ON "ninja"."id" = "assessment"."ninjaId"
JOIN "ExemptionLedgerEntry" AS "entry"
  ON "entry"."ninjaId" = "assessment"."ninjaId"
 AND (
   (
     "entry"."sourceType" = 'TaxAssessment'
     AND ("entry"."sourceId" = "assessment"."id" OR "entry"."sourceId" LIKE "assessment"."id" || ':%')
   )
   OR (
     "entry"."sourceType" = 'TaxSettlement'
     AND "entry"."sourceId" LIKE '%:' || "assessment"."id"
   )
 )
WHERE "ninja"."diedAt" IS NOT NULL
  AND "assessment"."dueAt" > "ninja"."diedAt"
  AND "entry"."amount" < 0
  AND NOT EXISTS (
    SELECT 1
    FROM "ExemptionLedgerEntry" AS "existing"
    WHERE "existing"."sourceType" = 'DeathCancellation'
      AND "existing"."sourceId" = "assessment"."id"
  )
GROUP BY "assessment"."id", "assessment"."ninjaId";

UPDATE "TaxAssessment" AS "assessment"
SET "status" = 'CANCELLED',
    "version" = "assessment"."version" + 1
FROM "NinjaProfile" AS "ninja"
WHERE "ninja"."id" = "assessment"."ninjaId"
  AND "ninja"."diedAt" IS NOT NULL
  AND "assessment"."dueAt" > "ninja"."diedAt"
  AND "assessment"."status" IN ('UPCOMING', 'DUE', 'OVERDUE', 'PARTIALLY_PAID', 'PAID');

ALTER TABLE "NinjaProfile"
ADD CONSTRAINT "NinjaProfile_lifecycle_consistency" CHECK (
  "status" IN ('ACTIVE', 'INACTIVE', 'DECEASED', 'ARCHIVED')
  AND (
    ("status" = 'DECEASED' AND "diedAt" IS NOT NULL)
    OR ("status" IN ('ACTIVE', 'INACTIVE') AND "diedAt" IS NULL)
    OR "status" = 'ARCHIVED'
  )
);

ALTER TABLE "NinjaProfile"
ADD CONSTRAINT "NinjaProfile_archive_origin_consistency" CHECK (
  (
    "status" = 'ARCHIVED'
    AND (
      ("archivedFromStatus" = 'DECEASED' AND "diedAt" IS NOT NULL)
      OR ("archivedFromStatus" IN ('ACTIVE', 'INACTIVE') AND "diedAt" IS NULL)
    )
  )
  OR ("status" <> 'ARCHIVED' AND "archivedFromStatus" IS NULL)
);

COMMIT;
