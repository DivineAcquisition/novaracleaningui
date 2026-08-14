// Monday–Sunday windows in the operator timezone (default America/New_York).

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/** Offset of `timeZone` at `date`, in milliseconds (ET summer ≈ -4h). */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Instant UTC for local midnight on `ymd` in `timeZone`. */
export function zonedMidnightUtc(dateYmd: string, timeZone: string): Date {
  const noonUtc = new Date(`${dateYmd}T12:00:00.000Z`);
  const offset = tzOffsetMs(noonUtc, timeZone);
  return new Date(Date.parse(`${dateYmd}T00:00:00.000Z`) - offset);
}

export function periodBounds(startYmd: string, endYmd: string, timeZone: string): {
  startIso: string;
  endIso: string;
} {
  const start = zonedMidnightUtc(startYmd, timeZone);
  const end = zonedMidnightUtc(addDays(endYmd, 1), timeZone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function mondayOnOrBefore(dateYmd: string): string {
  const d = new Date(`${dateYmd}T12:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(dateYmd, -back);
}

/** Most recently completed Mon–Sun as of `now` in `timeZone`. */
export function priorCompletedWeek(now: Date, timeZone: string): { start: string; end: string } {
  const local = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const today = `${local.year}-${local.month}-${local.day}`;
  const thisMonday = mondayOnOrBefore(today);
  // If today is Monday before the run completes, the week that just ended
  // is still last week. Any other day, the last full week is the Monday
  // before this week's Monday.
  const start = addDays(thisMonday, -7);
  return { start, end: addDays(start, 6) };
}

export function zonedNowParts(now: Date, timeZone: string): { weekday: number; hour: number; ymd: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[parts.weekday] ?? 1,
    hour: Number(parts.hour),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function formatRangeLabel(start: string, end: string): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T12:00:00.000Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}
