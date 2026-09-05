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

const fullDateTimeFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const fullDateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" });

export function formatDate(date: Date | null | undefined) { return date ? dateFormat.format(date) : "—"; }
export function formatDateTime(date: Date | null | undefined) { return date ? dateTimeFormat.format(date) : "—"; }
/** 05/09/2026 14:32 — the unambiguous form used by the inventory register. */
export function formatFullDateTime(date: Date | null | undefined) { return date ? fullDateTimeFormat.format(date).replace(",", "") : "—"; }
export function formatFullDate(date: Date | null | undefined) { return date ? fullDateFormat.format(date) : "—"; }

/** "il y a 2 h", "hier", "il y a 3 j", then the full date. */
export function relativeDay(date: Date | null | undefined, now = new Date()) {
  if (!date) return "—";
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "hier";
  if (days < 14) return `il y a ${days} j`;
  return fullDateFormat.format(date);
}

export function relativeTime(date: Date, now = new Date()) {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  return dateFormat.format(date);
}

export function lateYearsLabel(lateYears: number) { return lateYears === 0 ? "—" : lateYears === 1 ? "1 an RP" : `${lateYears} ans RP`; }

/** Real-world range of an RP week whose deadline is `dueAt` (Sunday midnight).
 *  The last day is counted from the start so a daylight-saving hour never adds a day. */
export function weekPeriod(dueAt: Date) {
  const start = new Date(dueAt.getTime() - 604_800_000);
  return `du ${formatDate(start)} au ${formatDate(new Date(start.getTime() + 6 * 86_400_000))}`;
}
export function formatPercentBps(bps: number) { return `${(bps / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`; }
