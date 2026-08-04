import { z } from "zod";

export type Ryo = bigint & { readonly __brand: "Ryo" };
export const ryoInputSchema = z.union([z.bigint(), z.number().int().safe(), z.string().regex(/^\d+$/)]);

export function ryo(value: bigint | number | string): Ryo {
  const parsed = ryoInputSchema.parse(value);
  const amount = typeof parsed === "bigint" ? parsed : BigInt(parsed);
  if (amount < 0n) throw new Error("A money amount cannot be negative");
  return amount as Ryo;
}

export function addRyo(...amounts: Ryo[]): Ryo { return amounts.reduce((sum, amount) => sum + amount, 0n) as Ryo; }
export function subtractRyo(amount: Ryo, deduction: Ryo): Ryo {
  if (deduction > amount) throw new Error("A money amount cannot become negative");
  return (amount - deduction) as Ryo;
}
export function percentOf(amount: Ryo, basisPoints: number): Ryo {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) throw new Error("Basis points must be a positive integer");
  return ((amount * BigInt(basisPoints)) / 10_000n) as Ryo;
}
