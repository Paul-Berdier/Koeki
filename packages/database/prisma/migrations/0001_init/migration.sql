-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'KOEKI_MANAGER', 'ECONOMIC_AGENT', 'NINJA', 'AUDITOR');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'USED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaxAssessmentStatus" AS ENUM ('DRAFT', 'UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'EXEMPT', 'WAIVED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PenaltyBasis" AS ENUM ('ORIGINAL_TAX', 'REMAINING_PRINCIPAL', 'CURRENT_DEBT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VALIDATED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('DISCOUNT', 'PENALTY_REVERSAL', 'DUE_DATE_EXTENSION', 'SUSPENSION', 'CORRECTION', 'EXCEPTIONAL_DEBT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PointMode" AS ENUM ('FIXED', 'PER_AMOUNT', 'PERCENTAGE', 'MULTIPLIER', 'MANUAL');

-- CreateEnum
CREATE TYPE "PointEventType" AS ENUM ('TAX_PAYMENT', 'ON_TIME_PAYMENT', 'EARLY_PAYMENT', 'REGULARIZATION', 'DONATION', 'RESOURCE_SALE', 'SPECIAL_EVENT', 'MANUAL_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ResourceTransactionType" AS ENUM ('DONATION', 'BUYBACK');

-- CreateEnum
CREATE TYPE "ResourceTransactionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'VALIDATED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('DONATION_IN', 'BUYBACK_IN', 'CRAFT_CONSUMPTION', 'CRAFT_OUTPUT', 'MANUAL_ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOSS');

-- CreateEnum
CREATE TYPE "CraftStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'RETURNED', 'APPROVED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "image" TEXT,
    "discordId" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "expiresAt" INTEGER,
    "tokenType" TEXT,
    "scope" TEXT,
    "idToken" TEXT,
    "sessionState" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "sessionVersion" INTEGER NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" "RoleCode" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "roleId" TEXT NOT NULL,
    "ninjaProfileId" TEXT,
    "createdById" TEXT NOT NULL,
    "consumedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NinjaGrade" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NinjaGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NinjaProfile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "alias" TEXT,
    "imageUrl" TEXT,
    "clan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentGradeId" TEXT NOT NULL,
    "referenceAgentId" TEXT,
    "userId" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NinjaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NinjaGradeHistory" (
    "id" TEXT NOT NULL,
    "ninjaId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "changedById" TEXT,

    CONSTRAINT "NinjaGradeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFromRpYear" INTEGER NOT NULL,
    "effectiveToRpYear" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPolicyGradeRate" (
    "id" TEXT NOT NULL,
    "taxPolicyId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "TaxPolicyGradeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxYear" (
    "id" TEXT NOT NULL,
    "rpYear" INTEGER NOT NULL,
    "taxPolicyId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "TaxYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxAssessment" (
    "id" TEXT NOT NULL,
    "ninjaId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "taxPolicyId" TEXT NOT NULL,
    "gradeCodeSnapshot" TEXT NOT NULL,
    "gradeLabelSnapshot" TEXT NOT NULL,
    "originalAmount" BIGINT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaxAssessmentStatus" NOT NULL DEFAULT 'UPCOMING',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TaxAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPenalty" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "applicationIndex" INTEGER NOT NULL,
    "rpYearApplied" INTEGER NOT NULL,
    "percentBps" INTEGER NOT NULL,
    "basis" "PenaltyBasis" NOT NULL,
    "basisAmount" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedByAdjustmentId" TEXT,

    CONSTRAINT "TaxPenalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPayment" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "ninjaId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "allocationOrder" INTEGER NOT NULL,

    CONSTRAINT "TaxPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxAdjustment" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "paymentId" TEXT,
    "type" "AdjustmentType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reversesAdjustmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxExemption" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxExemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventType" "PointEventType" NOT NULL,
    "mode" "PointMode" NOT NULL,
    "fixedPoints" INTEGER,
    "amountStep" BIGINT,
    "pointsPerStep" INTEGER,
    "multiplierBps" INTEGER,
    "minimum" INTEGER,
    "maximum" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PointRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointLedgerEntry" (
    "id" TEXT NOT NULL,
    "ninjaId" TEXT NOT NULL,
    "ruleId" TEXT,
    "eventType" "PointEventType" NOT NULL,
    "points" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reason" TEXT,
    "reversesEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "ResourceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceUnit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "ResourceUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "minimumStock" DECIMAL(20,4) NOT NULL,
    "criticalStock" DECIMAL(20,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourcePriceHistory" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "pricePerUnit" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ResourcePriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceTransaction" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "type" "ResourceTransactionType" NOT NULL,
    "status" "ResourceTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "ninjaId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceTransactionItem" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "qualityMultiplierBps" INTEGER NOT NULL DEFAULT 10000,
    "unitPriceSnapshot" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,

    CONSTRAINT "ResourceTransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unitCost" BIGINT,
    "transactionId" TEXT,
    "craftExecutionId" TEXT,
    "agentId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraftRecipe" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "durationRpMinutes" INTEGER NOT NULL,
    "cost" BIGINT NOT NULL,
    "minimumGradeCode" TEXT,
    "requiredProfession" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "status" "CraftStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "CraftRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraftRecipeIngredient" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "CraftRecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraftRecipeOutput" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "CraftRecipeOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraftExecution" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CraftExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentReport" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "incidents" TEXT,
    "stockIssues" TEXT,
    "followUps" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "collectedAmount" BIGINT NOT NULL DEFAULT 0,
    "donationCount" INTEGER NOT NULL DEFAULT 0,
    "buybackCount" INTEGER NOT NULL DEFAULT 0,
    "processedValue" BIGINT NOT NULL DEFAULT 0,
    "correctionCount" INTEGER NOT NULL DEFAULT 0,
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "previousValues" JSONB,
    "newValues" JSONB,
    "reason" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_expires_idx" ON "Session"("userId", "expires");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_ninjaProfileId_key" ON "Invitation"("ninjaProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_consumedById_key" ON "Invitation"("consumedById");

-- CreateIndex
CREATE INDEX "Invitation_status_expiresAt_idx" ON "Invitation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "NinjaGrade_code_key" ON "NinjaGrade"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NinjaProfile_code_key" ON "NinjaProfile"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NinjaProfile_userId_key" ON "NinjaProfile"("userId");

-- CreateIndex
CREATE INDEX "NinjaProfile_lastName_firstName_idx" ON "NinjaProfile"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "NinjaProfile_currentGradeId_status_idx" ON "NinjaProfile"("currentGradeId", "status");

-- CreateIndex
CREATE INDEX "NinjaGradeHistory_ninjaId_effectiveFrom_idx" ON "NinjaGradeHistory"("ninjaId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPolicy_name_version_key" ON "TaxPolicy"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPolicyGradeRate_taxPolicyId_gradeId_key" ON "TaxPolicyGradeRate"("taxPolicyId", "gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxYear_rpYear_key" ON "TaxYear"("rpYear");

-- CreateIndex
CREATE INDEX "TaxAssessment_status_dueAt_idx" ON "TaxAssessment"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaxAssessment_ninjaId_taxYearId_key" ON "TaxAssessment"("ninjaId", "taxYearId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPenalty_reversedByAdjustmentId_key" ON "TaxPenalty"("reversedByAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPenalty_assessmentId_applicationIndex_key" ON "TaxPenalty"("assessmentId", "applicationIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPayment_receiptNumber_key" ON "TaxPayment"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPayment_idempotencyKey_key" ON "TaxPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TaxPayment_ninjaId_createdAt_idx" ON "TaxPayment"("ninjaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPaymentAllocation_paymentId_assessmentId_allocationOrder_key" ON "TaxPaymentAllocation"("paymentId", "assessmentId", "allocationOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TaxAdjustment_reversesAdjustmentId_key" ON "TaxAdjustment"("reversesAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PointLedgerEntry_reversesEntryId_key" ON "PointLedgerEntry"("reversesEntryId");

-- CreateIndex
CREATE INDEX "PointLedgerEntry_ninjaId_createdAt_idx" ON "PointLedgerEntry"("ninjaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointLedgerEntry_sourceType_sourceId_eventType_key" ON "PointLedgerEntry"("sourceType", "sourceId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceCategory_code_key" ON "ResourceCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceUnit_code_key" ON "ResourceUnit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_code_key" ON "Resource"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ResourcePriceHistory_resourceId_effectiveFrom_key" ON "ResourcePriceHistory"("resourceId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceTransaction_receiptNumber_key" ON "ResourceTransaction"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceTransaction_idempotencyKey_key" ON "ResourceTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_resourceId_occurredAt_idx" ON "InventoryMovement"("resourceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CraftRecipe_code_version_key" ON "CraftRecipe"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CraftRecipeIngredient_recipeId_resourceId_key" ON "CraftRecipeIngredient"("recipeId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CraftRecipeOutput_recipeId_resourceId_key" ON "CraftRecipeOutput"("recipeId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CraftExecution_idempotencyKey_key" ON "CraftExecution"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentReport_authorId_periodStart_periodEnd_key" ON "AgentReport"("authorId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Notification_userId_status_createdAt_idx" ON "Notification"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_scope_createdAt_idx" ON "IdempotencyKey"("scope", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_ninjaProfileId_fkey" FOREIGN KEY ("ninjaProfileId") REFERENCES "NinjaProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_consumedById_fkey" FOREIGN KEY ("consumedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NinjaProfile" ADD CONSTRAINT "NinjaProfile_currentGradeId_fkey" FOREIGN KEY ("currentGradeId") REFERENCES "NinjaGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NinjaProfile" ADD CONSTRAINT "NinjaProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NinjaGradeHistory" ADD CONSTRAINT "NinjaGradeHistory_ninjaId_fkey" FOREIGN KEY ("ninjaId") REFERENCES "NinjaProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NinjaGradeHistory" ADD CONSTRAINT "NinjaGradeHistory_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "NinjaGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPolicyGradeRate" ADD CONSTRAINT "TaxPolicyGradeRate_taxPolicyId_fkey" FOREIGN KEY ("taxPolicyId") REFERENCES "TaxPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPolicyGradeRate" ADD CONSTRAINT "TaxPolicyGradeRate_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "NinjaGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxYear" ADD CONSTRAINT "TaxYear_taxPolicyId_fkey" FOREIGN KEY ("taxPolicyId") REFERENCES "TaxPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAssessment" ADD CONSTRAINT "TaxAssessment_ninjaId_fkey" FOREIGN KEY ("ninjaId") REFERENCES "NinjaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAssessment" ADD CONSTRAINT "TaxAssessment_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAssessment" ADD CONSTRAINT "TaxAssessment_taxPolicyId_fkey" FOREIGN KEY ("taxPolicyId") REFERENCES "TaxPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPenalty" ADD CONSTRAINT "TaxPenalty_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "TaxAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPayment" ADD CONSTRAINT "TaxPayment_ninjaId_fkey" FOREIGN KEY ("ninjaId") REFERENCES "NinjaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPaymentAllocation" ADD CONSTRAINT "TaxPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "TaxPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPaymentAllocation" ADD CONSTRAINT "TaxPaymentAllocation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "TaxAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAdjustment" ADD CONSTRAINT "TaxAdjustment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "TaxAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxAdjustment" ADD CONSTRAINT "TaxAdjustment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "TaxPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxExemption" ADD CONSTRAINT "TaxExemption_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "TaxAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLedgerEntry" ADD CONSTRAINT "PointLedgerEntry_ninjaId_fkey" FOREIGN KEY ("ninjaId") REFERENCES "NinjaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLedgerEntry" ADD CONSTRAINT "PointLedgerEntry_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PointRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ResourceUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourcePriceHistory" ADD CONSTRAINT "ResourcePriceHistory_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceTransaction" ADD CONSTRAINT "ResourceTransaction_ninjaId_fkey" FOREIGN KEY ("ninjaId") REFERENCES "NinjaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceTransactionItem" ADD CONSTRAINT "ResourceTransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ResourceTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceTransactionItem" ADD CONSTRAINT "ResourceTransactionItem_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ResourceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_craftExecutionId_fkey" FOREIGN KEY ("craftExecutionId") REFERENCES "CraftExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftRecipeIngredient" ADD CONSTRAINT "CraftRecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "CraftRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftRecipeIngredient" ADD CONSTRAINT "CraftRecipeIngredient_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftRecipeOutput" ADD CONSTRAINT "CraftRecipeOutput_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "CraftRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftRecipeOutput" ADD CONSTRAINT "CraftRecipeOutput_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftExecution" ADD CONSTRAINT "CraftExecution_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "CraftRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReport" ADD CONSTRAINT "AgentReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
