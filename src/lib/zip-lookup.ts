// ─── ZIP → state / city helpers ──────────────────────────────────────────
//
// Lightweight, fully-client-side lookup that turns a 5-digit US ZIP into a
// state code (always) and a best-guess primary city name (when available
// via the free Zippopotam.us API).
//
// Why both?
//   • The state mapping is built from official USPS ZIP-prefix ranges, so it
//     works offline and is instantaneous — perfect for keeping the State
//     field auto-filled the moment the customer types or confirms their ZIP.
//   • The city lookup requires a network call; we use it to populate a
//     dropdown of likely city names so the customer can pick instead of
//     typing. If the API fails or returns nothing we silently fall back to
//     a freeform input.
//
// References:
//   • USPS — ZIP code prefix ranges per state (3-digit prefix table).
//   • Zippopotam.us — open, no-auth REST API (https://api.zippopotam.us/us/<zip>).

/**
 * Look up the USPS state code for a ZIP using a 3-digit prefix table.
 * Returns "" when the prefix is unknown (e.g. Puerto Rico / territories).
 */
export function stateFromZip(zip: string): string {
  const digits = (zip || "").replace(/\D/g, "");
  if (digits.length < 3) return "";
  const prefix = parseInt(digits.slice(0, 3), 10);
  if (isNaN(prefix)) return "";

  // Each row: [startPrefix, endPrefix, stateCode]. Compiled from the
  // official USPS three-digit ZIP-prefix-to-state table. Ranges are
  // inclusive on both ends.
  const ranges: Array<[number, number, string]> = [
    [5, 5, "NH"],
    [6, 9, "PR"],
    [10, 27, "MA"],
    [28, 29, "RI"],
    [30, 38, "NH"],
    [39, 49, "ME"],
    [50, 59, "VT"],
    [60, 69, "CT"],
    [70, 89, "NJ"],
    [100, 102, "NY"],
    [103, 104, "NY"],
    [105, 108, "NY"],
    [109, 119, "NY"],
    [120, 129, "NY"],
    [130, 149, "NY"],
    [150, 196, "PA"],
    [197, 199, "DE"],
    [200, 205, "DC"],
    [206, 219, "MD"],
    [220, 246, "VA"],
    [247, 268, "WV"],
    [270, 289, "NC"],
    [290, 299, "SC"],
    [300, 319, "GA"],
    [320, 349, "FL"],
    [350, 369, "AL"],
    [370, 385, "TN"],
    [386, 397, "MS"],
    [398, 399, "GA"],
    [400, 427, "KY"],
    [430, 459, "OH"],
    [460, 479, "IN"],
    [480, 499, "MI"],
    [500, 528, "IA"],
    [530, 549, "WI"],
    [550, 567, "MN"],
    [570, 577, "SD"],
    [580, 588, "ND"],
    [590, 599, "MT"],
    [600, 629, "IL"],
    [630, 658, "MO"],
    [660, 679, "KS"],
    [680, 693, "NE"],
    [700, 714, "LA"],
    [716, 729, "AR"],
    [730, 749, "OK"],
    [750, 799, "TX"],
    [800, 816, "CO"],
    [820, 831, "WY"],
    [832, 838, "ID"],
    [840, 847, "UT"],
    [850, 865, "AZ"],
    [870, 884, "NM"],
    [889, 898, "NV"],
    [900, 961, "CA"],
    [967, 968, "HI"],
    [970, 979, "OR"],
    [980, 994, "WA"],
    [995, 999, "AK"],
  ];
  for (const [lo, hi, code] of ranges) {
    if (prefix >= lo && prefix <= hi) return code;
  }
  return "";
}

export interface ZipLookupResult {
  state: string;
  cities: string[];
}

// In-memory cache so we don't refetch the same ZIP repeatedly while the
// customer toggles between fields. Module-scope is intentional — survives
// component remounts inside the booking funnel without leaking across tabs.
const ZIP_CACHE = new Map<string, ZipLookupResult>();

/**
 * Hit Zippopotam.us for the canonical city list + state code for a ZIP.
 * Silently returns whatever we can compute locally (offline state code,
 * empty cities) if the network call fails.
 */
export async function lookupZip(zip: string): Promise<ZipLookupResult> {
  const digits = (zip || "").replace(/\D/g, "");
  if (digits.length !== 5) {
    return { state: stateFromZip(digits), cities: [] };
  }

  const cached = ZIP_CACHE.get(digits);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${digits}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const fallback = { state: stateFromZip(digits), cities: [] };
      ZIP_CACHE.set(digits, fallback);
      return fallback;
    }
    const json = await res.json();
    type Place = { "place name"?: string; "state abbreviation"?: string };
    const places: Place[] = Array.isArray(json?.places) ? json.places : [];
    const state = places[0]?.["state abbreviation"] || stateFromZip(digits);
    const cities = Array.from(new Set(
      places.map((p) => p["place name"] || "").filter((s): s is string => Boolean(s)),
    ));
    const out: ZipLookupResult = { state, cities };
    ZIP_CACHE.set(digits, out);
    return out;
  } catch (_err) {
    const fallback = { state: stateFromZip(digits), cities: [] };
    ZIP_CACHE.set(digits, fallback);
    return fallback;
  }
}
