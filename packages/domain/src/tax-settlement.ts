/** One canonical split of an assessment balance.
 * Exemptions and adjustments first affect the non-penalty block; validated Ryō
 * then settle penalties before the remaining principal-like debt. */
export function assessmentSettlementBreakdown(input: {
  original: bigint;
  penalties: bigint;
  adjustments: bigint;
  exemptions: bigint;
  paid: bigint;
}) {
  const grossAfterExemptions = input.original + input.penalties + input.adjustments - input.exemptions;
  const currentDebt = grossAfterExemptions > input.paid ? grossAfterExemptions - input.paid : 0n;
  const unpaidPenalties = input.penalties > input.paid ? input.penalties - input.paid : 0n;
  const remainingPenalty = unpaidPenalties < currentDebt ? unpaidPenalties : currentDebt;
  return {
    grossAfterExemptions,
    currentDebt,
    remainingPenalty,
    remainingPrincipal: currentDebt - remainingPenalty
  };
}
