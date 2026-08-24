export interface LegacySettlementLine {
  ryo: bigint;
  credit: bigint;
  debt: bigint;
}

/** Plans settlement of zero-priced old-register weeks without ever letting
 * exemption credit exceed the configured share of a debt created for the line. */
export function planLegacySettlement(input: {
  weeks: number;
  ryo: bigint;
  availableCredit: bigint;
  coverageBps: number;
}): { lines: LegacySettlementLine[]; unusedCredit: bigint } | null {
  if (!Number.isInteger(input.weeks) || input.weeks <= 0 || input.ryo < 0n || input.availableCredit < 0n) return null;
  const coverageBps = Math.max(0, Math.min(10_000, Math.trunc(input.coverageBps)));
  const count = BigInt(input.weeks);
  if (coverageBps < 10_000 && input.ryo < count) return null;
  const distributable = coverageBps >= 10_000 ? input.ryo + input.availableCredit : input.ryo;
  if (distributable < count) return null;

  const share = distributable / count;
  let remainder = distributable % count;
  let creditLeft = input.availableCredit;
  const lines: LegacySettlementLine[] = [];
  for (let index = 0; index < input.weeks; index++) {
    const base = share + (remainder > 0n ? 1n : 0n);
    if (remainder > 0n) remainder -= 1n;
    let ryo: bigint;
    let credit: bigint;
    if (coverageBps >= 10_000) {
      credit = creditLeft < base ? creditLeft : base;
      ryo = base - credit;
    } else {
      ryo = base;
      const capacity = coverageBps <= 0 ? 0n : (ryo * BigInt(coverageBps)) / BigInt(10_000 - coverageBps);
      credit = creditLeft < capacity ? creditLeft : capacity;
    }
    creditLeft -= credit;
    lines.push({ ryo, credit, debt: ryo + credit });
  }
  return { lines, unusedCredit: creditLeft };
}
