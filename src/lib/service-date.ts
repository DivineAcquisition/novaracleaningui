// ─── Service dates are calendar days, not instants ───────────────────────────
//
// `bookings.service_date` is a Postgres DATE, so it arrives as "2026-08-05".
// `new Date("2026-08-05")` parses that as UTC midnight, which in any negative
// offset — including every timezone we operate in — is the EVENING BEFORE. So a
// customer who books August 5th gets a confirmation page congratulating them on
// August 4th, which is exactly the kind of detail that makes people phone in to
// check whether their booking is real.
//
// Appending a midday local time sidesteps it: noon is far enough from both
// boundaries that no DST shift can push it into an adjacent day.
//
// Use these helpers anywhere a bare YYYY-MM-DD string is turned into a Date.

/**
 * Parse a service date as the local calendar day it represents.
 *
 * Accepts a bare "YYYY-MM-DD" (anchored at local noon) or a full timestamp
 * (passed through untouched, since it already carries an offset).
 */
export function parseServiceDate(value: string | null | undefined): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  // A bare date, or the date half of an ISO timestamp with no zone information.
  const bare = /^(\d{4}-\d{2}-\d{2})$/.exec(raw);
  const d = bare ? new Date(`${bare[1]}T12:00:00`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today as "YYYY-MM-DD" in the viewer's own calendar. */
export function todayServiceDate(): string {
  return toServiceDate(new Date()) as string;
}

/**
 * Serialize a Date to "YYYY-MM-DD" using its LOCAL calendar day.
 *
 * `toISOString().split("T")[0]` is the trap on this side: after 8pm Eastern it
 * yields tomorrow, so an evening booking gets stored a day late.
 */
export function toServiceDate(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Human label for a service date. Defaults to the long form the confirmation
 * page uses ("Wednesday, August 5, 2026").
 */
export function formatServiceDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  },
): string {
  const d = parseServiceDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", options);
}
