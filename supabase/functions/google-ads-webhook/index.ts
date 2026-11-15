// ─── google-ads-webhook ──────────────────────────────────────────────────
//
// Google Ads lead form extension webhook.
// Paste into Google Ads → Lead form → Webhook integration:
//
//   Webhook URL  https://api.novaracleaning.com/functions/v1/google-ads-webhook
//   Key          app_secrets.GOOGLE_ADS_WEBHOOK_KEY
//
// Google POSTs the form as JSON and sends that key back as google_key.
// A matching key is stored, then handed to lead-intake so the lead gets the
// same VA assignment, GHL contact, and speed-to-lead path as other ad leads.
// "Send test data" (is_test) is accepted and not stored.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  googleAdsKeyMatches,
  isGoogleAdsLeadPayload,
  mapGoogleAdsLead,
} from "./google-ads-lead.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!isGoogleAdsLeadPayload(body)) {
    return json({ error: "Not a Google Ads lead form payload." }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: secret } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "GOOGLE_ADS_WEBHOOK_KEY")
    .maybeSingle();
  const expected = String(secret?.value || "").trim();
  if (!expected) return json({ error: "Google Ads webhook key is not configured." }, 500);
  if (!googleAdsKeyMatches(String(body.google_key || ""), expected)) {
    return json({ error: "invalid google key" }, 401);
  }

  const lead = mapGoogleAdsLead(body);
  if (lead.isTest) return json({ success: true, test: true });
  if (!lead.phone && !lead.email) {
    return json({ success: true, skipped: "phone or email missing" });
  }

  if (lead.googleLeadId) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .ilike("notes", `%google_lead_id: ${lead.googleLeadId}%`)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return json({ success: true, duplicate: true, leadId: existing.id });
  }

  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const res = await fetch(`${base}/functions/v1/lead-intake`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
    body: JSON.stringify({
      source: lead.source,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      zipCode: lead.zipCode,
      city: lead.city,
      state: lead.state,
      address: lead.address,
      notes: lead.notes,
      leadScore: lead.leadScore,
      gclid: lead.gclid,
      utmSource: lead.utmSource,
      utmMedium: lead.utmMedium,
      utmCampaign: lead.utmCampaign,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("[google-ads-webhook] lead-intake failed", res.status, text.slice(0, 300));
    return json({ error: "lead intake failed" }, 502);
  }
  let saved: { leadId?: string } = {};
  try {
    saved = JSON.parse(text) as { leadId?: string };
  } catch {
    saved = {};
  }
  if (saved.leadId) {
    await supabase.from("leads").update({
      gclid: lead.gclid || null,
      utm_source: lead.utmSource,
      utm_medium: lead.utmMedium,
      utm_campaign: lead.utmCampaign || null,
    }).eq("id", saved.leadId);
  }
  return new Response(text, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
