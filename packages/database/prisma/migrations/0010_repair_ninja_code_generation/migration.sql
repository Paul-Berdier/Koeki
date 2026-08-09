-- Older code generation could select a historical code such as NIN-EJ0001,
-- turn its suffix into NaN, and persist NIN-000NaN once. Give that dossier
-- the next valid numeric code before the corrected allocator is used.
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
