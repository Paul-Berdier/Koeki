-- Preserve historical reporting population independently of later role removals.
-- OBSERVED records were created by 0017 only for existing ECONOMIC_AGENT users.
ALTER TABLE "AgentParticipation" ADD COLUMN "serviceRole" TEXT;
UPDATE "AgentParticipation" SET "serviceRole" = 'ECONOMIC_AGENT'
 WHERE "dateSource" = 'OBSERVED' AND "id" = 'observed-' || "userId";
-- Account and invitation commands have a timestamped role mutation audit.
-- Match the opened period to that exact event; no current role is projected backward.
UPDATE "AgentParticipation" p SET "serviceRole" = 'ECONOMIC_AGENT'
 WHERE p."serviceRole" IS NULL AND EXISTS (
   SELECT 1 FROM "AuditLog" a WHERE a."entityType" = 'User' AND a."entityId" = p."userId"
    AND a."action" IN ('USER_ROLES_UPDATED','USER_ACCESS_REACTIVATED')
    AND a."newValues"->'roles' @> '["ECONOMIC_AGENT"]'::jsonb
    AND abs(EXTRACT(EPOCH FROM (a."createdAt" - p."createdAt"))) < 5
 );
-- All remaining rows stay explicitly unknown. Their past population is not fabricated.
