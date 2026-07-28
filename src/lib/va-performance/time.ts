// ─── Business-timezone day windows ────────────────────────────────────────────
//
// A "work date" is a calendar day in the business timezone, not a UTC day.
// Every collector converts the work date to a UTC instant range before
// querying, so a VA finishing at 8pm Eastern lands on the right day rather
// than tomorrow's.

/** Milliseconds `timeZone` is ahead of UTC at the given instant. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/** The UTC instant at which `date` begins in `timeZone`. */
export function zonedDayStart(date: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T00:00:00.000Z`);
  let ts = naive;
  // Two passes settle DST boundaries: the offset depends on the instant we're
  // still solving for, so we refine once.
  for (let i = 0; i < 2; i++) ts = naive - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

export interface DayWindow {
  /** Inclusive lower bound, ISO. */
  startIso: string;
  /** Exclusive upper bound, ISO. */
  endIso: string;
  start: Date;
  end: Date;
}

export function dayWindow(date: string, timeZone: string): DayWindow {
  const start = zonedDayStart(date, timeZone);
  const nextDate = new Date(Date.parse(`${date}T12:00:00.000Z`));
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = zonedDayStart(nextDate.toISOString().slice(0, 10), timeZone);
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Median of a numeric list, or null when empty. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
