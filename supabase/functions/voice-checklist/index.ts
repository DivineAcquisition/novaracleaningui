// Text the public checklist before a price is spoken.
// The caller should glance at what is included, then hear a one-sentence summary.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRIEFS: Record<string, string> = {
  standard: "A standard clean covers kitchen surfaces, bathrooms, dusting, vacuuming, and floors. The fridge and oven are extra.",
  deep: "A deep clean includes the standard clean plus inside cabinets, baseboards, interior windows, and behind furniture.",
  moveInOut: "A move-in or move-out is a full clean, and the inside of the fridge and oven are included.",
  combo: "This is a deep clean now and a standard clean after it.",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceKey(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("move")) return "moveInOut";
  if (s.includes("combo")) return "combo";
  if (s.includes("deep")) return "deep";
  return "standard";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const phone = String(body.phone || "").trim();
  const key = serviceKey(String(body.service_type || "standard"));
  const brief = BRIEFS[key];
  if (phone.replace(/\D/g, "").length < 10) {
    return json({ ok: false, reason: "phone_required", brief, say: "A mobile number is required before the checklist text can go out." });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data, error } = await supabase.functions.invoke("send-cleaning-checklist", {
    body: {
      phone,
      firstName: body.first_name || "",
      serviceType: key,
      sendEmail: false,
      sendSms: true,
    },
  });
  const viewUrl = (data as { viewUrl?: string } | null)?.viewUrl || "";
  const smsSent = Boolean((data as { smsSent?: boolean } | null)?.smsSent) && !error;
  const say = smsSent
    ? `I texted the checklist. Ask them to glance at it before you say a price. Then say: ${brief}`
    : `The checklist text did not send. Still say this before the price: ${brief}`;
  return json({
    ok: smsSent,
    sms_sent: smsSent,
    service_type: key,
    view_url: viewUrl,
    brief,
    say,
  });
});
