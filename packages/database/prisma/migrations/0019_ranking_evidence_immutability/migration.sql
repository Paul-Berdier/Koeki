-- Preserve attribution and amount after first validation; economic corrections
-- continue to use status changes / counterentries, never historical rewrites.
CREATE OR REPLACE FUNCTION koeki_ranking_validation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."firstValidatedAt" IS NOT NULL THEN
    IF NEW."firstValidatedAt" IS DISTINCT FROM OLD."firstValidatedAt" OR NEW."validationEvidence" IS DISTINCT FROM OLD."validationEvidence" OR NEW."operationOrigin" IS DISTINCT FROM OLD."operationOrigin" THEN
      RAISE EXCEPTION 'First validation evidence is immutable';
    END IF;
    IF TG_TABLE_NAME = 'TaxPayment' AND (to_jsonb(NEW)->'amount' IS DISTINCT FROM to_jsonb(OLD)->'amount' OR to_jsonb(NEW)->'recordedById' IS DISTINCT FROM to_jsonb(OLD)->'recordedById') THEN
      RAISE EXCEPTION 'Validated payment amount and author are immutable';
    END IF;
    IF TG_TABLE_NAME = 'ResourceTransaction' AND (to_jsonb(NEW)->'totalAmount' IS DISTINCT FROM to_jsonb(OLD)->'totalAmount' OR to_jsonb(NEW)->'recordedById' IS DISTINCT FROM to_jsonb(OLD)->'recordedById') THEN
      RAISE EXCEPTION 'Validated resource transaction amount and author are immutable';
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
