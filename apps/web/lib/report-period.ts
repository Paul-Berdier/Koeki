const REPORT_TIME_ZONE = "Europe/Paris";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const parisParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function partsAt(date: Date) {
  const values = Object.fromEntries(parisParts.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second)
  };
}

function parseDateOnly(value: string) {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new Error("Date invalide");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) throw new Error("Date invalide");
  return { year, month, day };
}

function atParisTime(value: string, endOfDay: boolean) {
  const { year, month, day } = parseDateOnly(value);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;
  const target = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = partsAt(new Date(instant));
    const represented = Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute, current.second, millisecond);
    const correction = target - represented;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant);
}

export function normalizeReportPeriod(startValue: string, endValue: string) {
  const start = atParisTime(startValue, false);
  const end = atParisTime(endValue, true);
  if (end < start) throw new Error("La fin de période doit suivre le début");
  return { start, end };
}

export function formatReportDate(date: Date) {
  const { year, month, day } = partsAt(date);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function shiftReportDate(value: string, days: number) {
  const { year, month, day } = parseDateOnly(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear().toString().padStart(4, "0")}-${(shifted.getUTCMonth() + 1).toString().padStart(2, "0")}-${shifted.getUTCDate().toString().padStart(2, "0")}`;
}

export function isReportPeriodComplete(end: Date, now = new Date()) {
  return end <= now;
}
