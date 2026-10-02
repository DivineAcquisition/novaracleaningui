// ─── Keyless address lookup (server side) ─────────────────────────────────────
//
// Backs /api/address/suggest and /api/address/geocode so every address field
// has a working dropdown even when Google refuses the browser key. On
// 2026-10-02 every stored Google key returned PERMISSION_DENIED for Places API
// (New), and the server geocoding key is referrer-restricted, so Google cannot
// be the only source.
//
//   Exact:  US Census Bureau geocoder (one-line address). Once a house number
//           and a full street name are typed it returns the real address,
//           ZIP and point. Tried with MD, DC and VA appended, since it needs a
//           state and nobody types one.
//   Fuzzy:  Photon (photon.komoot.io), an OSM search built for
//           search-as-you-type. Completes partial street names; the typed
//           house number is carried onto street hits, the way Google does.
//           Limited to the MD / DC / Northern VA service area, then the US.
//
// Neither needs a key. Parsing is kept in pure functions so the offline verify
// script can lock it down without the network.

import { postalStateCode } from "@/lib/us-states";

export interface AddressMatch {
  id: string;
  /** "8201 Georgia Avenue" — what goes in the street field. */
  street: string;
  city: string;
  state: string;
  zipCode: string;
  lat?: number;
  lng?: number;
  /** "Silver Spring, MD 20910" — the muted second line in the dropdown. */
  secondary: string;
  /** Full one-line address. */
  label: string;
  source: "photon" | "census";
}

// MD, DC and Northern Virginia, with margin. Photon bbox order: minLon,minLat,maxLon,maxLat.
export const SERVICE_AREA_BBOX = "-79.6,37.8,-74.9,39.8";

const PHOTON_URL = "https://photon.komoot.io/api/";
const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const TIMEOUT_MS = 4500;
const USER_AGENT = "NovaraCleaning/1.0 (address lookup; contact@novaracleaning.com)";

export function photonSuggestUrl(
  query: string,
  opts: { bbox?: string; limit?: number; layers?: Array<"house" | "street"> } = {},
): string {
  const params = new URLSearchParams({ q: query, lang: "en", limit: String(opts.limit ?? 10) });
  if (opts.bbox) params.set("bbox", opts.bbox);
  // Lean toward the DC metro when results tie.
  params.set("lat", "38.95");
  params.set("lon", "-77.05");
  for (const layer of opts.layers ?? ["house", "street"]) params.append("layer", layer);
  return `${PHOTON_URL}?${params.toString()}`;
}

export function censusGeocodeUrl(oneLine: string): string {
  const params = new URLSearchParams({
    address: oneLine,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  return `${CENSUS_URL}?${params.toString()}`;
}

/** Leading house number the user typed ("8201", "12A", "4500-B"), if any. */
export function typedHouseNumber(query: string): string {
  const m = String(query || "").trim().match(/^(\d+[A-Za-z]?(?:-\d*[A-Za-z]?)?)\s/);
  return m ? m[1] : "";
}

/** Everything after the house number: "Georgia Ave" from "8201 Georgia Ave". */
export function streetPart(query: string): string {
  const q = String(query || "").trim();
  const n = typedHouseNumber(q);
  return n ? q.slice(n.length).trim() : q;
}

const SERVICE_STATES = ["MD", "DC", "VA"];
const NAMES_A_STATE = /(?:,|\s)(?:MD|DC|VA|Maryland|Virginia|District of Columbia|\d{5}(?:-\d{4})?)\s*$/i;

/** One-line queries to send the Census geocoder for what was typed. */
export function censusQueries(query: string): string[] {
  const q = String(query || "").trim();
  if (!typedHouseNumber(q) || streetPart(q).length < 4) return [];
  if (NAMES_A_STATE.test(q)) return [q];
  return SERVICE_STATES.map((st) => `${q}, ${st}`);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    // DC quadrants and compass suffixes stay capitalized: "Pennsylvania Ave SE".
    .replace(/\b(Nw|Ne|Sw|Se)\b/g, (d) => d.toUpperCase());
}

function secondaryLine(city: string, state: string, zip: string): string {
  const cityState = [city, state].filter(Boolean).join(", ");
  return [cityState, zip].filter(Boolean).join(" ");
}

function finite(n: unknown): number | undefined {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Turn a Photon FeatureCollection into street-address suggestions.
 *
 * - `house` features need a house number; named places without one (bus
 *   stops, shops) are dropped.
 * - `street` features carry the number the user typed, the way Google does
 *   for addresses it can interpolate. The exact point comes from the Census
 *   geocoder when the suggestion is picked.
 */
export function parsePhotonSuggestions(json: unknown, query: string): AddressMatch[] {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const typedNumber = typedHouseNumber(query);
  const out: AddressMatch[] = [];
  const seen = new Set<string>();

  for (const f of features as Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: unknown[] } }>) {
    const p = f?.properties || {};
    const country = String(p.countrycode || "").toUpperCase();
    if (country && country !== "US") continue;

    const type = String(p.type || "");
    const houseNumber = String(p.housenumber || "").trim();
    let street = "";
    if (type === "street") {
      const road = String(p.name || p.street || "").trim();
      if (!road) continue;
      street = typedNumber ? `${typedNumber} ${road}` : road;
    } else {
      const road = String(p.street || "").trim();
      if (!houseNumber || !road) continue;
      street = `${houseNumber} ${road}`;
    }

    const city = String(p.city || p.town || p.village || p.locality || p.district || p.county || "").trim();
    const state = postalStateCode(p.state);
    const zipCode = String(p.postcode || "").trim().slice(0, 5);
    const secondary = secondaryLine(city, state, zipCode);
    const label = [street, secondary].filter(Boolean).join(", ");
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const coords = Array.isArray(f?.geometry?.coordinates) ? f.geometry!.coordinates! : [];
    out.push({
      id: `photon:${String(p.osm_type || "")}${String(p.osm_id || out.length)}:${typedNumber}`,
      street,
      city,
      state,
      zipCode,
      lng: finite(coords[0]),
      lat: finite(coords[1]),
      secondary,
      label,
      source: "photon",
    });
  }
  return out;
}

/** Every Census match as an AddressMatch. */
export function parseCensusMatches(json: unknown): AddressMatch[] {
  const matches = (json as { result?: { addressMatches?: unknown[] } })?.result?.addressMatches;
  if (!Array.isArray(matches)) return [];
  const out: AddressMatch[] = [];
  for (const raw of matches) {
    const m = raw as {
      matchedAddress?: string;
      coordinates?: { x?: unknown; y?: unknown };
      addressComponents?: Record<string, string>;
    };
    const lat = finite(m.coordinates?.y);
    const lng = finite(m.coordinates?.x);
    if (lat === undefined || lng === undefined) continue;

    // matchedAddress: "8201 GEORGIA AVE, SILVER SPRING, MD, 20910"
    const parts = String(m.matchedAddress || "").split(",").map((s) => s.trim());
    const c = m.addressComponents || {};
    const street = titleCase(parts[0] || "");
    if (!street) continue;
    const city = titleCase(c.city || parts[1] || "");
    const state = postalStateCode(c.state || parts[2] || "");
    const zipCode = String(c.zip || parts[3] || "").slice(0, 5);
    const secondary = secondaryLine(city, state, zipCode);
    out.push({
      id: `census:${parts.join("|")}`,
      street,
      city,
      state,
      zipCode,
      lat,
      lng,
      secondary,
      label: [street, secondary].filter(Boolean).join(", "),
      source: "census",
    });
  }
  return out;
}

/** First Census match, or null. */
export function parseCensusMatch(json: unknown): AddressMatch | null {
  return parseCensusMatches(json)[0] ?? null;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[address-lookup] HTTP", res.status, url.split("?")[0]);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("[address-lookup] request failed", url.split("?")[0], err instanceof Error ? err.message : err);
    return null;
  }
}

/** Same house number, or the start of one while it is still being typed. */
function numberFits(typedNumber: string, m: AddressMatch): boolean {
  if (!typedNumber) return true;
  const number = m.street.split(/\s+/)[0].toLowerCase();
  return number.startsWith(typedNumber.toLowerCase());
}

/**
 * Merge candidate lists in priority order, dropping repeats. Two hits are the
 * same address when the house number, first street word, city and state agree
 * ("8201 Georgia Ave" from Census vs "8201 Georgia Avenue" from Photon, or one
 * long road Photon splits into several ZIP segments).
 */
export function mergeSuggestions(lists: AddressMatch[][], limit: number): AddressMatch[] {
  const out: AddressMatch[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const m of list) {
      const [number = "", word = ""] = m.street.toLowerCase().split(/\s+/);
      const key = `${number}|${word}|${m.city.toLowerCase()}|${m.state}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Address suggestions for a partial query. Exact Census matches first, then
 * Photon houses with the typed number, then Photon streets carrying it.
 */
export async function suggestAddresses(query: string, limit = 6): Promise<AddressMatch[]> {
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  const typedNumber = typedHouseNumber(q);
  const street = streetPart(q);

  const photon = async (text: string, layers: Array<"house" | "street">, bbox?: string) =>
    parsePhotonSuggestions(await getJson(photonSuggestUrl(text, { bbox, layers })), q).filter((m) =>
      numberFits(typedNumber, m),
    );

  const [census, houses, streets] = await Promise.all([
    Promise.all(censusQueries(q).map(async (line) => parseCensusMatches(await getJson(censusGeocodeUrl(line))))).then(
      // The geocoder fuzzes the city when the state was only appended by us
      // ("12 Main St Laur, MD" → Laura, OH). Keep the service states.
      (lists) => lists.flat().filter((m) => NAMES_A_STATE.test(q) || SERVICE_STATES.includes(m.state)),
    ),
    photon(q, ["house"], SERVICE_AREA_BBOX),
    street.length >= 3 ? photon(street, ["street"], SERVICE_AREA_BBOX) : Promise.resolve([]),
  ]);

  const local = mergeSuggestions([census, houses, streets], limit);
  if (local.length > 0) return local;
  // Nothing in the service area — try the rest of the US.
  return mergeSuggestions([await photon(q, ["house", "street"])], limit);
}

/**
 * True when `match` is plausibly the street that was typed: same house number
 * and the first word of its street name appears in the text. Keeps a fuzzy
 * search hit from silently replacing what someone typed.
 */
export function matchesTypedStreet(query: string, match: AddressMatch): boolean {
  const typedNumber = typedHouseNumber(query).toLowerCase();
  const [number, firstWord] = match.street.toLowerCase().split(/\s+/);
  if (!typedNumber || number !== typedNumber || !firstWord) return false;
  return query.toLowerCase().includes(firstWord);
}

/** Geocode a full one-line address: Census first (exact), then a Photon hit on the same street. */
export async function geocodeAddressLine(line: string): Promise<AddressMatch | null> {
  const q = String(line || "").trim();
  if (q.length < 3) return null;
  const lines = censusQueries(q);
  const census = await Promise.all(
    (lines.length > 0 ? lines : [q]).map(async (l) => parseCensusMatch(await getJson(censusGeocodeUrl(l)))),
  );
  const exact = census.find((m) => m !== null && (lines.length <= 1 || SERVICE_STATES.includes(m.state)));
  if (exact) return exact;
  const [top] = await suggestAddresses(q, 1);
  return top && matchesTypedStreet(q, top) ? top : null;
}
