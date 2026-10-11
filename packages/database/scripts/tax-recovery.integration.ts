import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createRpTimeService } from "@koeki/domain";
import { generateTaxWeeks } from "../src/tax-generation";
import { refreshTaxStatuses } from "../src/tax-status-sweep";

async function main() {
  const configured = process.env.DATABASE_URL_TEST;
  if (!configured) {
    if (process.env.REQUIRE_TEST_DATABASE === "true") throw new Error("DATABASE_URL_TEST is required for fiscal integration tests");
    console.log("Fiscal integration tests skipped: no DATABASE_URL_TEST"); return;
  }
  const source = new URL(configured);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) || !source.pathname.includes("test")) throw new Error("Fiscal tests require an explicitly local test database");
  const name = `koeki_tax_recovery_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: configured });
  await admin.connect();
  let created = false;
  let db: PrismaClient | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const target = new URL(configured); target.pathname = `/${name}`;
    const connectionString = target.toString();
    execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: connectionString }, stdio: "inherit", timeout: 120_000
    });
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const config = { timezone: "Europe/Paris", dueDelayMs: 604_800_000, realAnchorAt: "2026-01-04T23:00:00.000Z", rpAnchorYear: 20, fiscalYearStartOffsetMs: 0, realMillisecondsPerRpYear: 604_800_000 };
    const service = createRpTimeService({ ...config, realAnchorAt: new Date(config.realAnchorAt) });
    const now = new Date("2026-10-11T18:00:00Z");
    await db.appSetting.upsert({ where: { key: "rpTime" }, create: { key: "rpTime", value: config }, update: { value: config } });
    await db.appSetting.upsert({ where: { key: "taxGeneration" }, create: { key: "taxGeneration", value: { lastRpYear: 56 } }, update: { value: { lastRpYear: 56 } } });
    const low = await db.ninjaGrade.create({ data: { code: "TEST_LOW", label: "Test low", sortOrder: 901 } });
    const high = await db.ninjaGrade.create({ data: { code: "TEST_HIGH", label: "Test high", sortOrder: 902 } });
    const zero = await db.ninjaGrade.create({ data: { code: "TEST_ZERO", label: "Test zero", sortOrder: 903 } });
    const policy = await db.taxPolicy.create({ data: { name: "Fiscal recovery test", version: 1, isActive: false, effectiveFromRpYear: 56, effectiveToRpYear: 59, rates: { create: [{ gradeId: low.id, amount: 10_000n }, { gradeId: high.id, amount: 15_000n }, { gradeId: zero.id, amount: 0n }] } } });
    await db.taxPolicy.create({ data: { name: "Fiscal recovery test", version: 2, isActive: true, effectiveFromRpYear: 59, rates: { create: [{ gradeId: low.id, amount: 11_000n }, { gradeId: high.id, amount: 16_000n }, { gradeId: zero.id, amount: 0n }] } } });
    const makeNinja = async (code: string, gradeId: string, at: string, status = "ACTIVE", history = true) => {
      const ninja = await db!.ninjaProfile.create({ data: { code, firstName: code, lastName: "Fixture", currentGradeId: gradeId, createdAt: new Date(at), status } });
      if (history) await db!.ninjaGradeHistory.create({ data: { ninjaId: ninja.id, gradeId, effectiveFrom: new Date(new Date(at).getTime() + 5), reason: "Fixture creation" } });
      return ninja;
    };
    const paid = await makeNinja("TAX-PAID", low.id, "2026-09-01T12:00:00Z");
    const promoted = await makeNinja("TAX-PROMOTED", low.id, "2026-09-01T12:00:00Z");
    await db.ninjaGradeHistory.updateMany({ where: { ninjaId: promoted.id }, data: { effectiveTo: new Date("2026-10-08T12:00:00Z") } });
    await db.ninjaGradeHistory.create({ data: { ninjaId: promoted.id, gradeId: high.id, effectiveFrom: new Date("2026-10-08T12:00:00Z"), reason: "Fixture promotion" } });
    await db.ninjaProfile.update({ where: { id: promoted.id }, data: { currentGradeId: high.id } });
    const newcomer = await makeNinja("TAX-NEW", low.id, "2026-10-07T12:00:00Z");
    const free = await makeNinja("TAX-ZERO", zero.id, "2026-09-01T12:00:00Z");
    const absent = await makeNinja("TAX-ARCHIVED", low.id, "2026-09-01T12:00:00Z", "ARCHIVED");
    const unknown = await makeNinja("TAX-NOHISTORY", low.id, "2026-09-01T12:00:00Z", "ACTIVE", false);
    const year = await db.taxYear.create({ data: { rpYear: 56, taxPolicyId: policy.id, startsAt: service.startOfRpYear(56), endsAt: service.endOfRpYear(56), dueAt: service.dueAt(56), generatedAt: service.startOfRpYear(56) } });
    const assessment = await db.taxAssessment.create({ data: { ninjaId: paid.id, taxYearId: year.id, taxPolicyId: policy.id, gradeCodeSnapshot: low.code, gradeLabelSnapshot: low.label, originalAmount: 10_000n, dueAt: year.dueAt, status: "PAID" } });
    const actor = await db.user.create({ data: { name: "Fiscal fixture", email: "fiscal@example.test" } });
    const payment = await db.taxPayment.create({ data: { ninjaId: paid.id, recordedById: actor.id, amount: 10_000n, status: "VALIDATED", method: "RYO", idempotencyKey: randomUUID(), receiptNumber: "TEST-FISCAL-PAID", balanceBefore: 10_000n, balanceAfter: 0n } });
    await db.taxPaymentAllocation.create({ data: { assessmentId: assessment.id, paymentId: payment.id, amount: 10_000n, allocationOrder: 1 } });
    const before = { assessments: await db.taxAssessment.count(), years: await db.taxYear.count(), audit: await db.auditLog.count(), marker: await db.appSetting.findUnique({ where: { key: "taxGeneration" } }) };
    const preview = await generateTaxWeeks(db, { now, fromRpYear: 56, expectedRpYear: 59, dryRun: true });
    assert.equal(preview.created, 0);
    assert.equal(preview.years.reduce((sum, y) => sum + y.missing, 0), 12);
    assert.equal(preview.held.filter((h) => h.ninjaId === unknown.id).length, 4);
    assert.deepEqual({ assessments: await db.taxAssessment.count(), years: await db.taxYear.count(), audit: await db.auditLog.count(), marker: await db.appSetting.findUnique({ where: { key: "taxGeneration" } }) }, before, "preview must leave every table unchanged");
    const applied = await generateTaxWeeks(db, { now, fromRpYear: 56, expectedRpYear: 59 });
    assert.equal(applied.created, 12);
    assert.deepEqual(await db.taxAssessment.findUnique({ where: { id: assessment.id } }), assessment, "paid assessment must remain identical");
    assert.equal(await db.taxPayment.count(), 1);
    assert.equal(await db.taxPaymentAllocation.count(), 1);
    assert.equal(await db.taxPenalty.count(), 0);
    assert.equal(await db.taxExemption.count(), 0);
    assert.equal(await db.exemptionLedgerEntry.count(), 0);
    assert.equal(await db.pointLedgerEntry.count(), 0);
    assert.equal(await db.taxAssessment.count({ where: { ninjaId: absent.id } }), 0);
    const latest = await db.taxAssessment.findFirstOrThrow({ where: { ninjaId: promoted.id, taxYear: { rpYear: 59 } } });
    assert.equal(latest.originalAmount, 11_000n, "historical opening grade and effective policy, not today's promotion");
    assert.equal(latest.gradeCodeSnapshot, low.code);
    assert.equal((await db.taxAssessment.findFirstOrThrow({ where: { ninjaId: promoted.id, taxYear: { rpYear: 58 } } })).originalAmount, 10_000n);
    assert.equal(await db.taxAssessment.count({ where: { ninjaId: newcomer.id } }), 1, "no billing before the profile was created");
    assert.equal(await db.taxAssessment.count({ where: { ninjaId: free.id, status: { not: "PAID" } } }), 0);
    const [repeat1, repeat2] = await Promise.all([generateTaxWeeks(db, { now, fromRpYear: 56 }), generateTaxWeeks(db, { now, fromRpYear: 56 })]);
    assert.equal(repeat1.created + repeat2.created, 0, "concurrent retry must never duplicate a weekly invoice");
    await assert.rejects(generateTaxWeeks(db, { now, fromRpYear: 60 }), /already-opened/);
    await assert.rejects(generateTaxWeeks(db, { now, fromRpYear: 56, expectedRpYear: 60 }), /week changed/);
    // The existing domain rule calls an unpaid CURRENT-week invoice DUE even
    // before its due date; the three current nonzero invoices must be normalized.
    assert.equal((await refreshTaxStatuses(db, now)).updated, 3);
    assert.equal(await db.taxAssessment.count({ where: { taxYear: { rpYear: 59 }, status: "DUE" } }), 3);
    assert.equal((await refreshTaxStatuses(db, now)).updated, 0);
    const overdue = await db.taxAssessment.findFirstOrThrow({ where: { ninjaId: promoted.id, taxYear: { rpYear: 58 } } });
    await db.taxAssessment.update({ where: { id: overdue.id }, data: { status: "UPCOMING" } });
    assert.equal((await refreshTaxStatuses(db, now)).updated, 1);
    assert.equal((await db.taxAssessment.findUniqueOrThrow({ where: { id: overdue.id } })).status, "OVERDUE");
    assert.equal((await refreshTaxStatuses(db, now)).updated, 0);
    assert.deepEqual(await db.taxPayment.findUnique({ where: { id: payment.id } }), payment, "status sweep must not alter payments");
    console.log("Fiscal PostgreSQL integration OK: read-only preview, historical grades/policies, 12 recovered invoices, preserved payment, concurrent retries, current-week and stale-status reconciliation");
  } finally {
    await db?.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
