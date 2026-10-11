import { describe, expect, it } from "vitest";
import { createRpTimeService, defaultRpTimeConfig } from "./rp-time";

const weekly = createRpTimeService({ ...defaultRpTimeConfig, realAnchorAt: new Date("2026-01-04T23:00:00.000Z"), dueDelayMs: 604_800_000 });
describe("fiscal Monday midnight calendar", () => {
  it("opens RP 60 at Paris midnight, not one hour later", () => {
    expect(weekly.currentRpYear(new Date("2026-10-11T21:59:59.999Z"))).toBe(59);
    expect(weekly.currentRpYear(new Date("2026-10-11T22:00:00.000Z"))).toBe(60);
    expect(weekly.startOfRpYear(59).toISOString()).toBe("2026-10-04T22:00:00.000Z");
    expect(weekly.endOfRpYear(59).toISOString()).toBe("2026-10-11T21:59:59.999Z");
    expect(weekly.dueAt(59).toISOString()).toBe("2026-10-11T22:00:00.000Z");
  });
  it("preserves midnight and a 167-hour spring week", () => {
    expect(weekly.startOfRpYear(31).toISOString()).toBe("2026-03-22T23:00:00.000Z");
    expect(weekly.startOfRpYear(32).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect((weekly.startOfRpYear(32).getTime() - weekly.startOfRpYear(31).getTime()) / 3_600_000).toBe(167);
    expect(weekly.dueAt(31).getTime()).toBe(weekly.startOfRpYear(32).getTime());
  });
  it("preserves midnight and a 169-hour autumn week", () => {
    expect(weekly.startOfRpYear(61).toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(weekly.startOfRpYear(62).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((weekly.startOfRpYear(62).getTime() - weekly.startOfRpYear(61).getTime()) / 3_600_000).toBe(169);
    expect(weekly.completeLateYears(weekly.startOfRpYear(61), weekly.startOfRpYear(62))).toBe(1);
    expect(weekly.completeLateYears(weekly.startOfRpYear(61), new Date(weekly.startOfRpYear(62).getTime() - 1))).toBe(0);
  });
  it("keeps progression and display within the local week", () => {
    expect(weekly.progress(weekly.startOfRpYear(62))).toBe(0);
    expect(weekly.displayRpDate(weekly.startOfRpYear(62))).toBe("Année 62 · jour 1/7");
    expect(weekly.displayRpDate(weekly.endOfRpYear(61))).toBe("Année 61 · jour 7/7");
    expect(weekly.progress(weekly.endOfRpYear(61))).toBeGreaterThan(0.99);
  });
  it("does not change default non-midnight anchors or accelerated RP clocks", () => {
    const original = createRpTimeService(defaultRpTimeConfig);
    expect(original.startOfRpYear(60).getTime()).toBe(defaultRpTimeConfig.realAnchorAt.getTime() + 40 * 604_800_000);
    const fast = createRpTimeService({ ...defaultRpTimeConfig, realMillisecondsPerRpYear: 3600_000, dueDelayMs: 900_000 });
    expect(fast.currentRpYear(new Date(defaultRpTimeConfig.realAnchorAt.getTime() + 3600_000))).toBe(21);
    expect(fast.dueAt(20).getTime() - fast.startOfRpYear(20).getTime()).toBe(900_000);
  });
});
