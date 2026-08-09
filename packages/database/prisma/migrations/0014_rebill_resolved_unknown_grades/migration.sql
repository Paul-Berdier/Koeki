BEGIN;

-- Serialize with every current-week billing path, then block writes from the
-- previous Railway container while the data-only repair takes its snapshot.
SELECT pg_advisory_xact_lock(621714423);

LOCK TABLE
  "NinjaProfile",
  "NinjaGrade",
  "AppSetting",
  "TaxPolicy",
  "TaxPolicyGradeRate",
  "TaxYear",
  "TaxAssessment",
  "TaxPenalty",
  "TaxPayment",
  "TaxPaymentAllocation",
  "TaxAdjustment",
  "TaxExemption",
  "ExemptionLedgerEntry"
IN EXCLUSIVE MODE;

CREATE TEMP TABLE "_0014_context" (
  "nowAt" TIMESTAMPTZ NOT NULL,
  "rpYear" INTEGER NOT NULL
) ON COMMIT DROP;

-- Reproduce getRpService(): use the stored RP clock only when the complete
-- configuration is valid, otherwise use the domain defaults.
DO $migration$
DECLARE
  raw_config JSONB;
  effective_now TIMESTAMPTZ := clock_timestamp();
  anchor_at TIMESTAMPTZ := TIMESTAMPTZ '2026-01-05 00:00:00+00';
  anchor_year NUMERIC := 20;
  duration_ms NUMERIC := 604800000;
  timezone_name TEXT := 'Europe/Paris';
  fiscal_offset_ms NUMERIC := 0;
  due_delay_ms NUMERIC := 259200000;
BEGIN
  SELECT "value" INTO raw_config
  FROM "AppSetting"
  WHERE "key" = 'rpTime';

  IF raw_config IS NOT NULL THEN
    BEGIN
      IF jsonb_typeof(raw_config) IS DISTINCT FROM 'object'
        OR jsonb_typeof(raw_config -> 'realAnchorAt') IS DISTINCT FROM 'string'
        OR jsonb_typeof(raw_config -> 'rpAnchorYear') IS DISTINCT FROM 'number'
        OR jsonb_typeof(raw_config -> 'realMillisecondsPerRpYear') IS DISTINCT FROM 'number'
        OR jsonb_typeof(raw_config -> 'timezone') IS DISTINCT FROM 'string'
        OR jsonb_typeof(raw_config -> 'dueDelayMs') IS DISTINCT FROM 'number'
      THEN
        RAISE EXCEPTION 'invalid rpTime';
      END IF;

      anchor_at := (raw_config ->> 'realAnchorAt')::TIMESTAMPTZ;
      anchor_year := (raw_config ->> 'rpAnchorYear')::NUMERIC;
      duration_ms := (raw_config ->> 'realMillisecondsPerRpYear')::NUMERIC;
      timezone_name := raw_config ->> 'timezone';
      due_delay_ms := (raw_config ->> 'dueDelayMs')::NUMERIC;

      IF raw_config ? 'fiscalYearStartOffsetMs' THEN
        IF jsonb_typeof(raw_config -> 'fiscalYearStartOffsetMs') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'invalid fiscal offset';
        END IF;
        fiscal_offset_ms := (raw_config ->> 'fiscalYearStartOffsetMs')::NUMERIC;
      END IF;

      IF anchor_at IS NULL
        OR anchor_year IS NULL
        OR anchor_year <> trunc(anchor_year)
        OR anchor_year NOT BETWEEN -2147483648 AND 2147483647
        OR duration_ms IS NULL
        OR duration_ms <= 0
        OR duration_ms <> trunc(duration_ms)
        OR timezone_name IS NULL
        OR length(trim(timezone_name)) = 0
        OR fiscal_offset_ms IS NULL
        OR fiscal_offset_ms < 0
        OR fiscal_offset_ms <> trunc(fiscal_offset_ms)
        OR due_delay_ms IS NULL
        OR due_delay_ms < 0
        OR due_delay_ms <> trunc(due_delay_ms)
      THEN
        RAISE EXCEPTION 'invalid rpTime';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      anchor_at := TIMESTAMPTZ '2026-01-05 00:00:00+00';
      anchor_year := 20;
      duration_ms := 604800000;
      timezone_name := 'Europe/Paris';
      fiscal_offset_ms := 0;
      due_delay_ms := 259200000;
    END;
  END IF;

  INSERT INTO "_0014_context" ("nowAt", "rpYear")
  VALUES (
    effective_now,
    (anchor_year + floor(extract(epoch FROM (effective_now - anchor_at)) * 1000 / duration_ms))::INTEGER
  );
END;
$migration$;

-- Only the current RP week and completely untouched zero lines are eligible.
CREATE TEMP TABLE "_0014_candidates" ON COMMIT DROP AS
SELECT
  "assessment"."id" AS "assessmentId",
  "ninja"."currentGradeId" AS "gradeId",
  "grade"."code" AS "gradeCode",
  "grade"."label" AS "gradeLabel",
  "taxYear"."dueAt" AS "dueAt",
  "context"."nowAt" AS "nowAt"
FROM "_0014_context" AS "context"
JOIN "TaxYear" AS "taxYear" ON "taxYear"."rpYear" = "context"."rpYear"
JOIN "TaxAssessment" AS "assessment" ON "assessment"."taxYearId" = "taxYear"."id"
JOIN "NinjaProfile" AS "ninja" ON "ninja"."id" = "assessment"."ninjaId"
JOIN "NinjaGrade" AS "grade" ON "grade"."id" = "ninja"."currentGradeId"
WHERE "ninja"."status" = 'ACTIVE'
  AND "ninja"."diedAt" IS NULL
  AND "grade"."code" <> 'UNKNOWN'
  AND "assessment"."gradeCodeSnapshot" = 'UNKNOWN'
  AND "assessment"."originalAmount" = 0
  AND "assessment"."status" IN ('UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
  AND NOT EXISTS (SELECT 1 FROM "TaxPenalty" WHERE "assessmentId" = "assessment"."id")
  AND NOT EXISTS (SELECT 1 FROM "TaxPaymentAllocation" WHERE "assessmentId" = "assessment"."id")
  AND NOT EXISTS (SELECT 1 FROM "TaxAdjustment" WHERE "assessmentId" = "assessment"."id")
  AND NOT EXISTS (SELECT 1 FROM "TaxExemption" WHERE "assessmentId" = "assessment"."id")
  AND NOT EXISTS (
    SELECT 1
    FROM "ExemptionLedgerEntry" AS "ledger"
    WHERE "ledger"."ninjaId" = "assessment"."ninjaId"
      AND (
        "ledger"."sourceId" = "assessment"."id"
        OR left("ledger"."sourceId", length("assessment"."id") + 1) = "assessment"."id" || ':'
        OR right("ledger"."sourceId", length("assessment"."id") + 1) = ':' || "assessment"."id"
      )
  );

-- Never apply only part of the repair when the active scale is incomplete.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM "_0014_candidates") THEN
    IF (SELECT count(*) FROM "TaxPolicy" WHERE "isActive" = true) <> 1 THEN
      RAISE EXCEPTION '0014: exactly one active tax policy is required';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "_0014_candidates" AS "candidate"
      WHERE NOT EXISTS (
        SELECT 1
        FROM "TaxPolicy" AS "policy"
        JOIN "TaxPolicyGradeRate" AS "rate"
          ON "rate"."taxPolicyId" = "policy"."id"
         AND "rate"."gradeId" = "candidate"."gradeId"
        WHERE "policy"."isActive" = true
          AND "rate"."amount" >= 0
      )
    ) THEN
      RAISE EXCEPTION '0014: missing or negative tax rate for a resolved grade';
    END IF;
  END IF;
END;
$migration$;

CREATE TEMP TABLE "_0014_targets" ON COMMIT DROP AS
SELECT
  "candidate".*,
  "policy"."id" AS "policyId",
  "rate"."amount" AS "newAmount"
FROM "_0014_candidates" AS "candidate"
JOIN "TaxPolicy" AS "policy" ON "policy"."isActive" = true
JOIN "TaxPolicyGradeRate" AS "rate"
  ON "rate"."taxPolicyId" = "policy"."id"
 AND "rate"."gradeId" = "candidate"."gradeId";

UPDATE "TaxAssessment" AS "assessment"
SET
  "taxPolicyId" = "target"."policyId",
  "gradeCodeSnapshot" = "target"."gradeCode",
  "gradeLabelSnapshot" = "target"."gradeLabel",
  "originalAmount" = "target"."newAmount",
  "dueAt" = "target"."dueAt",
  "status" = CASE
    WHEN "target"."newAmount" = 0 THEN 'PAID'::"TaxAssessmentStatus"
    WHEN "target"."dueAt" > ("target"."nowAt" AT TIME ZONE 'UTC') THEN 'UPCOMING'::"TaxAssessmentStatus"
    ELSE 'DUE'::"TaxAssessmentStatus"
  END,
  "version" = "assessment"."version" + 1
FROM "_0014_targets" AS "target"
WHERE "assessment"."id" = "target"."assessmentId";

COMMIT;
