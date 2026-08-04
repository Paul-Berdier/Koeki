-- Village demand level per resource: NONE, NEEDED, CRITICAL (Besoin primaire).
ALTER TABLE "Resource" ADD COLUMN "demand" TEXT NOT NULL DEFAULT 'NONE';
