-- Additive collaboration data. Unknown historical entry/submission dates remain NULL.
ALTER TABLE "AgentReport" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "decidedAt" TIMESTAMP(3), ADD COLUMN "snapshotAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "href" TEXT, ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE TABLE "AgentParticipation" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3), "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "dateSource" TEXT NOT NULL DEFAULT 'DECLARED', "rankingEligible" BOOLEAN NOT NULL DEFAULT true,
 "createdById" TEXT REFERENCES "User"("id"), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AgentParticipation_dates_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" >= "startsAt")
);
CREATE INDEX "AgentParticipation_userId_endsAt_idx" ON "AgentParticipation"("userId", "endsAt");
CREATE UNIQUE INDEX "AgentParticipation_active_key" ON "AgentParticipation"("userId") WHERE "endsAt" IS NULL;
INSERT INTO "AgentParticipation" ("id", "userId", "dateSource", "rankingEligible")
 SELECT 'observed-' || u."id", u."id", 'OBSERVED', true FROM "User" u
 WHERE u."revokedAt" IS NULL AND EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE ur."userId" = u."id" AND r."code" = 'ECONOMIC_AGENT') ON CONFLICT DO NOTHING;
CREATE TABLE "AgentAbsence" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "reason" TEXT,
 "createdById" TEXT NOT NULL REFERENCES "User"("id"), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AgentAbsence_dates_check" CHECK ("endsAt" > "startsAt")
);
CREATE INDEX "AgentAbsence_userId_startsAt_endsAt_idx" ON "AgentAbsence"("userId", "startsAt", "endsAt");
CREATE TABLE "FollowUpTask" (
 "id" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
 "ninjaId" TEXT REFERENCES "NinjaProfile"("id") ON DELETE RESTRICT, "reportId" TEXT REFERENCES "AgentReport"("id") ON DELETE RESTRICT,
 "assigneeId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT, "createdById" TEXT NOT NULL REFERENCES "User"("id"),
 "priority" TEXT NOT NULL DEFAULT 'NORMAL' CHECK ("priority" IN ('LOW','NORMAL','HIGH')),
 "status" TEXT NOT NULL DEFAULT 'TODO' CHECK ("status" IN ('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
 "dueAt" TIMESTAMP(3), "resolution" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "FollowUpTask_assigneeId_status_dueAt_idx" ON "FollowUpTask"("assigneeId", "status", "dueAt");
CREATE INDEX "FollowUpTask_status_dueAt_idx" ON "FollowUpTask"("status", "dueAt");
CREATE TABLE "AssignmentHistory" (
 "id" TEXT PRIMARY KEY, "ninjaId" TEXT REFERENCES "NinjaProfile"("id") ON DELETE RESTRICT,
 "taskId" TEXT REFERENCES "FollowUpTask"("id") ON DELETE RESTRICT,
 "previousAgentId" TEXT REFERENCES "User"("id"), "assignedAgentId" TEXT REFERENCES "User"("id"),
 "actorId" TEXT NOT NULL REFERENCES "User"("id"), "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AssignmentHistory_subject_check" CHECK (("ninjaId" IS NULL) <> ("taskId" IS NULL))
);
CREATE INDEX "AssignmentHistory_ninjaId_createdAt_idx" ON "AssignmentHistory"("ninjaId", "createdAt");
CREATE INDEX "AssignmentHistory_taskId_createdAt_idx" ON "AssignmentHistory"("taskId", "createdAt");
CREATE TABLE "TaskTransition" (
 "id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL REFERENCES "FollowUpTask"("id") ON DELETE RESTRICT,
 "actorId" TEXT NOT NULL REFERENCES "User"("id"), "fromStatus" TEXT, "toStatus" TEXT NOT NULL,
 "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TaskTransition_taskId_createdAt_idx" ON "TaskTransition"("taskId", "createdAt");
CREATE TABLE "AgentNote" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"), "authorId" TEXT NOT NULL REFERENCES "User"("id"),
 "body" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AgentNote_userId_createdAt_idx" ON "AgentNote"("userId", "createdAt");
CREATE TABLE "ReportReview" (
 "id" TEXT PRIMARY KEY, "reportId" TEXT NOT NULL REFERENCES "AgentReport"("id") ON DELETE RESTRICT,
 "reportVersion" INTEGER NOT NULL, "reviewerId" TEXT NOT NULL REFERENCES "User"("id"), "reviewedStatus" TEXT NOT NULL,
 "decision" TEXT NOT NULL CHECK ("decision" IN ('RETURNED','APPROVED')), "comment" TEXT, "contentSnapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReportReview_return_comment_check" CHECK ("decision" <> 'RETURNED' OR length(trim("comment")) >= 10)
);
CREATE UNIQUE INDEX "ReportReview_reportId_reportVersion_key" ON "ReportReview"("reportId", "reportVersion");
CREATE TABLE "ReportExpectation" (
 "id" TEXT PRIMARY KEY, "cadence" TEXT NOT NULL DEFAULT 'WEEKLY' CHECK ("cadence" = 'WEEKLY'),
 "population" TEXT NOT NULL DEFAULT 'ECONOMIC_AGENT' CHECK ("population" IN ('ECONOMIC_AGENT','PARTICIPANTS')),
 "effectiveFrom" TIMESTAMP(3) NOT NULL, "dueAfterDays" INTEGER NOT NULL DEFAULT 2 CHECK ("dueAfterDays" BETWEEN 0 AND 30),
 "reminders" BOOLEAN NOT NULL DEFAULT true, "createdById" TEXT NOT NULL REFERENCES "User"("id"),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReportExpectation_effectiveFrom_idx" ON "ReportExpectation"("effectiveFrom");
