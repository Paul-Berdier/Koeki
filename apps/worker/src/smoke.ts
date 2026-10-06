import assert from "node:assert/strict";
import { closeCompletedRankings, prisma, sendReportReminders } from "@koeki/database";
import {
  assessmentSettlementBreakdown,
  calculateNextPenalty,
  createRpTimeService,
  defaultRpTimeConfig,
  deriveStockState,
  deriveTaxAssessmentStatus,
  exemptionUse,
  parseExemptionPolicy,
  rpTimeConfigSchema,
  ryo,
} from "@koeki/domain";

// Exercise the worker's real ESM/tsx import boundary, not TypeScript's type
// resolution alone. Never run jobs or write to a database in this smoke test.
try {
  const functions = {
    closeCompletedRankings,
    sendReportReminders,
    assessmentSettlementBreakdown,
    calculateNextPenalty,
    createRpTimeService,
    deriveStockState,
    deriveTaxAssessmentStatus,
    exemptionUse,
    parseExemptionPolicy,
    ryo,
  };
  for (const [name, value] of Object.entries(functions)) {
    assert.equal(typeof value, "function", `Missing worker runtime export: ${name}`);
  }
  assert.ok(prisma, "Prisma client must be available");
  assert.equal(rpTimeConfigSchema.safeParse(defaultRpTimeConfig).success, true);
  console.info("Worker runtime imports OK (no jobs executed, no database writes)");
} finally {
  await prisma.$disconnect();
}
