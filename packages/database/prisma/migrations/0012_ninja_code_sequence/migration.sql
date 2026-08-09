BEGIN;

-- Block creations from the previous application container during the repair.
LOCK TABLE "NinjaProfile" IN EXCLUSIVE MODE;

-- The previous container may have recreated this invalid value during the
-- rolling deployment of 0010, so repair it a second time before constraining it.
WITH "nextCode" AS (
  SELECT COALESCE(MAX(
    CASE
      WHEN "code" ~ '^NIN-[0-9]{6}$' THEN SUBSTRING("code" FROM 5 FOR 6)::bigint
      ELSE NULL
    END
  ), 0) + 1 AS "value"
  FROM "NinjaProfile"
)
UPDATE "NinjaProfile"
SET "code" = 'NIN-' || LPAD("nextCode"."value"::text, 6, '0'),
    "version" = "version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "nextCode"
WHERE "NinjaProfile"."code" = 'NIN-000NaN';

ALTER TABLE "NinjaProfile"
ADD CONSTRAINT "NinjaProfile_code_not_nan" CHECK ("code" <> 'NIN-000NaN');

-- The sequence is concurrency-safe and never reuses a deleted dossier code.
CREATE SEQUENCE "NinjaProfile_code_seq" AS bigint;

SELECT setval(
  '"NinjaProfile_code_seq"',
  GREATEST(COALESCE(MAX(
    CASE
      WHEN "code" ~ '^NIN-[0-9]{6}$' THEN SUBSTRING("code" FROM 5 FOR 6)::bigint
      ELSE NULL
    END
  ), 0), 1),
  COALESCE(MAX(
    CASE
      WHEN "code" ~ '^NIN-[0-9]{6}$' THEN SUBSTRING("code" FROM 5 FOR 6)::bigint
      ELSE NULL
    END
  ), 0) > 0
)
FROM "NinjaProfile";

COMMIT;
