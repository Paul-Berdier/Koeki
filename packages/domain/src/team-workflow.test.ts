import { describe, expect, it } from "vitest";
import { assertReportReview, assertTaskTransition, isReportExpected, participationLabel } from "./team-workflow";

describe("report review", () => {
  const review = { authorId: "a", actorId: "m", status: "SUBMITTED", version: 3, expectedVersion: 3, decision: "RETURNED" as const, comment: "Décrire les incidents" };
  it("requires a correction and preserves optimistic concurrency", () => {
    expect(() => assertReportReview(review)).not.toThrow();
    expect(() => assertReportReview({ ...review, comment: " " })).toThrow();
    expect(() => assertReportReview({ ...review, expectedVersion: 2 })).toThrow();
    expect(() => assertReportReview({ ...review, actorId: "a" })).toThrow();
    expect(() => assertReportReview({ ...review, status: "APPROVED" })).toThrow();
  });
});
describe("task boundaries", () => {
  const transition = { from: "TODO" as const, to: "IN_PROGRESS" as const, manager: false, assignedToActor: true, reason: "" };
  it("restricts updates to assignee and manager-only lifecycle", () => {
    expect(() => assertTaskTransition(transition)).not.toThrow();
    expect(() => assertTaskTransition({ ...transition, assignedToActor: false })).toThrow();
    expect(() => assertTaskTransition({ ...transition, to: "CANCELLED", reason: "Annulation" })).toThrow();
    expect(() => assertTaskTransition({ ...transition, from: "DONE" })).toThrow();
    expect(() => assertTaskTransition({ ...transition, to: "BLOCKED" })).toThrow();
    expect(() => assertTaskTransition({ ...transition, manager: true, from: "DONE", reason: "Dossier rouvert" })).not.toThrow();
  });
});
describe("participation and expectations", () => {
  const date = (day: number) => new Date(Date.UTC(2026, 9, day));
  const expected = { periodStart: date(5), periodEnd: date(11), effectiveFrom: date(4), participationStart: date(1), participationEnd: null, absences: [] };
  it("does not invent retroactive obligations or ignore absences/entries/exits", () => {
    expect(isReportExpected(expected)).toBe(true);
    expect(isReportExpected({ ...expected, effectiveFrom: date(6) })).toBe(false);
    expect(isReportExpected({ ...expected, participationStart: date(6) })).toBe(false);
    expect(isReportExpected({ ...expected, participationEnd: date(10) })).toBe(false);
    expect(isReportExpected({ ...expected, absences: [{ startsAt: date(6), endsAt: date(7) }] })).toBe(false);
  });
  it("does not label inactivity as misconduct", () => {
    expect(participationLabel({ revoked: false, participates: true, recent: false, absent: false, hasActivity: false })).toBe("Aucune activité enregistrée");
  });
});
