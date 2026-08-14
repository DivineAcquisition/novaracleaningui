// Calendar-month windows in America/New_York.

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function firstOfMonth(dateYmd: string): string {
  return `${dateYmd.slice(0, 7)}-01`;
}

export function lastOfMonth(dateYmd: string): string {
  const d = new Date(`${firstOfMonth(dateYmd)}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return ymd(d);
}

export function addMonths(dateYmd: string, months: number): string {
  const d = new Date(`${firstOfMonth(dateYmd)}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return ymd(d).slice(0, 8) + "01";
}

function todayInZone(now: Date, timeZone: string): string {
  const local = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${local.year}-${local.month}-${local.day}`;
}

export function priorCompletedMonth(now: Date, timeZone: string): { start: string; end: string } {
  const thisMonth = firstOfMonth(todayInZone(now, timeZone));
  const start = addMonths(thisMonth, -1);
  return { start, end: lastOfMonth(start) };
}

export function formatMonthLabel(start: string): string {
  return new Date(`${firstOfMonth(start)}T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatRangeLabel(start: string, end: string): string {
  if (start.endsWith("-01") && lastOfMonth(start) === end) return formatMonthLabel(start);
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function monthsInclusive(firstMonthStart: string, lastMonthStart: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  let cur = firstOfMonth(firstMonthStart);
  const last = firstOfMonth(lastMonthStart);
  while (cur <= last) {
    out.push({ start: cur, end: lastOfMonth(cur) });
    cur = addMonths(cur, 1);
  }
  return out;
}
