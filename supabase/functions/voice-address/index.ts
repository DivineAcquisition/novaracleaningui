// Street lookup for the voice agents.
// The caller gives a street after the ZIP. Google fills city and state.

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
  const { data, error } = await supabase.functions.invoke("geocode-address", {
    body: { address: street, zip },
  });
  if (error || !data?.parsed) {
    return json({
      ok: false,
      reason: "address_not_found",
      say: "I could not match that street in this ZIP. Ask them to say the street number and name once more. Do not guess the city.",
    });
  }
  const parsed = data.parsed as { street?: string; city?: string; state?: string; zipCode?: string };
  const foundStreet = String(parsed.street || street).trim();
  const city = String(parsed.city || "").trim();
  const state = String(parsed.state || "").trim();
  const foundZip = String(parsed.zipCode || zip).replace(/\D/g, "").slice(0, 5);
  if (foundZip && foundZip !== zip) {
    return json({
      ok: false,
      reason: "zip_mismatch",
      street: foundStreet,
      city,
      state,
      zip_code: foundZip,
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
    display_name: data.display_name || line,
    say: `I have ${line}. Ask them to confirm that is the home. Do not ask for the city again.`,
  });
});
