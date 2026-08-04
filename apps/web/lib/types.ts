import type { BadgeStatus } from "./format";

export interface ShellInfo { rpYear: number; rpDayLabel: string; rpProgress: number; overdueCount: number; userName: string; userRoleLabel: string }

export interface ActivityRow { code: string; label: string; subject: string; amount: bigint; direction: "in" | "out"; at: string; statusLabel: string; status: BadgeStatus }
export interface DashboardData {
  rpYear: number; expected: bigint; collected: bigint; debt: bigint; buybacks: bigint; buybackCount: number; stockValue: bigint; criticalCount: number; overdueNinjas: number;
  recoveryRateBps: number; previousDeltaBps: number | null;
  recoveryByYear: Array<{ rpYear: number; percent: number }>;
  priorities: { penaltyRateMissing: boolean; overdueCount: number; overdueOldCount: number; criticalStocks: string[]; reportsToReview: number };
  activity: ActivityRow[];
}

export interface NinjaRow { id: string; code: string; name: string; alias: string | null; grade: string; points: number; debt: bigint; badge: BadgeStatus; statusLabel: string; agent: string; due: string }
export interface NinjasData { summaryLine: string; grades: Array<{ code: string; label: string }>; ninjas: NinjaRow[]; total: number; page: number; pageCount: number }

export interface AssessmentRow { id: string; rpYear: number; gradeLabel: string; original: bigint; penalties: bigint; adjustments: bigint; exemptions: bigint; paid: bigint; remaining: bigint; statusLabel: string; badge: BadgeStatus; dueAt: string }
export interface NinjaDetailData {
  id: string; code: string; name: string; alias: string | null; clan: string | null; statusLabel: string;
  grade: { code: string; label: string }; grades: Array<{ id: string; code: string; label: string }>;
  linkedUserName: string | null; notes: string | null;
  totalDebt: bigint; lateYears: number; nextDue: string; pointsBalance: number;
  assessments: AssessmentRow[];
  pointEntries: Array<{ id: string; at: string; label: string; points: number; reason: string | null }>;
  operations: Array<{ id: string; receipt: string; label: string; amount: bigint; at: string; statusLabel: string; badge: BadgeStatus }>;
  preview: { amount: bigint; lines: Array<{ label: string; amount: bigint }>; unallocated: bigint } | null;
}

export interface RecoveryRow { id: string; name: string; code: string; debt: bigint; due: string; agent: string }
export interface RecoveryData { metrics: { priorityDebt: bigint; priorityCount: number; averageLate: string; totalDebt: bigint; unassigned: number }; rows: RecoveryRow[] }

export interface ResourceRow { id: string; code: string; name: string; category: string; unit: string; price: bigint; stock: number; badge: BadgeStatus; stateLabel: string; demand: "NONE" | "NEEDED" | "CRITICAL" }
export interface ResourcesData {
  metrics: { buybackTotal: bigint; buybackCount: number; donationValue: bigint; donationCount: number; activeCount: number; totalCount: number };
  resources: ResourceRow[];
  pendingApprovals: Array<{ id: string; receipt: string; ninja: string; total: bigint; at: string }>;
}

export interface InventoryData {
  metrics: { stockValue: bigint; movementsToday: number; inToday: number; outToday: number; criticalCount: number; lowCount: number };
  alerts: Array<{ id: string; name: string; stock: number; unit: string; level: "critical" | "low"; threshold: number }>;
  movements: Array<{ id: string; at: string; resource: string; type: string; quantity: number; unit: string; agent: string; justification: string }>;
  resources: Array<{ id: string; name: string; stock: number; unit: string }>;
}

export interface RecipeRow { id: string; code: string; name: string; category: string; minimumGrade: string | null; cost: bigint; craftable: number; duration: string; version: number }
export interface CraftingData { metrics: { activeCount: number; categoryCount: number; craftableCount: number; limitedCount: number; executions: number }; recipes: RecipeRow[] }

export interface StatisticsData {
  rpYear: number; expected: bigint; collected: bigint; remaining: bigint; rateBps: number; previousDeltaBps: number | null;
  debtByGrade: Array<{ grade: string; amount: bigint; percent: number }>;
  agents: Array<{ name: string; initials: string; payments: number; collected: bigint; transactions: number; score: number }>;
  topResources: Array<{ name: string; typeLabel: string; quantity: number; unit: string }>;
  pointsDistributed: number;
}

export interface EventRow { id: string; name: string; kindLabel: string; statusLabel: string; badge: BadgeStatus; period: string; resourceFocus: string | null; prize: bigint; rewardPoints: number; participants: number; winner: string | null; isOpen: boolean }
export interface EventsData { metrics: { open: number; finished: number; totalPrize: bigint; participants: number }; events: EventRow[] }

export interface ReportRow { id: string; period: string; agent: string; payments: number; donationBuybacks: string; processed: bigint; statusLabel: string; badge: BadgeStatus; canReview: boolean }
export interface ReportsData { metrics: { toReview: number; approved: number; covered: number; processed: bigint; corrections: number }; reports: ReportRow[] }

export interface AuditData { rows: Array<{ id: string; at: string; actor: string; action: string; entity: string; summary: string }>; total: number; page: number; pageCount: number }

export interface AdminData {
  penalty: { percentBps: number | null; isValidated: boolean; isEnabled: boolean; basis: string; maxApplications: number; maxDebt: string };
  approval: { amount: string; isValidated: boolean };
  policy: { name: string; version: number; rateCount: number } | null;
  rpTimeLabel: string;
  invitations: Array<{ id: string; role: string; ninja: string | null; statusLabel: string; badge: BadgeStatus; createdAt: string; expiresAt: string; canRevoke: boolean }>;
  users: Array<{ id: string; name: string; roles: string; revoked: boolean }>;
  roles: Array<{ id: string; code: string; label: string }>;
  freeNinjas: Array<{ id: string; code: string; name: string }>;
}
