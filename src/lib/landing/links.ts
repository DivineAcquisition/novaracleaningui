// Links from the marketing site (novaracleaning.com) into the booking flow
// (try.novaracleaning.com). Paths stay relative: on novaracleaning.com the
// middleware forwards /book/* to try.*, and on try.* or a preview they are
// served directly, so one link works everywhere.

const CARRY = ["ref", "fbclid", "gclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** Booking flow URL with extra params, carrying attribution from the current page. */
export function bookingHref(path = "/book/zip", extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (typeof window !== "undefined") {
    const here = new URLSearchParams(window.location.search);
    for (const k of CARRY) {
      const v = here.get(k);
      if (v) params.set(k, v);
    }
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/** Where every "Book now" button on the marketing site goes. */
export const BOOK_PATH = "/book/zip";
