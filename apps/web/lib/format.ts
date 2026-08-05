import type { TaxAssessmentStatus } from "@koeki/database";

export type BadgeStatus = "paid" | "due" | "overdue" | "warning" | "pending" | "draft";

export const assessmentStatusLabels: Record<TaxAssessmentStatus, string> = {
  DRAFT: "Brouillon", UPCOMING: "À venir", DUE: "À payer", PARTIALLY_PAID: "Partiellement payée", PAID: "Payée",
  OVERDUE: "En retard", EXEMPT: "Exonérée", WAIVED: "Remise", SUSPENDED: "Suspendue", CANCELLED: "Annulée"
};

export function assessmentBadge(status: TaxAssessmentStatus): BadgeStatus {
  if (status === "PAID" || status === "EXEMPT" || status === "WAIVED") return "paid";
  if (status === "OVERDUE") return "overdue";
  if (status === "DUE") return "due";
  if (status === "PARTIALLY_PAID") return "warning";
  if (status === "UPCOMING") return "pending";
  return "draft";
}

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "Europe/Paris" });
const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

export function formatDate(date: Date | null | undefined) { return date ? dateFormat.format(date) : "—"; }
export function formatDateTime(date: Date | null | undefined) { return date ? dateTimeFormat.format(date) : "—"; }

export function relativeTime(date: Date, now = new Date()) {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  return dateFormat.format(date);
}

export function lateYearsLabel(lateYears: number) { return lateYears === 0 ? "—" : lateYears === 1 ? "1 an RP" : `${lateYears} ans RP`; }

/** Real-world range of an RP week whose deadline is `dueAt` (Sunday midnight). */
export function weekPeriod(dueAt: Date) { return `du ${formatDate(new Date(dueAt.getTime() - 604_800_000))} au ${formatDate(new Date(dueAt.getTime() - 60_000))}`; }
export function formatPercentBps(bps: number) { return `${(bps / 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`; }
