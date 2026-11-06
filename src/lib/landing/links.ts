// Links into the booking flow. Every booking starts at the ZIP form in the
// landing page hero (/#get-price); the old /book/zip page redirects there.

const CARRY = ["ref", "fbclid", "gclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** Booking flow URL with extra params, carrying attribution from the current page. */
export function bookingHref(path = "/", extra: Record<string, string> = {}): string {
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
  const [base, hash] = path.split("#");
  return `${base}${q ? `?${q}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Where every "Book now" button on the try site goes: its ZIP form. */
export const BOOK_PATH = "/#get-price";

/** The booking site. The main novaracleaning.com home page sends homeowners here. */
export const TRY_URL = "https://try.novaracleaning.com/";
