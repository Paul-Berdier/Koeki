-- Preserve every historical exemption ledger value, but disable future automatic
-- consumption until a manager explicitly configures a weekly coverage rate.
BEGIN;

INSERT INTO "AppSetting" ("key", "value", "version", "updatedAt")
VALUES ('exemptionPolicy', '{"weeklyTaxCoverageBps":0}'::jsonb, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value",
    "version" = "AppSetting"."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP;

-- Defence in depth for Railway rolling deployments: a previous application
-- revision does not know the setting. These triggers make such a revision fail
-- atomically instead of consuming credit after the database has switched to 0 %.
CREATE OR REPLACE FUNCTION koeki_exemption_coverage_bps()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN jsonb_typeof("value"->'weeklyTaxCoverageBps') = 'number'
           AND ("value"->>'weeklyTaxCoverageBps') ~ '^[0-9]{1,5}(\.0+)?$'
        THEN CASE
          WHEN ("value"->>'weeklyTaxCoverageBps')::numeric BETWEEN 0 AND 10000
            THEN ("value"->>'weeklyTaxCoverageBps')::numeric::integer
          ELSE 0
        END
      ELSE 0
    END
    FROM "AppSetting"
    WHERE "key" = 'exemptionPolicy'
  ), 0);
$$;

CREATE OR REPLACE FUNCTION koeki_guard_exemption_ledger_debit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."amount" < 0
     AND NEW."sourceType" IN ('TaxAssessment', 'TaxSettlement')
     AND koeki_exemption_coverage_bps() = 0 THEN
    RAISE EXCEPTION 'Tax exemption credit application is disabled by exemptionPolicy'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ExemptionLedgerEntry_policy_guard" ON "ExemptionLedgerEntry";
CREATE TRIGGER "ExemptionLedgerEntry_policy_guard"
BEFORE INSERT ON "ExemptionLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION koeki_guard_exemption_ledger_debit();

CREATE OR REPLACE FUNCTION koeki_guard_tax_exemption_ceiling()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  coverage_bps integer;
  gross_amount bigint;
  already_exempted bigint;
  allowed_amount bigint;
BEGIN
  -- These rows replay a documented historical fact and do not spend the ninja wallet.
  IF NEW."reason" LIKE 'Payée d’avance à l’ancien registre%'
     OR NEW."reason" LIKE 'Payée d''avance à l''ancien registre%' THEN
    RETURN NEW;
  END IF;

  coverage_bps := koeki_exemption_coverage_bps();
  SELECT assessment."originalAmount"
       + COALESCE((SELECT SUM(penalty."amount") FROM "TaxPenalty" penalty WHERE penalty."assessmentId" = assessment."id"), 0)
       + COALESCE((SELECT SUM(adjustment."amount") FROM "TaxAdjustment" adjustment WHERE adjustment."assessmentId" = assessment."id"), 0)
  INTO gross_amount
  FROM "TaxAssessment" assessment
  WHERE assessment."id" = NEW."assessmentId";

  SELECT COALESCE(SUM(exemption."amount"), 0)
  INTO already_exempted
  FROM "TaxExemption" exemption
  WHERE exemption."assessmentId" = NEW."assessmentId";

  allowed_amount := (GREATEST(COALESCE(gross_amount, 0), 0) * coverage_bps) / 10000;
  IF NEW."amount" <= 0 OR already_exempted + NEW."amount" > allowed_amount THEN
    RAISE EXCEPTION 'Tax exemption exceeds exemptionPolicy ceiling'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "TaxExemption_policy_guard" ON "TaxExemption";
CREATE TRIGGER "TaxExemption_policy_guard"
BEFORE INSERT ON "TaxExemption"
FOR EACH ROW EXECUTE FUNCTION koeki_guard_tax_exemption_ceiling();

COMMIT;
