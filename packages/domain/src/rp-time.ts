import { z } from "zod";

export const rpTimeConfigSchema = z.object({
  realAnchorAt: z.coerce.date(),
  rpAnchorYear: z.number().int(),
  realMillisecondsPerRpYear: z.number().int().positive(),
  timezone: z.string().min(1),
  fiscalYearStartOffsetMs: z.number().int().nonnegative().default(0),
  dueDelayMs: z.number().int().nonnegative()
});
export type RpTimeConfig = z.infer<typeof rpTimeConfigSchema>;

export function createRpTimeService(input: RpTimeConfig) {
  const config = rpTimeConfigSchema.parse(input);
  const anchor = config.realAnchorAt.getTime();
  const duration = config.realMillisecondsPerRpYear;
  const yearAt = (date: Date) => config.rpAnchorYear + Math.floor((date.getTime() - anchor) / duration);
  const startOf = (rpYear: number) => new Date(anchor + (rpYear - config.rpAnchorYear) * duration + config.fiscalYearStartOffsetMs);
  return {
    currentRpYear: (now = new Date()) => yearAt(now),
    startOfRpYear: startOf,
    endOfRpYear: (rpYear: number) => new Date(startOf(rpYear + 1).getTime() - 1),
    dueAt: (rpYear: number) => new Date(startOf(rpYear).getTime() + config.dueDelayMs),
    completeLateYears(dueAt: Date, now = new Date()) { return Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / duration)); },
    progress(now = new Date()) { const year = yearAt(now); return Math.min(1, Math.max(0, (now.getTime() - startOf(year).getTime()) / duration)); },
    displayRpDate(now = new Date()) { const year = yearAt(now); return `Année ${year} · jour ${Math.floor(((now.getTime() - startOf(year).getTime()) / duration) * 7) + 1}/7`; }
  };
}

export const defaultRpTimeConfig: RpTimeConfig = {
  realAnchorAt: new Date("2026-01-05T00:00:00.000Z"), rpAnchorYear: 20,
  realMillisecondsPerRpYear: 7 * 24 * 60 * 60 * 1000, timezone: "Europe/Paris",
  fiscalYearStartOffsetMs: 0, dueDelayMs: 3 * 24 * 60 * 60 * 1000
};
