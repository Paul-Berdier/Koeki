import { describe, expect, it } from "vitest";
import { formatReportDate, isReportPeriodComplete, normalizeReportPeriod, shiftReportDate } from "./report-period";

describe("report periods in Europe/Paris", () => {
  it("uses the Paris summer offset for complete civil days", () => {
    const period = normalizeReportPeriod("2026-07-15", "2026-07-15");
    expect(period.start.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-15T21:59:59.999Z");
  });

  it("uses the Paris winter offset", () => {
    const period = normalizeReportPeriod("2026-01-15", "2026-01-16");
    expect(period.start.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-01-16T22:59:59.999Z");
  });

  it("handles the daylight-saving transition inside one civil day", () => {
    const period = normalizeReportPeriod("2026-03-29", "2026-03-29");
    expect(period.start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-03-29T21:59:59.999Z");
  });

  it("formats persisted instants back to their Paris civil date", () => {
    expect(formatReportDate(new Date("2026-07-14T22:00:00.000Z"))).toBe("2026-07-15");
    expect(shiftReportDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("rejects invalid and reversed periods", () => {
    expect(() => normalizeReportPeriod("2026-02-30", "2026-03-01")).toThrow("Date invalide");
    expect(() => normalizeReportPeriod("2026-03-02", "2026-03-01")).toThrow("La fin de période doit suivre le début");
  });

  it("only considers a period complete after its Paris end of day", () => {
    const period = normalizeReportPeriod("2026-08-11", "2026-08-11");
    expect(isReportPeriodComplete(period.end, new Date("2026-08-11T12:00:00.000Z"))).toBe(false);
    expect(isReportPeriodComplete(period.end, new Date("2026-08-11T22:00:00.000Z"))).toBe(true);
  });
});
