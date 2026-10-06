import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { closeCompletedRankings, prisma, sendReportReminders } from "../src/index";

// Legacy CLI scripts use CommonJS globals such as __dirname. Preserve that
// package scope while the database library itself is ESM. Do NOT execute the
// destructive import-legacy command to test compatibility.
async function main() {
  try {
    assert.equal(typeof __dirname, "string");
    assert.equal(isAbsolute(__dirname), true);
    assert.equal(typeof closeCompletedRankings, "function");
    assert.equal(typeof sendReportReminders, "function");
    assert.ok(prisma);
    console.info("Legacy CLI scope and database interop OK (no database writes)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
