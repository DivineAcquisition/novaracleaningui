// Street lookup for the voice agents.
// The caller gives a street after the ZIP. Google, then OpenStreetMap,
// fills in the city and state.

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
  const { data: secret } = await supabase.from("app_secrets").select("value").eq("key", "GOOGLE_GEOCODING_API_KEY").maybeSingle();
  const googleKey = String(secret?.value || "").trim();
  let foundStreet = street;
  let city = "";
  let state = "";
  let foundZip = zip;
  let provider = "";
  let googleStatus = googleKey ? "" : "missing_key";

  if (googleKey) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${street}, ${zip}`)}&components=${encodeURIComponent(`postal_code:${zip}|country:US`)}&key=${googleKey}`;
    const response = await fetch(url);
    const payload = await response.json();
    googleStatus = String(payload?.status || response.status);
    const top = payload?.results?.[0];
    if (payload?.status === "OK" && top) {
      const parts = top.address_components || [];
      const number = component(parts, "street_number");
      const road = component(parts, "route");
      foundStreet = [number, road].filter(Boolean).join(" ") || street;
      city = component(parts, "locality") || component(parts, "sublocality") || component(parts, "neighborhood");
      state = component(parts, "administrative_area_level_1");
      foundZip = component(parts, "postal_code").replace(/\D/g, "").slice(0, 5) || zip;
      provider = "google";
    }
  }

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
