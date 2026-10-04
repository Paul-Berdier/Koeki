export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

/** Agents only change assigned work; objectives and allocation remain managerial. */
export function assertTaskTransition(input: { from: TaskStatus; to: TaskStatus; manager: boolean; assignedToActor: boolean; reason: string }) {
  if (!input.manager && !input.assignedToActor) throw new Error("FORBIDDEN");
  if (input.from === input.to) throw new Error("VALIDATION:Cette tâche possède déjà cet état");
  const closed = input.from === "DONE" || input.from === "CANCELLED";
  if (!input.manager && (closed || input.to === "CANCELLED")) throw new Error("FORBIDDEN");
  if ((closed || input.to === "CANCELLED" || input.to === "BLOCKED" || input.to === "DONE") && input.reason.trim().length < 5) throw new Error("VALIDATION:Précisez une justification ou résolution (5 caractères minimum)");
}

export function assertReportReview(input: { authorId: string; actorId: string; status: string; version: number; expectedVersion: number; decision: "APPROVED" | "RETURNED"; comment: string }) {
  if (input.authorId === input.actorId) throw new Error("VALIDATION:Vous ne pouvez pas examiner votre propre rapport");
  if (input.status !== "SUBMITTED") throw new Error("VALIDATION:Ce rapport n’attend plus de décision");
  if (input.version !== input.expectedVersion) throw new Error("VALIDATION:Cette version du rapport est obsolète. Rechargez le rapport");
  if (input.decision === "RETURNED" && input.comment.trim().length < 10) throw new Error("VALIDATION:Expliquez la correction attendue (10 caractères minimum)");
}

export function participationLabel(input: { revoked: boolean; participates: boolean; recent: boolean; absent: boolean; hasActivity: boolean }) {
  if (input.revoked) return "Compte désactivé";
  if (!input.participates) return "Sortie du service";
  if (input.absent) return "Absence déclarée";
  if (input.recent) return "Entrée récente";
  return input.hasActivity ? "En activité" : "Aucune activité enregistrée";
}

/** A rule never creates an obligation for a period already begun before its effect. */
export function isReportExpected(input: { periodStart: Date; periodEnd: Date; effectiveFrom: Date; participationStart: Date; participationEnd: Date | null; absences: { startsAt: Date; endsAt: Date }[] }) {
  return input.periodStart >= input.effectiveFrom && input.participationStart <= input.periodStart
    && (!input.participationEnd || input.participationEnd > input.periodEnd)
    && !input.absences.some((absence) => absence.startsAt <= input.periodEnd && absence.endsAt > input.periodStart);
}
