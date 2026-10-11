import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createRpTimeService, defaultRpTimeConfig, rpTimeConfigSchema } from "@koeki/domain";

type Grade = { id: string; code: string; label: string };
type History = { grade: Grade; effectiveFrom: Date; effectiveTo: Date | null };
export interface TaxProfile { id: string; createdAt: Date; diedAt: Date | null; history: History[] }
export interface TaxWeek { rpYear: number; startsAt: Date; endsAt: Date; dueAt: Date }

/** Resolve the grade when the invoice should first have been emitted, not today's
 * grade. Initial history is inserted a few milliseconds after the profile row. */
export function gradeForTaxWeek(profile: TaxProfile, week: TaxWeek, now: Date): Grade | null {
  const end = Math.min(week.endsAt.getTime(), now.getTime());
  const start = Math.max(week.startsAt.getTime(), profile.createdAt.getTime());
  if (start > end || (profile.diedAt && week.dueAt > profile.diedAt)) return null;
  const history = [...profile.history].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  let matches = history.filter((h) => h.effectiveFrom.getTime() <= start && (!h.effectiveTo || h.effectiveTo.getTime() > start));
  if (matches.length > 1) return null;
  if (!matches.length && start === profile.createdAt.getTime()) {
    const initial = history[0];
    if (initial && initial.effectiveFrom.getTime() >= start && initial.effectiveFrom.getTime() - start <= 60_000 && initial.effectiveFrom.getTime() <= end) matches = [initial];
  }
  const initial = matches[0];
  if (!initial) return null;
  if (initial.grade.code !== "UNKNOWN") return initial.grade;
  // Preserve grade-resolution semantics: the first real grade within this week.
  return history.find((h) => h.grade.code !== "UNKNOWN" && h.effectiveFrom.getTime() >= start && h.effectiveFrom.getTime() <= end)?.grade ?? null;
}

export interface TaxGenerationOptions { now?: Date; fromRpYear?: number; dryRun?: boolean; expectedRpYear?: number }
export interface TaxGenerationResult {
  rpYear: number; fromRpYear: number; dryRun: boolean; created: number; repaired: number;
  years: Array<{ rpYear: number; missing: number; created: number; amount: string; held: number }>;
  held: Array<{ rpYear: number; ninjaId: string; reason: string }>;
}

function hasLifecycleChange(event: { action: string; previousValues: Prisma.JsonValue | null; newValues: Prisma.JsonValue | null }) {
  if (/^NINJA_(ARCHIVED|RESTORED|DECEASED|DELETED)$/.test(event.action)) return true;
  const previous = event.previousValues as { status?: unknown } | null;
  const next = event.newValues as { status?: unknown } | null;
  return typeof next?.status === "string" && typeof previous?.status === "string" && previous.status !== next.status;
}

/** Add missing weekly assessments only. Existing paid, waived, cancelled and legacy
 * real-grade zero lines, and every settlement ledger, are preserved. Explicit
 * recovery is bounded, previewable and repeats safely via the unique constraint. */
export async function generateTaxWeeks(db: PrismaClient, options: TaxGenerationOptions = {}): Promise<TaxGenerationResult> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid tax generation date");
  return db.$transaction(async (tx) => {
    if (options.dryRun) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    else await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714423)`;
    const setting = await tx.appSetting.findUnique({ where: { key: "rpTime" } });
    const config = setting ? rpTimeConfigSchema.parse(setting.value) : defaultRpTimeConfig;
    const service = createRpTimeService(config);
    const current = service.currentRpYear(now);
    if (options.expectedRpYear !== undefined && options.expectedRpYear !== current) throw new Error("RP week changed since the repair was reviewed");
    const marker = await tx.appSetting.findUnique({ where: { key: "taxGeneration" } });
    const last = (marker?.value as { lastRpYear?: unknown } | undefined)?.lastRpYear;
    if (last !== undefined && (!Number.isSafeInteger(last) || (last as number) > current)) throw new Error("Invalid taxGeneration marker; manual review required");
    const from = options.fromRpYear ?? (typeof last === "number" ? Math.min(last, current - 1) : current);
    if (!Number.isSafeInteger(from) || from > current || current - from > 12) throw new Error("Tax recovery must cover 1 to 13 already-opened RP weeks");
    if (!options.dryRun) await tx.$queryRaw`SELECT "id" FROM "NinjaProfile" ORDER BY "id" FOR UPDATE`;
    const policies = await tx.taxPolicy.findMany({ include: { rates: true }, orderBy: [{ effectiveFromRpYear: "desc" }, { version: "desc" }, { createdAt: "desc" }] });
    const profiles = await tx.ninjaProfile.findMany({ where: { status: "ACTIVE", createdAt: { lte: now } }, select: { id: true, createdAt: true, diedAt: true } });
    const histories = await tx.ninjaGradeHistory.findMany({ where: { ninjaId: { in: profiles.map((p) => p.id) }, effectiveFrom: { lte: now } }, include: { grade: true }, orderBy: { effectiveFrom: "asc" } });
    const byNinja = new Map<string, History[]>();
    for (const h of histories) { const rows = byNinja.get(h.ninjaId) ?? []; rows.push(h); byNinja.set(h.ninjaId, rows); }
    const oldWeeks = await tx.taxYear.findMany({ where: { rpYear: { gte: from, lte: current } } });
    const earliest = new Date(Math.min(service.startOfRpYear(from).getTime(), ...oldWeeks.map((w) => w.startsAt.getTime())));
    const events = await tx.auditLog.findMany({ where: { entityType: "NinjaProfile", createdAt: { gte: earliest, lte: now } }, select: { entityId: true, action: true, createdAt: true, previousValues: true, newValues: true } });
    const changes = events.filter(hasLifecycleChange);
    const result: TaxGenerationResult = { rpYear: current, fromRpYear: from, dryRun: options.dryRun === true, created: 0, repaired: 0, years: [], held: [] };
    for (let year = from; year <= current; year++) {
      const stored = oldWeeks.find((w) => w.rpYear === year);
      // Do not turn an old imported calendar row into a billing run on first use.
      if (options.fromRpYear === undefined && typeof last === "number" && year < last && !stored?.generatedAt) continue;
      const week: TaxWeek = stored ?? { rpYear: year, startsAt: service.startOfRpYear(year), endsAt: service.endOfRpYear(year), dueAt: service.dueAt(year) };
      const policy = policies.find((p) => p.effectiveFromRpYear <= year && (p.effectiveToRpYear === null || p.effectiveToRpYear > year));
      if (!policy) throw new Error(`No historical tax policy for RP ${year}`);
      const existing = stored ? await tx.taxAssessment.findMany({ where: { taxYearId: stored.id }, select: { ninjaId: true } }) : [];
      const billed = new Set(existing.map((a) => a.ninjaId));
      const planned: Array<{ ninjaId: string; grade: Grade; amount: bigint }> = [];
      const heldBefore = result.held.length;
      for (const profile of profiles) {
        if (billed.has(profile.id) || profile.createdAt > week.endsAt) continue;
        const initialAt = Math.max(profile.createdAt.getTime(), week.startsAt.getTime());
        if (changes.some((e) => e.entityId === profile.id && e.createdAt.getTime() >= initialAt)) {
          result.held.push({ rpYear: year, ninjaId: profile.id, reason: "Lifecycle changed; review before back-billing" }); continue;
        }
        const grade = gradeForTaxWeek({ ...profile, history: byNinja.get(profile.id) ?? [] }, week, now);
        if (!grade) { result.held.push({ rpYear: year, ninjaId: profile.id, reason: "Missing or ambiguous historical grade / lifecycle" }); continue; }
        const rate = policy.rates.find((r) => r.gradeId === grade.id);
        if (!rate) throw new Error(`Missing tax rate for grade ${grade.code} in RP ${year}`);
        planned.push({ ninjaId: profile.id, grade, amount: rate.amount });
      }
      let created = 0;
      if (!options.dryRun) {
        const taxYear = await tx.taxYear.upsert({ where: { rpYear: year }, create: { rpYear: year, taxPolicyId: policy.id, startsAt: week.startsAt, endsAt: week.endsAt, dueAt: week.dueAt, generatedAt: now }, update: { generatedAt: stored?.generatedAt ?? now } });
        if (planned.length) {
          const inserted = await tx.taxAssessment.createMany({ data: planned.map((p) => ({ ninjaId: p.ninjaId, taxYearId: taxYear.id, taxPolicyId: policy.id, gradeCodeSnapshot: p.grade.code, gradeLabelSnapshot: p.grade.label, originalAmount: p.amount, dueAt: week.dueAt, status: p.amount === 0n ? "PAID" as const : week.dueAt <= now ? "OVERDUE" as const : "UPCOMING" as const })), skipDuplicates: true });
          created = inserted.count;
          if (created > 0) await tx.auditLog.create({ data: { action: "TAX_WEEK_RECOVERED", entityType: "TaxYear", entityId: taxYear.id, requestId: randomUUID(), reason: `RP ${year}: ${created} missing invoices restored without modifying settlements`, newValues: { rpYear: year, created, taxPolicyId: policy.id, ninjaIds: planned.map((p) => p.ninjaId) } } });
        }
        // Retain the existing, narrowly scoped current-week UNKNOWN placeholder repair.
        if (year === current) {
          const placeholders = await tx.taxAssessment.findMany({ where: { taxYearId: taxYear.id, gradeCodeSnapshot: "UNKNOWN", originalAmount: 0n, status: { in: ["UPCOMING", "DUE", "OVERDUE", "PARTIALLY_PAID", "PAID"] }, ninja: { status: "ACTIVE", currentGrade: { code: { not: "UNKNOWN" } } }, allocations: { none: {} }, exemptions: { none: {} }, penalties: { none: {} }, adjustments: { none: {} } }, include: { ninja: { include: { currentGrade: true } } } });
          for (const assessment of placeholders) {
            const grade = assessment.ninja.currentGrade;
            const rate = policy.rates.find((r) => r.gradeId === grade.id);
            if (!rate) throw new Error(`Missing tax rate for resolved grade ${grade.code}`);
            await tx.taxAssessment.update({ where: { id: assessment.id }, data: { taxPolicyId: policy.id, gradeCodeSnapshot: grade.code, gradeLabelSnapshot: grade.label, originalAmount: rate.amount, dueAt: week.dueAt, status: rate.amount === 0n ? "PAID" : week.dueAt <= now ? "OVERDUE" : "UPCOMING", version: { increment: 1 } } });
            result.repaired++;
            await tx.auditLog.create({ data: { action: "TAX_GRADE_RESOLVED", entityType: "TaxAssessment", entityId: assessment.id, requestId: randomUUID(), previousValues: { grade: "UNKNOWN", amount: "0" }, newValues: { grade: grade.code, amount: String(rate.amount) } } });
          }
        }
      }
      result.created += created;
      result.years.push({ rpYear: year, missing: planned.length, created, amount: String(planned.reduce((sum, p) => sum + p.amount, 0n)), held: result.held.length - heldBefore });
    }
    if (!options.dryRun) {
      const value = { lastRpYear: current, at: now.toISOString(), held: result.held.length };
      await tx.appSetting.upsert({ where: { key: "taxGeneration" }, create: { key: "taxGeneration", value }, update: { value, version: { increment: 1 } } });
      if (result.held.length) console.warn(JSON.stringify({ command: "taxes:review-required", count: result.held.length, fromRpYear: from, rpYear: current }));
    }
    return result;
  }, { isolationLevel: options.dryRun ? "RepeatableRead" : "ReadCommitted", timeout: 180_000, maxWait: 15_000 });
}
