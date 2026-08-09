-- A previous production bootstrap could reactivate the initial scale after a
-- manager published a newer one. Keep the most recent active scale only.
BEGIN;

LOCK TABLE "TaxPolicy" IN EXCLUSIVE MODE;

WITH "rankedActivePolicies" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      ORDER BY "effectiveFromRpYear" DESC, "version" DESC, "createdAt" DESC
    ) AS "position"
  FROM "TaxPolicy"
  WHERE "isActive" = true
)
UPDATE "TaxPolicy"
SET "isActive" = false
FROM "rankedActivePolicies"
WHERE "TaxPolicy"."id" = "rankedActivePolicies"."id"
  AND "rankedActivePolicies"."position" > 1;

CREATE UNIQUE INDEX "TaxPolicy_single_active_idx"
ON "TaxPolicy" ((1))
WHERE "isActive" = true;

COMMIT;
