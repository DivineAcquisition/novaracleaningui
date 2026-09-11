// ─── Geocode request shaping ────────────────────────────────────────────────
//
// Keep this file in lock-step with supabase/functions/_shared/geocode.ts.
//
// ZIP-only lookups MUST use a postal-code API (Google `components=postal_code`,
// Nominatim `postalcode=`, or Zippopotam). Stuffing the ZIP into a freeform
// `q=` / `address=` query makes Nominatim match random US/PR street numbers
// (Dollar General in Iowa, a school in Caguas PR, …). That is what put
// 400–1,600 "miles" into job-offer and Urgent Hire SMS.

export interface GeocodeInput {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export function normalizeUSZip(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

/** True for empty, "22314", "22314-1234", or the old `"22314, ,  22314"` query. */
export function looksLikeBareZip(value: unknown): boolean {
  const t = String(value ?? "").trim();
  if (!t) return true;
  if (/^\d{5}(?:-\d{4})?$/.test(t)) return true;
  if (!/^[\d,\s-]+$/.test(t)) return false;
  const zips = t.match(/\d{5}/g) || [];
  return zips.length > 0 && zips.every((z) => z === zips[0]);
}

export function requestedZip(input: GeocodeInput): string | null {
  return (
    normalizeUSZip(input.zip) ||
    (looksLikeBareZip(input.address) ? normalizeUSZip(input.address) : null)
  );
}

export function isZipOnlyGeocodeInput(input: GeocodeInput): boolean {
  const zip = requestedZip(input);
  if (!zip) return false;
  const city = String(input.city ?? "").trim();
  const state = String(input.state ?? "").trim();
  if (city || state) return false;
  return looksLikeBareZip(input.address);
}

/** Skip empty commas so we never send `", ,  20735"` as a street address. */
export function buildGeocodeQuery(input: GeocodeInput): string {
  const zip = normalizeUSZip(input.zip);
  const address = String(input.address ?? "").trim();
  const city = String(input.city ?? "").trim();
  const state = String(input.state ?? "").trim();
  const parts: string[] = [];
  if (address && !looksLikeBareZip(address)) parts.push(address);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) {
    const blob = parts.join(" ");
    if (!blob.includes(zip)) parts.push(zip);
  } else if (address && looksLikeBareZip(address)) {
    const z = normalizeUSZip(address);
    if (z) parts.push(z);
  }
  return parts.join(", ");
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180;
}

export function zipMatchesResult(
  requested: string | null | undefined,
  resultZip: string | null | undefined,
): boolean {
  const a = normalizeUSZip(requested);
  const b = normalizeUSZip(resultZip);
  if (!a || !b) return true;
  return a === b;
}

export function geocodeCacheZipKey(zip: string): string {
  return `zip:${zip}`;
}

export function googleZipGeocodeUrl(zip: string, key: string): string {
  const components = `postal_code:${zip}|country:US`;
  return `https://maps.googleapis.com/maps/api/geocode/json?components=${encodeURIComponent(components)}&key=${encodeURIComponent(key)}`;
}

export function googleAddressGeocodeUrl(query: string, key: string): string {
  return `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:US&key=${encodeURIComponent(key)}`;
}

export function nominatimZipGeocodeUrl(zip: string): string {
  return `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&postalcode=${encodeURIComponent(zip)}&country=US&limit=1`;
}

export function nominatimAddressGeocodeUrl(query: string): string {
  return `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&q=${encodeURIComponent(query)}&limit=1`;
}

export function zippopotamUrl(zip: string): string {
  return `https://api.zippopotam.us/us/${encodeURIComponent(zip)}`;
}
