// Live ZIP coverage. The booking tool router used to select a zone column
// that this table does not have, so every ZIP came back as not served.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const zip = String(body.zip_code || body.zip || "").replace(/\D/g, "").slice(0, 5);
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (!zip) {
    return new Response(JSON.stringify({
      serviced: false,
      lookup_failed: false,
      zip_code: "",
      say: "Ask for a 5-digit ZIP before deciding coverage.",
    }), { headers });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: coverage, error } = await supabase
    .from("service_coverage_zones")
    .select("city, state, county, tier, tier_label, is_active")
    .eq("zip_code", zip)
    .maybeSingle();
  if (error) {
    return new Response(JSON.stringify({
      serviced: false,
      lookup_failed: true,
      zip_code: zip,
      say: "The coverage lookup failed. Do not tell the caller this ZIP is outside the service area.",
    }), { status: 200, headers });
  }
  const { data: zoneZip } = await supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle();
  let zoneName: string | null = null;
  let closed = false;
  if (zoneZip?.zone_id) {
    const { data: zone } = await supabase.from("pricing_zones").select("name, status").eq("id", zoneZip.zone_id).maybeSingle();
    zoneName = zone?.name || null;
    closed = zone?.status === "not_served";
  }
  const serviced = coverage?.is_active === true && !closed;
  return new Response(JSON.stringify({
    serviced,
    lookup_failed: false,
    zip_code: zip,
    city: coverage?.city || null,
    state: coverage?.state || null,
    county: coverage?.county || null,
    tier: coverage?.tier || null,
    tier_label: coverage?.tier_label || null,
    zone: zoneName,
    say: serviced
      ? `Yes, we clean in ${coverage?.city || "that ZIP"}, ${coverage?.state || ""}. Continue the booking. Do not add a waitlist.`
      : "That ZIP is not in the active service area. Offer the waitlist and do not quote a price.",
  }), { headers });
});
