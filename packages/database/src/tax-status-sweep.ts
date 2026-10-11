import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createRpTimeService, defaultRpTimeConfig, deriveTaxAssessmentStatus, rpTimeConfigSchema } from "@koeki/domain";

/** Reconcile status caches against immutable settlements. This never creates a
 * penalty, changes a payment, consumes credit or erases a legacy late marker. */
export async function refreshTaxStatuses(db: PrismaClient, now = new Date()) {
  const setting = await db.appSetting.findUnique({ where: { key: "rpTime" } });
  const service = createRpTimeService(setting ? rpTimeConfigSchema.parse(setting.value) : defaultRpTimeConfig);
  const currentRpYear = service.currentRpYear(now);
  const profiles = await db.ninjaProfile.findMany({ where: { status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } });
  let updated = 0;
  for (const profile of profiles) {
    updated += await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "NinjaProfile" WHERE "id" = ${profile.id} FOR UPDATE`;
      if (locked[0]?.status !== "ACTIVE") return 0;
      const rows = await tx.taxAssessment.findMany({
        where: { ninjaId: profile.id, status: { in: ["UPCOMING", "DUE", "PARTIALLY_PAID", "OVERDUE", "PAID"] }, taxYear: { rpYear: { lte: currentRpYear } } },
        include: { taxYear: { select: { rpYear: true } }, penalties: { select: { amount: true } }, adjustments: { select: { amount: true } }, exemptions: { select: { amount: true } }, allocations: { select: { amount: true, payment: { select: { status: true } } } } }
      });
      const changes: Array<{ id: string; before: string; after: string }> = [];
      for (const row of rows) {
        const sum = (entries: Array<{ amount: bigint }>) => entries.reduce((total, entry) => total + entry.amount, 0n);
        const paid = sum(row.allocations.filter((entry) => entry.payment.status === "VALIDATED"));
        const penalties = sum(row.penalties), adjustments = sum(row.adjustments), exemptions = sum(row.exemptions);
        const remaining = row.originalAmount + penalties + adjustments - exemptions - paid;
        const status = deriveTaxAssessmentStatus({ storedStatus: row.status, remaining: remaining > 0n ? remaining : 0n, settled: paid + exemptions,
          preserveLegacyOverdue: row.status === "OVERDUE" && row.gradeCodeSnapshot === "ANCIEN" && row.originalAmount === 0n && penalties === 0n && adjustments === 0n && exemptions === 0n && paid === 0n,
          dueAt: row.dueAt, now, assessmentRpYear: row.taxYear.rpYear, currentRpYear });
        if (status === row.status) continue;
        await tx.taxAssessment.update({ where: { id: row.id }, data: { status, version: { increment: 1 } } });
        changes.push({ id: row.id, before: row.status, after: status });
      }
      if (changes.length) await tx.auditLog.create({ data: { action: "TAX_STATUSES_RECONCILED", entityType: "NinjaProfile", entityId: profile.id, requestId: randomUUID(), reason: "États fiscaux recalculés depuis les écritures, sans modification des montants", newValues: { changes, at: now.toISOString() } } });
      return changes.length;
    }, { timeout: 30_000, maxWait: 15_000 });
  }
  return { command: "taxes:statuses", rpYear: currentRpYear, updated };
}
