import { describe, expect, it } from "vitest";
import { deriveTaxAssessmentStatus } from "./tax-assessment-status";

const now = new Date("2026-08-24T12:00:00.000Z");

describe("tax assessment status", () => {
  it("marks an expired balance overdue, never paid", () => {
    expect(deriveTaxAssessmentStatus({ storedStatus: "DUE", remaining: 7_000n, settled: 3_000n, preserveLegacyOverdue: false, dueAt: new Date("2026-08-23T00:00:00.000Z"), now, assessmentRpYear: 50, currentRpYear: 50 })).toBe("OVERDUE");
  });

  it("only marks a ledger-balanced assessment paid", () => {
    expect(deriveTaxAssessmentStatus({ storedStatus: "OVERDUE", remaining: 0n, settled: 10_000n, preserveLegacyOverdue: false, dueAt: new Date("2026-08-23T00:00:00.000Z"), now, assessmentRpYear: 50, currentRpYear: 50 })).toBe("PAID");
  });

  it("keeps a partial payment open before its due date", () => {
    expect(deriveTaxAssessmentStatus({ storedStatus: "DUE", remaining: 7_000n, settled: 3_000n, preserveLegacyOverdue: false, dueAt: new Date("2026-08-30T00:00:00.000Z"), now, assessmentRpYear: 50, currentRpYear: 50 })).toBe("PARTIALLY_PAID");
  });

  it("recognises a partial or complete exemption as settlement", () => {
    expect(deriveTaxAssessmentStatus({ storedStatus: "DUE", remaining: 7_500n, settled: 2_500n, preserveLegacyOverdue: false, dueAt: new Date("2026-08-30T00:00:00.000Z"), now, assessmentRpYear: 50, currentRpYear: 50 })).toBe("PARTIALLY_PAID");
    expect(deriveTaxAssessmentStatus({ storedStatus: "OVERDUE", remaining: 0n, settled: 10_000n, preserveLegacyOverdue: false, dueAt: new Date("2026-08-23T00:00:00.000Z"), now, assessmentRpYear: 50, currentRpYear: 50 })).toBe("PAID");
  });

  it("preserves only an explicitly identified unpriced legacy overdue line", () => {
    expect(deriveTaxAssessmentStatus({ storedStatus: "OVERDUE", remaining: 0n, settled: 0n, preserveLegacyOverdue: true, dueAt: new Date("2026-08-23T00:00:00.000Z"), now, assessmentRpYear: 49, currentRpYear: 50 })).toBe("OVERDUE");
  });
});
