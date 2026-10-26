// Street lookup for the voice agents.
// The caller gives a street after the ZIP. Google geocoding, then a Google
// Places text search, then the US address file, fills in the city and state.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function component(parts: any[], type: string): string {
  const row = (parts || []).find((part) => Array.isArray(part.types) && part.types.includes(type));
  return String(row?.short_name || row?.long_name || "").trim();
}

function fromParts(parts: any[], fallbackStreet: string, fallbackZip: string) {
  const number = component(parts, "street_number");
  const road = component(parts, "route");
  return {
    street: [number, road].filter(Boolean).join(" ") || fallbackStreet,
    city: component(parts, "locality") || component(parts, "sublocality") || component(parts, "neighborhood"),
    state: component(parts, "administrative_area_level_1"),
    zip: component(parts, "postal_code").replace(/\D/g, "").slice(0, 5) || fallbackZip,
  };
}

async function placesSearch(key: string, query: string): Promise<{ status: string; parts: any[] }> {
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": key,
    "X-Goog-FieldMask": "places.addressComponents,places.formattedAddress",
  };
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers,
    body: JSON.stringify({ textQuery: query, regionCode: "US", pageSize: 1 }),
  });
  const payload = await response.json().catch(() => ({}));
  const place = payload?.places?.[0];
  if (Array.isArray(place?.addressComponents) && place.addressComponents.length) {
    const parts = place.addressComponents.map((part: any) => ({
      short_name: part.shortText,
      long_name: part.longText,
      types: part.types,
    }));
    return { status: "OK", parts };
  }
  const status = String(payload?.error?.status || (response.ok ? "EMPTY" : response.status));
  if (status === "PERMISSION_DENIED" || status === "REQUEST_DENIED") return { status, parts: [] };
  const legacy = await fetch(
    `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${key}`,
  );
  const found = await legacy.json().catch(() => ({}));
  const placeId = found?.candidates?.[0]?.place_id;
  if (found?.status === "OK" && placeId) {
    const details = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=address_component&key=${key}`,
    );
    const detail = await details.json().catch(() => ({}));
    if (detail?.status === "OK" && Array.isArray(detail?.result?.address_components)) {
      return { status: "OK", parts: detail.result.address_components };
    }
    return { status: `findplace:${found.status}|details:${detail?.status || details.status}`, parts: [] };
  }
  return { status: `search:${status}|findplace:${found?.status || legacy.status}`, parts: [] };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const street = String(body.street || body.address || "").trim();
  const zip = String(body.zip_code || body.zip || "").replace(/\D/g, "").slice(0, 5);
  if (street.length < 4) return json({ ok: false, reason: "street_required", say: "Ask for the street address. Do not ask for the city." });
  if (!/^\d{5}$/.test(zip)) return json({ ok: false, reason: "zip_required", say: "Ask for the ZIP before looking up the street." });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: secrets } = await supabase.from("app_secrets").select("key, value").in("key", [
    "GOOGLE_GEOCODING_API_KEY",
    "GOOGLE_PLACES_API_KEY",
    "GOOGLE_PLACES_REST_API_KEY",
  ]);
  const secretValue = (key: string) => String((secrets || []).find((row: { key: string; value: string }) => row.key === key)?.value || "").trim();
  const googleKey = secretValue("GOOGLE_GEOCODING_API_KEY");
  const placesKey = secretValue("GOOGLE_PLACES_API_KEY") || secretValue("GOOGLE_PLACES_REST_API_KEY");
  let foundStreet = street;
  let city = "";
  let state = "";
  let foundZip = zip;
  let provider = "";
  const googleNotes: string[] = [];

  if (googleKey) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${street}, ${zip}`)}&components=${encodeURIComponent(`postal_code:${zip}|country:US`)}&key=${googleKey}`;
    const response = await fetch(url);
    const payload = await response.json();
    googleNotes.push(`geocode:${payload?.status || response.status}`);
    const top = payload?.results?.[0];
    if (payload?.status === "OK" && top) {
      const parsed = fromParts(top.address_components || [], street, zip);
      if (parsed.city && parsed.state) {
        foundStreet = parsed.street;
        city = parsed.city;
        state = parsed.state;
        foundZip = parsed.zip;
        provider = "google";
      }
    }
  } else {
    googleNotes.push("geocode:missing_key");
  }

  if (!provider && placesKey) {
    const found = await placesSearch(placesKey, `${street}, ${zip}, USA`);
    googleNotes.push(found.status);
    if (found.status === "OK" && found.parts.length) {
      const parsed = fromParts(found.parts, street, zip);
      if (parsed.city && parsed.state) {
        foundStreet = parsed.street;
        city = parsed.city;
        state = parsed.state;
        foundZip = parsed.zip;
        provider = "google_places";
      }
    }
  } else if (!provider) {
    googleNotes.push("places:missing_key");
  }
  const googleStatus = googleNotes.join(" ");

  if (!provider) {
    const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(`${street}, ${zip}`)}&benchmark=Public_AR_Current&format=json`;
    const censusResponse = await fetch(censusUrl);
    if (censusResponse.ok) {
      const census = await censusResponse.json();
      const match = census?.result?.addressMatches?.[0];
      const parts = match?.addressComponents;
      if (parts?.city && parts?.state) {
        const matched = String(match.matchedAddress || "");
        foundStreet = matched.split(",")[0]?.trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) || street;
        city = String(parts.city).toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
        state = String(parts.state).trim();
        foundZip = String(parts.zip || zip).replace(/\D/g, "").slice(0, 5);
        provider = "census";
      }
    }
  }

  if (!provider) {
    const query = encodeURIComponent(`${street}, ${zip}, USA`);
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=us&q=${query}`, {
      headers: { "User-Agent": "NovaraCleaning/1.0 (voice address lookup)" },
    });
    if (response.ok) {
      const rows = await response.json();
      const top = Array.isArray(rows) ? rows[0] : null;
      if (top?.address) {
        const number = String(top.address.house_number || "").trim();
        const road = String(top.address.road || "").trim();
        foundStreet = [number, road].filter(Boolean).join(" ") || street;
        city = String(top.address.city || top.address.town || top.address.village || "").trim();
        state = String(top.address.state || "").trim();
        if (state.toLowerCase() === "maryland") state = "MD";
        if (state.toLowerCase() === "virginia") state = "VA";
        if (state.toLowerCase() === "district of columbia") state = "DC";
        foundZip = String(top.address.postcode || zip).replace(/\D/g, "").slice(0, 5);
        provider = "nominatim";
      }
    }
  }

  if (!provider || !city) {
    return json({
      ok: false,
      reason: "address_not_found",
      lookup_status: googleStatus,
      say: "I could not match that street in this ZIP. Ask them to say the street number and name once more. Do not guess the city.",
    });
  }
  if (foundZip && foundZip !== zip) {
    return json({
      ok: false,
      reason: "zip_mismatch",
      street: foundStreet,
      city,
      state,
      zip_code: foundZip,
      provider,
      say: `That street came back in ${foundZip}, not ${zip}. Ask them to confirm the street number.`,
    });
  }
  const line = [foundStreet, city, state, zip].filter(Boolean).join(", ");
  return json({
    ok: true,
    street: foundStreet,
    city,
    state,
    zip_code: zip,
    provider,
    say: `I have ${line}. Ask them to confirm that is the home. Do not ask for the city again.`,
  });
});
