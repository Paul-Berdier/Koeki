-- Recover only existing validation timestamps corroborated by one unambiguous
-- PAYMENT_RECORDED audit. Tax settlements can audit the donation receipt itself
-- or list it alongside a cash-payment receipt in newValues.receipts.
-- No financial amount, status, createdAt, validatedAt or participation is changed.
BEGIN;

-- Keep the temporary evidence-trigger exception atomic and exclude writers.
-- Resource-before-payment matches the combined-settlement write order.
LOCK TABLE "ResourceTransaction", "TaxPayment", "AuditLog" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "TaxPayment" DISABLE TRIGGER "TaxPayment_ranking_evidence";
ALTER TABLE "ResourceTransaction" DISABLE TRIGGER "ResourceTransaction_ranking_evidence";
CREATE TEMP TABLE "_receipt_backfill_dates" ("validatedAt" TIMESTAMP(3) NOT NULL) ON COMMIT DROP;

-- Also recover proven cash payments written by the old application after 0018.
-- Common receipt-number audits were already supported by 0018; ambiguity is
-- checked explicitly here rather than choosing an arbitrary matching audit.
WITH candidates AS (
  SELECT p."id", MIN(a."id") AS "auditId"
  FROM "TaxPayment" p
  JOIN "AuditLog" a ON a."action" = 'PAYMENT_RECORDED'
    AND a."entityType" = 'TaxPayment'
    AND a."entityId" IN (p."id", p."receiptNumber")
  WHERE p."operationOrigin" = 'UNKNOWN'
    AND p."firstValidatedAt" IS NULL AND p."validationEvidence" IS NULL
    AND p."validatedAt" IS NOT NULL AND p."status" IN ('VALIDATED', 'REVERSED')
    AND p."idempotencyKey" NOT LIKE 'imp-%' AND p."idempotencyKey" NOT LIKE 'kv-%'
  GROUP BY p."id" HAVING COUNT(*) = 1
), repaired AS (
  UPDATE "TaxPayment" p
  SET "firstValidatedAt" = p."validatedAt", "validationEvidence" = 'AUDIT_BACKFILL', "operationOrigin" = 'BUSINESS'
  FROM candidates c JOIN "AuditLog" a ON a."id" = c."auditId"
  WHERE p."id" = c."id" AND a."actorId" = p."recordedById"
    AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - p."validatedAt"))) < 60
  RETURNING p."validatedAt"
)
INSERT INTO "_receipt_backfill_dates" SELECT "validatedAt" FROM repaired;

WITH candidates AS (
  SELECT r."id", MIN(a."id") AS "auditId"
  FROM "ResourceTransaction" r
  JOIN "AuditLog" a ON a."action" = 'PAYMENT_RECORDED' AND (
    (a."entityType" = 'ResourceTransaction' AND a."entityId" IN (r."id", r."receiptNumber"))
    OR (a."entityType" = 'TaxPayment' AND jsonb_typeof(a."newValues"->'receipts') = 'array'
      AND (a."newValues"->'receipts') ? r."receiptNumber")
  )
  WHERE r."type" = 'DONATION' AND r."operationOrigin" = 'UNKNOWN'
    AND r."firstValidatedAt" IS NULL AND r."validationEvidence" IS NULL
    AND r."validatedAt" IS NOT NULL AND r."status" IN ('VALIDATED', 'REVERSED')
    AND r."idempotencyKey" LIKE '%:don'
    AND r."idempotencyKey" NOT LIKE 'imp-%' AND r."idempotencyKey" NOT LIKE 'kv-%'
  GROUP BY r."id" HAVING COUNT(*) = 1
), repaired AS (
  UPDATE "ResourceTransaction" r
  SET "recordedById" = a."actorId", "firstValidatedAt" = r."validatedAt",
      "validationEvidence" = 'AUDIT_BACKFILL', "operationOrigin" = 'BUSINESS'
  FROM candidates c JOIN "AuditLog" a ON a."id" = c."auditId"
  WHERE r."id" = c."id" AND a."actorId" = r."agentId"
    AND (r."recordedById" IS NULL OR r."recordedById" = a."actorId")
    AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - r."validatedAt"))) < 60
    AND (
      a."entityType" = 'ResourceTransaction'
      OR EXISTS (
        SELECT 1 FROM "TaxPayment" p
        WHERE a."entityId" IN (p."id", p."receiptNumber")
          AND p."ninjaId" = r."ninjaId" AND p."recordedById" = a."actorId"
          AND p."idempotencyKey" || ':don' = r."idempotencyKey"
          AND p."status" IN ('VALIDATED', 'REVERSED') AND p."validatedAt" IS NOT NULL
          AND p."operationOrigin" NOT IN ('IMPORT', 'TECHNICAL')
          AND ABS(EXTRACT(EPOCH FROM (p."validatedAt" - r."validatedAt"))) < 60
      )
    )
    -- A contrary original-author audit is not resolved by guessing from agentId.
    AND NOT EXISTS (
      SELECT 1 FROM "AuditLog" other
      WHERE other."entityType" = 'ResourceTransaction'
        AND other."entityId" IN (r."id", r."receiptNumber")
        AND other."action" IN ('DONATION_DECLARED', 'DONATION_RECORDED', 'BUYBACK_RECORDED', 'BUYBACK_PENDING_APPROVAL')
        AND other."actorId" IS DISTINCT FROM a."actorId"
    )
  RETURNING r."validatedAt"
)
INSERT INTO "_receipt_backfill_dates" SELECT "validatedAt" FROM repaired;

-- Published snapshots stay immutable; a responsible person can review changes.
UPDATE "RankingPeriod" period SET "correctionNeeded" = true
WHERE EXISTS (SELECT 1 FROM "_receipt_backfill_dates" evidence
  WHERE period."startsAt" <= evidence."validatedAt" AND period."endsAt" > evidence."validatedAt");

ALTER TABLE "TaxPayment" ENABLE TRIGGER "TaxPayment_ranking_evidence";
ALTER TABLE "ResourceTransaction" ENABLE TRIGGER "ResourceTransaction_ranking_evidence";
COMMIT;
