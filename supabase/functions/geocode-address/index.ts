// ─── Server-side geocoding ────────────────────────────────────────────
//
// Resolves a freeform address (or a bare zip code) to a lat/lng plus a
// parsed { street, city, state, zipCode } bag the client can drop into
// individual form fields.
//
// Provider precedence:
//   1. Google Geocoding API (when app_secrets.GOOGLE_GEOCODING_API_KEY
//      is set). Higher-quality data, better for complete street
//      addresses, and consistent with what Google Places returns
//      browser-side.
//   2. Nominatim (OpenStreetMap, free, no key) as fallback. Used when
//      the Google key is missing or its API call fails.
//
// We always return the SAME shape regardless of provider:
//   { lat, lng, display_name, parsed: { street, city, state, zipCode } }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

// Reduce Nominatim's `address` object to the four shapes the client
// cares about.
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

// Reduce Google's `address_components` array to the same shape.
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

// ─── Google Geocoding ──────────────────────────────────────────────
async function geocodeViaGoogle(query: string, key: string): Promise<{
  lat: number; lng: number; display_name: string; parsed: ParsedAddress;
} | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:US&key=${encodeURIComponent(key)}`;
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
  if (!loc?.lat || !loc?.lng) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    display_name: top.formatted_address || query,
    parsed: pickGoogleParts(top.address_components),
  };
}

// ─── Nominatim fallback ────────────────────────────────────────────
async function geocodeViaNominatim(args: {
  query: string;
  zip?: string;
}): Promise<{
  lat: number; lng: number; display_name: string; parsed: ParsedAddress;
} | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&q=${encodeURIComponent(args.query)}&limit=1`;
  const r = await fetch(url, { headers: { "User-Agent": "CleaningDispatchSystem/1.0" } });
  if (!r.ok) return null;
  const data = await r.json();
  if (Array.isArray(data) && data.length > 0) {
    const top = data[0];
    return {
      lat: parseFloat(top.lat),
      lng: parseFloat(top.lon),
      display_name: top.display_name,
      parsed: pickNominatimParts(top.address),
    };
  }
  // Zip-only fallback: OSM is sometimes too strict on freeform queries.
  if (args.zip) {
    const zr = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&postalcode=${args.zip}&country=US&limit=1`,
      { headers: { "User-Agent": "CleaningDispatchSystem/1.0" } },
    );
    if (zr.ok) {
      const zd = await zr.json();
      if (Array.isArray(zd) && zd.length > 0) {
        const top = zd[0];
        return {
          lat: parseFloat(top.lat),
          lng: parseFloat(top.lon),
          display_name: top.display_name,
          parsed: pickNominatimParts(top.address),
        };
      }
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { address, city, state, zip } = await req.json();
    log("Geocoding request", { city, state, zip });

    const query = `${address || ""}, ${city || ""}, ${state || ""} ${zip || ""}`.trim();
    if (!query || query === ",") {
      throw new Error("Address information required");
    }

    // Provider 1: Google Geocoding API. We pull the key from the
    // app_secrets table so it can be rotated without a redeploy.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const googleKey = await resolveSecret(supabase, "GOOGLE_GEOCODING_API_KEY");

    if (googleKey) {
      try {
        const result = await geocodeViaGoogle(query, googleKey);
        if (result) {
          log("Geocoded via Google", { lat: result.lat, lng: result.lng });
          return new Response(JSON.stringify({ ...result, provider: "google" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
        log("Google returned no result, falling back to Nominatim");
      } catch (err) {
        log("Google geocode threw, falling back to Nominatim", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      log("GOOGLE_GEOCODING_API_KEY not configured, using Nominatim");
    }

    // Provider 2: Nominatim
    const result = await geocodeViaNominatim({ query, zip });
    if (result) {
      log("Geocoded via Nominatim", { lat: result.lat, lng: result.lng });
      return new Response(JSON.stringify({ ...result, provider: "nominatim" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    throw new Error("Address not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
