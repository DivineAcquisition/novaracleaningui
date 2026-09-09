// ─── Server-side geocoding ────────────────────────────────────────────
//
// Resolves a freeform address (or a bare zip code) to a lat/lng plus a
// parsed { street, city, state, zipCode } bag the client can drop into
// individual form fields.
//
// ZIP-only requests never go through freeform `q=` / `address=` search.
// That path treats "20735" as a street number and has returned Puerto Rico,
// Iowa, Indiana, Texas, … which then showed up as 400–1,600 miles in SMS.
//
// Provider precedence:
//   ZIP-only: Google postal_code components → Nominatim postalcode= → Zippopotam
//   Street:   Google Geocoding API → Nominatim freeform
//
// We always return the SAME shape regardless of provider:
//   { lat, lng, display_name, parsed: { street, city, state, zipCode } }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import {
  buildGeocodeQuery,
  geocodeCacheZipKey,
  googleAddressGeocodeUrl,
  googleZipGeocodeUrl,
  isValidLatLng,
  isZipOnlyGeocodeInput,
  looksLikeBareZip,
  nominatimAddressGeocodeUrl,
  nominatimZipGeocodeUrl,
  requestedZip,
  zipMatchesResult,
  zippopotamUrl,
  type GeocodeInput,
} from "../_shared/geocode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOMINATIM_HEADERS = { "User-Agent": "CleaningDispatchSystem/1.0" };

const log = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[GEOCODE] ${step}${tail}`);
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC",
  "florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL",
  "indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA",
  "maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI",
  "minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT",
  "nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ",
  "new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND",
  "ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA",
  "rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN",
  "texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA",
  "west virginia":"WV","wisconsin":"WI","wyoming":"WY",
};

interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

interface GeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
  parsed: ParsedAddress;
  provider: string;
}

function pickNominatimParts(addr: any): ParsedAddress {
  if (!addr || typeof addr !== "object") {
    return { street: "", city: "", state: "", zipCode: "" };
  }
  const houseNumber = (addr.house_number || "").toString().trim();
  const road = (addr.road || addr.pedestrian || addr.footway || addr.path || "").toString().trim();
  const street = [houseNumber, road].filter(Boolean).join(" ").trim();
  const city = (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.suburb ||
    addr.municipality ||
    addr.county ||
    ""
  ).toString().trim();
  let state = (addr.state_code || "").toString().trim().toUpperCase();
  if (!state && addr.state) {
    const norm = String(addr.state).toLowerCase().trim();
    state = STATE_NAME_TO_CODE[norm] || String(addr.state).slice(0, 2).toUpperCase();
  }
  const zipCode = (addr.postcode || "").toString().trim().slice(0, 5);
  return { street, city, state, zipCode };
}

function pickGoogleParts(components: any[]): ParsedAddress {
  if (!Array.isArray(components)) {
    return { street: "", city: "", state: "", zipCode: "" };
  }
  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";
  let zipCode = "";
  for (const c of components) {
    const types: string[] = c.types || [];
    if (types.includes("street_number")) streetNumber = c.short_name || c.long_name || "";
    if (types.includes("route")) route = c.long_name || c.short_name || "";
    if (types.includes("locality") || types.includes("postal_town") || types.includes("sublocality")) {
      if (!city) city = c.long_name || c.short_name || "";
    }
    if (!city && (types.includes("administrative_area_level_3") || types.includes("administrative_area_level_2"))) {
      city = c.long_name || c.short_name || "";
    }
    if (types.includes("administrative_area_level_1")) state = c.short_name || c.long_name || "";
    if (types.includes("postal_code")) zipCode = (c.short_name || c.long_name || "").slice(0, 5);
  }
  return { street: `${streetNumber} ${route}`.trim(), city, state, zipCode };
}

function asResult(
  lat: unknown,
  lng: unknown,
  display_name: string,
  parsed: ParsedAddress,
  provider: string,
): GeocodeResult | null {
  if (!isValidLatLng(lat, lng)) return null;
  return { lat: Number(lat), lng: Number(lng), display_name, parsed, provider };
}

async function geocodeViaGoogleUrl(url: string): Promise<{
  lat: number; lng: number; display_name: string; parsed: ParsedAddress;
} | null> {
  const r = await fetch(url);
  if (!r.ok) {
    log("Google geocode HTTP error", { status: r.status });
    return null;
  }
  const j = await r.json();
  if (j.status !== "OK" || !Array.isArray(j.results) || j.results.length === 0) {
    log("Google geocode non-OK", { status: j.status, error: j.error_message });
    return null;
  }
  const top = j.results[0];
  const loc = top.geometry?.location;
  if (!isValidLatLng(loc?.lat, loc?.lng)) return null;
  return {
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    display_name: top.formatted_address || "",
    parsed: pickGoogleParts(top.address_components),
  };
}

async function geocodeZipViaNominatim(zip: string): Promise<GeocodeResult | null> {
  const r = await fetch(nominatimZipGeocodeUrl(zip), { headers: NOMINATIM_HEADERS });
  if (!r.ok) return null;
  const data = await r.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  const parsed = pickNominatimParts(top.address);
  if (!parsed.zipCode) parsed.zipCode = zip;
  const result = asResult(parseFloat(top.lat), parseFloat(top.lon), top.display_name || zip, parsed, "nominatim-zip");
  if (result && !zipMatchesResult(zip, result.parsed.zipCode)) return null;
  return result;
}

async function geocodeZipViaZippopotam(zip: string): Promise<GeocodeResult | null> {
  const r = await fetch(zippopotamUrl(zip), { headers: { "Accept": "application/json" } });
  if (!r.ok) return null;
  const j = await r.json();
  const place = Array.isArray(j?.places) ? j.places[0] : null;
  if (!place) return null;
  const parsed: ParsedAddress = {
    street: "",
    city: String(place["place name"] || "").trim(),
    state: String(place["state abbreviation"] || place.state || "").trim(),
    zipCode: zip,
  };
  return asResult(
    parseFloat(place.latitude),
    parseFloat(place.longitude),
    `${parsed.city}${parsed.state ? `, ${parsed.state}` : ""} ${zip}`.trim(),
    parsed,
    "zippopotam",
  );
}

async function geocodeZip(zip: string, googleKey: string): Promise<GeocodeResult | null> {
  if (googleKey) {
    try {
      const g = await geocodeViaGoogleUrl(googleZipGeocodeUrl(zip, googleKey));
      if (g) {
        if (!g.parsed.zipCode) g.parsed.zipCode = zip;
        if (zipMatchesResult(zip, g.parsed.zipCode) && isValidLatLng(g.lat, g.lng)) {
          return { ...g, provider: "google-zip" };
        }
      }
    } catch (err) {
      log("Google zip geocode threw", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  try {
    const n = await geocodeZipViaNominatim(zip);
    if (n) return n;
  } catch (err) {
    log("Nominatim zip geocode threw", { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    const z = await geocodeZipViaZippopotam(zip);
    if (z) return z;
  } catch (err) {
    log("Zippopotam geocode threw", { error: err instanceof Error ? err.message : String(err) });
  }
  return null;
}

async function geocodeViaNominatimAddress(query: string): Promise<GeocodeResult | null> {
  const r = await fetch(nominatimAddressGeocodeUrl(query), { headers: NOMINATIM_HEADERS });
  if (!r.ok) return null;
  const data = await r.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  return asResult(
    parseFloat(top.lat),
    parseFloat(top.lon),
    top.display_name || query,
    pickNominatimParts(top.address),
    "nominatim",
  );
}

async function geocodeStreet(
  query: string,
  googleKey: string,
): Promise<GeocodeResult | null> {
  if (googleKey) {
    try {
      const g = await geocodeViaGoogleUrl(googleAddressGeocodeUrl(query, googleKey));
      if (g && isValidLatLng(g.lat, g.lng)) {
        return { ...g, provider: "google" };
      }
      log("Google returned no result, falling back to Nominatim");
    } catch (err) {
      log("Google geocode threw, falling back to Nominatim", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return geocodeViaNominatimAddress(query);
}

async function cacheZipResult(
  supabase: ReturnType<typeof createClient>,
  zip: string,
  result: GeocodeResult,
) {
  try {
    await supabase.from("geocode_cache").upsert({
      address_key: geocodeCacheZipKey(zip),
      lat: result.lat,
      lng: result.lng,
      formatted_address: result.display_name,
      city: result.parsed.city || null,
      state: result.parsed.state || null,
      zip,
      geocoded_at: new Date().toISOString(),
    }, { onConflict: "address_key" });
  } catch (err) {
    log("geocode_cache upsert failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const input: GeocodeInput = {
      address: body?.address,
      city: body?.city,
      state: body?.state,
      zip: body?.zip,
    };
    log("Geocoding request", { city: input.city, state: input.state, zip: input.zip, zipOnly: isZipOnlyGeocodeInput(input) });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const googleKey = (await resolveSecret(supabase, "GOOGLE_GEOCODING_API_KEY")) || "";

    const zip = requestedZip(input);
    let result: GeocodeResult | null = null;

    if (isZipOnlyGeocodeInput(input) && zip) {
      result = await geocodeZip(zip, googleKey);
    } else {
      const query = buildGeocodeQuery(input);
      if (!query) {
        throw new Error("Address information required");
      }
      result = await geocodeStreet(query, googleKey);
      // Freeform search still sometimes latches onto a house number that
      // happens to equal the ZIP. Only replace with the ZIP centroid when
      // the "address" itself was zip-like — don't move a real street pin.
      if (
        zip &&
        result &&
        !zipMatchesResult(zip, result.parsed.zipCode) &&
        looksLikeBareZip(input.address)
      ) {
        log("Street result ZIP mismatch, retrying as postal code", {
          requested: zip,
          got: result.parsed.zipCode,
          provider: result.provider,
        });
        const zipResult = await geocodeZip(zip, googleKey);
        if (zipResult) result = zipResult;
      }
    }

    if (!result) {
      throw new Error("Address not found");
    }

    log("Geocoded", { lat: result.lat, lng: result.lng, provider: result.provider });
    if (zip && zipMatchesResult(zip, result.parsed.zipCode)) {
      await cacheZipResult(supabase, zip, result);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
