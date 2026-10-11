import assert from "node:assert/strict";
import { closeCompletedRankings, prisma, sendReportReminders } from "@koeki/database";
import { assessmentSettlementBreakdown, calculateNextPenalty, createRpTimeService, defaultRpTimeConfig, deriveStockState, deriveTaxAssessmentStatus, exemptionUse, parseExemptionPolicy, rpTimeConfigSchema, ryo } from "@koeki/domain";
import { generateTaxWeeks, gradeForTaxWeek } from "../../../packages/database/src/tax-generation";
import { refreshTaxStatuses } from "../../../packages/database/src/tax-status-sweep";

// Exercise real ESM/tsx imports, including the production Docker Node version.
// Never run jobs or write to a database in this smoke test.
try {
  const functions = { closeCompletedRankings, sendReportReminders, assessmentSettlementBreakdown, calculateNextPenalty, createRpTimeService, deriveStockState, deriveTaxAssessmentStatus, exemptionUse, parseExemptionPolicy, ryo, generateTaxWeeks, gradeForTaxWeek, refreshTaxStatuses };
  for (const [name, value] of Object.entries(functions)) assert.equal(typeof value, "function", `Missing worker runtime export: ${name}`);
  assert.ok(prisma, "Prisma client must be available");
  assert.equal(rpTimeConfigSchema.safeParse(defaultRpTimeConfig).success, true);
  console.info("Worker runtime imports OK (no jobs executed, no database writes)");
} finally { await prisma.$disconnect(); }
