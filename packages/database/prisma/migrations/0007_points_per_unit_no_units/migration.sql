-- Ranking points granted per donated unit (old-register "Points / unité" scale).
ALTER TABLE "Resource" ADD COLUMN "pointsPerUnit" INTEGER NOT NULL DEFAULT 0;

-- Everything is counted in plain units: the unit-of-measure referential is dropped.
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_unitId_fkey";
ALTER TABLE "Resource" DROP COLUMN "unitId";
DROP TABLE "ResourceUnit";
