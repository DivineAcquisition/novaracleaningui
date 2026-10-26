// Waitlist guard for the Telnyx booking tools.
// A served ZIP is not a waitlist. Placeholder names are not a waitlist.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLACEHOLDER_NAMES = new Set(["there", "unknown", "customer", "lead", "friend", "test", "user", "caller", "guest", "na", "n/a", "none"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toE164(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const zip = String(body.zip_code || body.zip || "").replace(/\D/g, "").slice(0, 5);
  if (!zip) return json({ ok: false, reason: "zip_required", say: "Ask for a 5-digit ZIP before the waitlist." });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: coverage, error } = await supabase
    .from("service_coverage_zones")
    .select("city, state, is_active")
    .eq("zip_code", zip)
    .maybeSingle();
  if (error) {
    return json({ ok: false, reason: "coverage_lookup_failed", say: "Coverage did not load. Do not add a waitlist and do not say the ZIP is outside the area." });
  }
  let closed = false;
  const { data: zoneZip } = await supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle();
  if (zoneZip?.zone_id) {
    const { data: zone } = await supabase.from("pricing_zones").select("status").eq("id", zoneZip.zone_id).maybeSingle();
    closed = zone?.status === "not_served";
  }
  if (coverage?.is_active === true && !closed) {
    const city = coverage.city ? ` in ${coverage.city}` : "";
    return json({ ok: false, reason: "zip_is_served", say: `This ZIP is served${city}. Continue the booking. Do not add a waitlist.` });
  }
  const first = String(body.first_name || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const phoneOk = toE164(body.phone).replace(/\D/g, "").length >= 10;
  const emailOk = email.includes("@") && email.includes(".") && !email.startsWith("unknown@") && email !== "unknown";
  if (!first || first.length < 2 || PLACEHOLDER_NAMES.has(first) || !emailOk || !phoneOk) {
    return json({
      ok: false,
      reason: "real_contact_required",
      say: "Ask for a real first name, a real email, and the mobile they are calling from before adding the waitlist.",
    });
  }
  const { data, error: insertError } = await supabase.functions.invoke("add-to-waitlist", {
    body: {
      email: body.email,
      firstName: body.first_name,
      lastName: body.last_name,
      phone: toE164(body.phone),
      zipCode: zip,
      source: "AI Assistant",
    },
  });
  if (insertError) return json({ ok: false, reason: "waitlist_failed", say: "The waitlist did not save. Offer a person instead of pretending it did." });
  return json({
    ok: true,
    waitlist_id: (data as { id?: string } | null)?.id || null,
    say: "You're on the waitlist. We'll reach out when we start cleaning that ZIP.",
  });
});
