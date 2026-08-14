// Monday–Sunday windows in America/New_York (same grain as the weekly report).

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

export function mondayOnOrBefore(dateYmd: string): string {
  const d = new Date(`${dateYmd}T12:00:00.000Z`);
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(dateYmd, -back);
}

export function priorCompletedWeek(now: Date, timeZone: string): { start: string; end: string } {
  const local = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const today = `${local.year}-${local.month}-${local.day}`;
  const thisMonday = mondayOnOrBefore(today);
  const start = addDays(thisMonday, -7);
  return { start, end: addDays(start, 6) };
}

export function formatRangeLabel(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function weeksInclusive(firstMonday: string, lastMonday: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  let cur = firstMonday;
  while (cur <= lastMonday) {
    out.push({ start: cur, end: addDays(cur, 6) });
    cur = addDays(cur, 7);
  }
  return out;
}
