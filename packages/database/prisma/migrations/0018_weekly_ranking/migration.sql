-- Additive activity evidence. No existing financial amount or date is rewritten.
ALTER TABLE "TaxPayment" ADD COLUMN "firstValidatedAt" TIMESTAMP(3), ADD COLUMN "validationEvidence" TEXT, ADD COLUMN "operationOrigin" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "ResourceTransaction" ADD COLUMN "firstValidatedAt" TIMESTAMP(3), ADD COLUMN "validationEvidence" TEXT, ADD COLUMN "operationOrigin" TEXT NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN "recordedById" TEXT;
CREATE INDEX "TaxPayment_firstValidatedAt_status_idx" ON "TaxPayment"("firstValidatedAt", "status");
CREATE INDEX "ResourceTransaction_firstValidatedAt_status_idx" ON "ResourceTransaction"("firstValidatedAt", "status");

UPDATE "ResourceTransaction" SET "operationOrigin" = 'IMPORT' WHERE "idempotencyKey" LIKE 'imp-%' OR "idempotencyKey" LIKE 'kv-%';
-- A trusted first-validation audit and an existing validation timestamp are both required.
UPDATE "TaxPayment" p SET "firstValidatedAt" = p."validatedAt", "validationEvidence" = 'AUDIT_BACKFILL', "operationOrigin" = 'BUSINESS'
WHERE p."validatedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."action" = 'PAYMENT_RECORDED' AND a."entityType" = 'TaxPayment' AND a."entityId" IN (p."id", p."receiptNumber") AND a."actorId" = p."recordedById" AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - p."validatedAt"))) < 60);
UPDATE "ResourceTransaction" r SET "recordedById" = a."actorId", "operationOrigin" = CASE WHEN a."action" = 'DONATION_DECLARED' THEN 'SELF_DECLARED' ELSE 'BUSINESS' END
FROM "AuditLog" a WHERE r."operationOrigin" <> 'IMPORT' AND a."entityType" = 'ResourceTransaction' AND a."entityId" = r."id" AND a."action" IN ('DONATION_DECLARED', 'DONATION_RECORDED', 'BUYBACK_RECORDED', 'BUYBACK_PENDING_APPROVAL') AND a."actorId" IS NOT NULL;
UPDATE "ResourceTransaction" r SET "firstValidatedAt" = r."validatedAt", "validationEvidence" = 'AUDIT_BACKFILL'
WHERE r."operationOrigin" IN ('BUSINESS', 'SELF_DECLARED') AND r."validatedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."entityType" = 'ResourceTransaction' AND a."entityId" = r."id" AND a."action" IN ('DONATION_RECORDED', 'BUYBACK_RECORDED', 'DONATION_APPROVED', 'BUYBACK_APPROVED') AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - r."validatedAt"))) < 60);

CREATE TABLE "RankingPeriod" (
  "id" TEXT NOT NULL, "weekKey" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "correctionNeeded" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingPeriod_pkey" PRIMARY KEY ("id"), CONSTRAINT "RankingPeriod_dates_check" CHECK ("endsAt" > "startsAt")
);
CREATE UNIQUE INDEX "RankingPeriod_weekKey_key" ON "RankingPeriod"("weekKey");
CREATE TABLE "RankingVersion" (
  "id" TEXT NOT NULL, "periodId" TEXT NOT NULL, "version" INTEGER NOT NULL, "formulaVersion" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL, "fingerprint" TEXT NOT NULL, "reason" TEXT, "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingVersion_pkey" PRIMARY KEY ("id"), CONSTRAINT "RankingVersion_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "RankingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RankingVersion_reason_check" CHECK ("version" > 0 AND ("version" = 1 OR LENGTH(TRIM("reason")) >= 10))
);
CREATE UNIQUE INDEX "RankingVersion_periodId_version_key" ON "RankingVersion"("periodId", "version");
CREATE INDEX "RankingVersion_periodId_createdAt_idx" ON "RankingVersion"("periodId", "createdAt");
INSERT INTO "AppSetting" ("key", "value", "version", "updatedAt") VALUES ('rankingCoverage', jsonb_build_object('reliableFrom', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), 1, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;

-- The database owns the first-validation clock for newly identified business rows.
-- Unknown/legacy writers remain explicitly incomplete during a rolling deployment.
CREATE FUNCTION koeki_ranking_validation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."firstValidatedAt" IS NOT NULL THEN
    IF NEW."firstValidatedAt" IS DISTINCT FROM OLD."firstValidatedAt" OR NEW."validationEvidence" IS DISTINCT FROM OLD."validationEvidence" OR NEW."operationOrigin" IS DISTINCT FROM OLD."operationOrigin" THEN
      RAISE EXCEPTION 'First validation evidence is immutable';
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      UPDATE "RankingPeriod" SET "correctionNeeded" = true WHERE "startsAt" <= OLD."firstValidatedAt" AND "endsAt" > OLD."firstValidatedAt";
    END IF;
  ELSIF NEW."status"::text = 'VALIDATED' AND NEW."operationOrigin" IN ('BUSINESS', 'SELF_DECLARED') THEN
    NEW."firstValidatedAt" := clock_timestamp();
    NEW."validationEvidence" := 'SERVER';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TaxPayment_ranking_evidence" BEFORE INSERT OR UPDATE ON "TaxPayment" FOR EACH ROW EXECUTE FUNCTION koeki_ranking_validation_evidence();
CREATE TRIGGER "ResourceTransaction_ranking_evidence" BEFORE INSERT OR UPDATE ON "ResourceTransaction" FOR EACH ROW EXECUTE FUNCTION koeki_ranking_validation_evidence();
CREATE FUNCTION koeki_ranking_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Ranking versions are immutable: publish a motivated correction'; END $$;
CREATE TRIGGER "RankingVersion_immutable" BEFORE UPDATE OR DELETE ON "RankingVersion" FOR EACH ROW EXECUTE FUNCTION koeki_ranking_version_immutable();
