// Pure, deterministic statistics computations — the /statistics page assembles its
// queries in apps/web/lib/data.ts and delegates every calculation here so it stays
// testable without a database. All money is bigint Ryō, all rates are basis points.

export interface CycleTotals { expected: bigint; collected: bigint }

export interface AssessmentTotalsRow { original: bigint; penalties: bigint; adjustments: bigint; exemptions: bigint; paid: bigint }
export interface SettlementTotals { expected: bigint; collected: bigint; exempted: bigint; settled: bigint }

/** Cycle accounting rule: expected stays GROSS (original + penalties + adjustments) and a tax
 *  covered by exemption credit counts as settled alongside ryō payments — the donation economy
 *  must read as recovery, never as shrinking expectations. */
export function settlementTotals(rows: AssessmentTotalsRow[]): SettlementTotals {
  let expected = 0n, collected = 0n, exempted = 0n;
  for (const row of rows) {
    expected += row.original + row.penalties + row.adjustments;
    collected += row.paid;
    exempted += row.exemptions;
  }
  return { expected, collected, exempted, settled: collected + exempted };
}

/** Share of `part` in `total`, in basis points (floored). A non-positive total yields 0. */
export const rateBps = (part: bigint, total: bigint): number => (total > 0n ? Number((part * 10_000n) / total) : 0);

/** Collection-rate delta between two cycles, or null when either cycle expected nothing. */
export const rateDeltaBps = (current: CycleTotals, previous: CycleTotals): number | null =>
  current.expected > 0n && previous.expected > 0n
    ? rateBps(current.collected, current.expected) - rateBps(previous.collected, previous.expected)
    : null;

export const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();

export interface AmountBar { label: string; amount: bigint; percent: number }

/** Sorted horizontal-bar rows; percent is relative to the largest amount (0 when empty). */
export function buildAmountBars(entries: Array<{ label: string; amount: bigint }>): AmountBar[] {
  const max = entries.reduce((top, entry) => (entry.amount > top ? entry.amount : top), 0n);
  return entries
    .map((entry) => ({ label: entry.label, amount: entry.amount, percent: max > 0n ? Number((entry.amount * 100n) / max) : 0 }))
    .sort((a, b) => (a.amount === b.amount ? a.label.localeCompare(b.label) : b.amount > a.amount ? 1 : -1));
}

export interface AgentActivity { name: string; payments: number; collected: bigint; donations: number; buybacks: number }
export interface AgentScoreRow extends AgentActivity { initials: string; transactions: number; score: number }

/** Composite agent score: 60 % operation volume, 40 % amounts handled — never money alone.
 *  Scores are relative to the busiest agent of the cycle, so the leader is near 100. */
export function buildAgentScores(rows: AgentActivity[]): AgentScoreRow[] {
  const maxVolume = Math.max(1, ...rows.map((row) => row.payments + row.donations + row.buybacks));
  const maxCollected = rows.reduce((top, row) => (row.collected > top ? row.collected : top), 1n);
  return rows
    .map((row) => {
      const transactions = row.donations + row.buybacks;
      const volumeScore = (row.payments + transactions) / maxVolume;
      const amountScore = Number((row.collected * 100n) / maxCollected) / 100;
      return { ...row, transactions, initials: initialsOf(row.name), score: Math.round(100 * (0.6 * volumeScore + 0.4 * amountScore)) };
    })
    .sort((a, b) => b.score - a.score);
}

export interface ResourceFlowLine { resourceId: string; type: "DONATION" | "BUYBACK"; name: string; quantity: number }
export interface ResourceFlowRow { name: string; type: "DONATION" | "BUYBACK"; quantity: number }

/** Aggregates transaction lines per (resource, flow direction) and keeps the busiest ones. */
export function buildTopResources(lines: ResourceFlowLine[], limit = 5): ResourceFlowRow[] {
  const totals = new Map<string, ResourceFlowRow>();
  for (const line of lines) {
    const key = `${line.resourceId}:${line.type}`;
    const entry = totals.get(key) ?? { name: line.name, type: line.type, quantity: 0 };
    entry.quantity += line.quantity;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
}

export interface NinjaPointsRow { name: string; code: string; points: number }

/** Cycle leaderboard: positive point earners only, best first, ties broken by name. */
export function buildNinjaLeaderboard(rows: NinjaPointsRow[], limit = 5): NinjaPointsRow[] {
  return rows
    .filter((row) => row.points > 0)
    .sort((a, b) => (b.points === a.points ? a.name.localeCompare(b.name) : b.points - a.points))
    .slice(0, limit);
}

export interface WeekCompliance { settled: number; pending: number; overdue: number; total: number; settledRateBps: number }

/** Snapshot of the cycle's tax lines: settled (paid or fully exempted), still open, late. */
export function summarizeWeekCompliance(statuses: string[]): WeekCompliance {
  let settled = 0, pending = 0, overdue = 0;
  for (const status of statuses) {
    if (status === "PAID" || status === "EXEMPT") settled++;
    else if (status === "OVERDUE") overdue++;
    else if (status === "DUE" || status === "UPCOMING" || status === "PARTIALLY_PAID") pending++;
  }
  const total = settled + pending + overdue;
  return { settled, pending, overdue, total, settledRateBps: total > 0 ? Math.floor((settled * 10_000) / total) : 0 };
}

export interface ExemptionFlow { granted: bigint; spent: bigint; outstanding: bigint }

/** Exemption-credit economy: cycle inflow (positive entries), cycle outflow (negative
 *  entries, returned as a positive magnitude) and the all-time outstanding balance. */
export function summarizeExemptionFlow(entries: Array<{ amount: bigint; createdAt: Date }>, since: Date): ExemptionFlow {
  let granted = 0n, spent = 0n, outstanding = 0n;
  for (const entry of entries) {
    outstanding += entry.amount;
    if (entry.createdAt < since) continue;
    if (entry.amount > 0n) granted += entry.amount;
    else spent -= entry.amount;
  }
  return { granted, spent, outstanding };
}
