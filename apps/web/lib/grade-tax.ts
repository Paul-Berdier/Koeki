import { Prisma } from "@koeki/database";
import { autoCoverOpenTaxes, refreshAssessmentStatus } from "./finance";

interface RpWeekService {
  currentRpYear(at?: Date): number;
  startOfRpYear(rpYear: number): Date;
  endOfRpYear(rpYear: number): Date;
  dueAt(rpYear: number): Date;
}

/** Resolves the current-week zero line created while a legacy profile had no grade.
 * Historical weeks and ordinary promotions stay immutable. */
export async function billCurrentWeekAfterGradeResolution(
  tx: Prisma.TransactionClient,
  service: RpWeekService,
  input: { ninjaId: string; grade: { id: string; code: string; label: string }; actorId: string }
) {
  const rpYear = service.currentRpYear();
  const policy = await tx.taxPolicy.findFirst({ where: { isActive: true }, include: { rates: true } });
  if (!policy) throw new Error("VALIDATION:Aucun barème fiscal actif — le grade n’a pas été modifié");
  const rate = policy.rates.find((entry) => entry.gradeId === input.grade.id);
  if (!rate) throw new Error(`VALIDATION:Aucun montant fiscal n’est configuré pour le grade ${input.grade.label}`);

  const now = new Date();
  const taxYear = await tx.taxYear.upsert({
    where: { rpYear },
    create: {
      rpYear,
      taxPolicyId: policy.id,
      startsAt: service.startOfRpYear(rpYear),
      endsAt: service.endOfRpYear(rpYear),
      dueAt: service.dueAt(rpYear),
      generatedAt: now
    },
    update: {}
  });
  const existing = await tx.taxAssessment.findUnique({
    where: { ninjaId_taxYearId: { ninjaId: input.ninjaId, taxYearId: taxYear.id } },
    include: {
      allocations: { select: { id: true } },
      exemptions: { select: { id: true } },
      penalties: { select: { id: true } },
      adjustments: { select: { id: true } }
    }
  });

  let assessmentId: string;
  if (!existing) {
    const assessment = await tx.taxAssessment.create({ data: {
      ninjaId: input.ninjaId,
      taxYearId: taxYear.id,
      taxPolicyId: policy.id,
      gradeCodeSnapshot: input.grade.code,
      gradeLabelSnapshot: input.grade.label,
      originalAmount: rate.amount,
      dueAt: taxYear.dueAt,
      status: taxYear.dueAt > now ? "UPCOMING" : "DUE"
    } });
    assessmentId = assessment.id;
  } else if (existing.gradeCodeSnapshot === "UNKNOWN") {
    const protectedStatus = ["DRAFT", "EXEMPT", "WAIVED", "SUSPENDED", "CANCELLED"].includes(existing.status);
    const hasFinancialHistory = existing.allocations.length > 0 || existing.exemptions.length > 0 || existing.penalties.length > 0 || existing.adjustments.length > 0;
    if (existing.originalAmount !== 0n || protectedStatus || hasFinancialHistory) {
      throw new Error("VALIDATION:La semaine en cours comporte déjà une décision financière — régularisez-la avant de modifier le grade");
    }
    await tx.taxAssessment.update({
      where: { id: existing.id },
      data: {
        taxPolicyId: policy.id,
        gradeCodeSnapshot: input.grade.code,
        gradeLabelSnapshot: input.grade.label,
        originalAmount: rate.amount,
        dueAt: taxYear.dueAt,
        status: taxYear.dueAt > now ? "UPCOMING" : "DUE",
        version: { increment: 1 }
      }
    });
    assessmentId = existing.id;
  } else {
    // A real-grade line already exists for this week: the unique weekly invoice is
    // deliberately not repriced by an ordinary (non-retroactive) grade change.
    return { rpYear, amount: existing.originalAmount, covered: 0n, billed: false };
  }

  const covered = rate.amount > 0n
    ? await autoCoverOpenTaxes(tx, input.ninjaId, input.actorId, `grade-update:${input.ninjaId}:${rpYear}`)
    : 0n;
  await refreshAssessmentStatus(tx, assessmentId, rpYear);
  return { rpYear, amount: rate.amount, covered, billed: true };
}
