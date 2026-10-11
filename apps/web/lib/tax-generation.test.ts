import { describe, expect, it } from "vitest";
import { gradeForTaxWeek, type TaxProfile, type TaxWeek } from "../../../packages/database/src/tax-generation";

const low = { id: "grade-low", code: "GENIN_CONFIRMED", label: "Genin confirmé" };
const high = { id: "grade-high", code: "CHUNIN", label: "Chūnin" };
const unknown = { id: "grade-unknown", code: "UNKNOWN", label: "Inconnu" };
const week: TaxWeek = { rpYear: 59, startsAt: new Date("2026-10-04T22:00:00Z"), endsAt: new Date("2026-10-11T21:59:59.999Z"), dueAt: new Date("2026-10-11T22:00:00Z") };
const now = new Date("2026-10-11T18:00:00Z");
const profile = (overrides: Partial<TaxProfile> = {}): TaxProfile => ({ id: "ninja", createdAt: new Date("2026-09-01T00:00:00Z"), diedAt: null, history: [{ grade: low, effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: null }], ...overrides });
describe("historical weekly tax grade", () => {
  it("uses the opening grade rather than a later promotion", () => {
    const promoted = profile({ history: [{ grade: low, effectiveFrom: new Date("2026-09-01"), effectiveTo: new Date("2026-10-08") }, { grade: high, effectiveFrom: new Date("2026-10-08"), effectiveTo: null }] });
    expect(gradeForTaxWeek(promoted, week, now)).toEqual(low);
  });
  it("accepts initial history recorded milliseconds after profile creation", () => {
    const at = new Date("2026-10-07T10:00:00Z");
    expect(gradeForTaxWeek(profile({ createdAt: at, history: [{ grade: low, effectiveFrom: new Date(at.getTime() + 5), effectiveTo: null }] }), week, now)).toEqual(low);
  });
  it("never bills a week before the profile existed", () => {
    expect(gradeForTaxWeek(profile({ createdAt: new Date("2026-10-12") }), week, now)).toBeNull();
  });
  it("does not guess a missing initial grade from an unrelated later promotion", () => {
    expect(gradeForTaxWeek(profile({ createdAt: new Date("2026-10-06"), history: [{ grade: high, effectiveFrom: new Date("2026-10-08"), effectiveTo: null }] }), week, now)).toBeNull();
  });
  it("resolves UNKNOWN only with a real grade inside the eligible week", () => {
    const p = profile({ history: [{ grade: unknown, effectiveFrom: new Date("2026-09-01"), effectiveTo: new Date("2026-10-08") }, { grade: high, effectiveFrom: new Date("2026-10-08"), effectiveTo: null }] });
    expect(gradeForTaxWeek(p, week, now)).toEqual(high);
    expect(gradeForTaxWeek(p, week, new Date("2026-10-07"))).toBeNull();
  });
  it("holds overlapping history rather than selecting an arbitrary grade", () => {
    expect(gradeForTaxWeek(profile({ history: [{ grade: low, effectiveFrom: new Date("2026-09-01"), effectiveTo: null }, { grade: high, effectiveFrom: new Date("2026-09-02"), effectiveTo: null }] }), week, now)).toBeNull();
  });
  it("does not charge an assessment due after death", () => {
    expect(gradeForTaxWeek(profile({ diedAt: new Date("2026-10-09") }), week, now)).toBeNull();
  });
});
