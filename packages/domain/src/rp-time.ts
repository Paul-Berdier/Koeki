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
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const civilAt = (date: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), date.getUTCMilliseconds());
  };
  const anchorCivil = civilAt(config.realAnchorAt);
  const localAnchor = new Date(anchorCivil);
  // The production configuration explicitly anchors a seven-day fiscal cycle at
  // Monday 00:00 in Europe/Paris. Preserve that civil boundary (167/169-hour DST
  // weeks), rather than drifting to 01:00 in summer. Other RP time scales and
  // non-midnight anchors retain the original fixed-duration behaviour.
  const calendarWeeks = duration === 7 * 86_400_000 && config.fiscalYearStartOffsetMs === 0
    && localAnchor.getUTCDay() === 1 && localAnchor.getUTCHours() === 0
    && localAnchor.getUTCMinutes() === 0 && localAnchor.getUTCSeconds() === 0 && localAnchor.getUTCMilliseconds() === 0;
  const instantAt = (civil: number) => {
    let instant = civil;
    for (let attempt = 0; attempt < 4; attempt++) {
      const delta = civil - civilAt(new Date(instant));
      if (delta === 0) return new Date(instant);
      instant += delta;
    }
    throw new Error("Fiscal calendar boundary does not exist in the configured timezone");
  };
  const yearAt = (date: Date) => config.rpAnchorYear + Math.floor(((calendarWeeks ? civilAt(date) : date.getTime()) - (calendarWeeks ? anchorCivil : anchor)) / duration);
  const startOf = (rpYear: number) => calendarWeeks
    ? instantAt(anchorCivil + (rpYear - config.rpAnchorYear) * duration)
    : new Date(anchor + (rpYear - config.rpAnchorYear) * duration + config.fiscalYearStartOffsetMs);
  return {
    currentRpYear: (now = new Date()) => yearAt(now),
    startOfRpYear: startOf,
    endOfRpYear: (rpYear: number) => new Date(startOf(rpYear + 1).getTime() - 1),
    dueAt: (rpYear: number) => calendarWeeks
      ? instantAt(anchorCivil + (rpYear - config.rpAnchorYear) * duration + config.dueDelayMs)
      : new Date(startOf(rpYear).getTime() + config.dueDelayMs),
    completeLateYears(dueAt: Date, now = new Date()) {
      return Math.max(0, Math.floor(((calendarWeeks ? civilAt(now) : now.getTime()) - (calendarWeeks ? civilAt(dueAt) : dueAt.getTime())) / duration));
    },
    progress(now = new Date()) {
      const year = yearAt(now), start = startOf(year).getTime(), length = startOf(year + 1).getTime() - start;
      return Math.min(1, Math.max(0, (now.getTime() - start) / length));
    },
    displayRpDate(now = new Date()) {
      const year = yearAt(now);
      const elapsed = calendarWeeks ? civilAt(now) - (anchorCivil + (year - config.rpAnchorYear) * duration) : now.getTime() - startOf(year).getTime();
      return `Année ${year} · jour ${Math.floor((elapsed / duration) * 7) + 1}/7`;
    }
  };
}

export const defaultRpTimeConfig: RpTimeConfig = {
  realAnchorAt: new Date("2026-01-05T00:00:00.000Z"), rpAnchorYear: 20,
  realMillisecondsPerRpYear: 7 * 24 * 60 * 60 * 1000, timezone: "Europe/Paris",
  fiscalYearStartOffsetMs: 0, dueDelayMs: 3 * 24 * 60 * 60 * 1000
};
