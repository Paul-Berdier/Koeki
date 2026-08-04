import type { Ryo } from "./money";
import { ryo } from "./money";

export interface DebtLine { id: string; assessmentId: string; rpYear: number; kind: "PENALTY" | "PRINCIPAL"; remaining: Ryo; }
export interface Allocation { debtLineId: string; assessmentId: string; amount: Ryo; }

export function allocatePayment(payment: Ryo, debts: DebtLine[]): { allocations: Allocation[]; unallocated: Ryo } {
  let remaining = payment as bigint;
  const sorted = [...debts].sort((a, b) => a.rpYear - b.rpYear || (a.kind === "PENALTY" ? -1 : 1));
  const allocations: Allocation[] = [];
  for (const debt of sorted) {
    if (remaining === 0n) break;
    const amount = remaining > debt.remaining ? debt.remaining : (remaining as Ryo);
    if (amount > 0n) allocations.push({ debtLineId: debt.id, assessmentId: debt.assessmentId, amount: amount as Ryo });
    remaining -= amount;
  }
  return { allocations, unallocated: ryo(remaining) };
}
