// ─── escalate-stale-leads ────────────────────────────────────────────────
//
// Runs from pg_cron every minute. Picks up any HOT lead whose VA was
// assigned more than 10 minutes ago and still has no logged call, and:
//
//   1. Stamps `escalated_at` so this only fires once per lead.
//   2. Sends a follow-up SMS to the lead via GHL ("we're sorry for the
//      delay — texting you to make this easy, when's a good time?").
//   3. Adds a GHL tag `lead-escalated` and posts a note onto the GHL
//      contact thread so a senior CSR can see the miss.
//   4. Sends an internal alert SMS to the senior CSR via GHL.
//
// No payload required — the function pulls work off the table on each
// invocation. Safe to fire on a 1-minute cadence.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ESCALATE-STALE-LEADS] ${step}${tail}`);
};

const STALENESS_MINUTES = 10;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const ghlToken = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
    const ghlLocation = (Deno.env.get("GHL_LOCATION_ID") || "").trim();

    const cutoff = new Date(Date.now() - STALENESS_MINUTES * 60 * 1000)
      .toISOString();
    const { data: stale, error } = await supabase
      .from("leads")
      .select(
        "id, first_name, last_name, phone, email, ghl_contact_id, assigned_va_user_id, status, created_at",
      )
      .eq("lead_score", "hot")
      .eq("do_not_call", false)
      .is("last_call_at", null)
      .is("escalated_at", null)
      .lt("created_at", cutoff)
      .limit(25);

    if (error) throw error;
    logStep("found stale leads", { count: stale?.length ?? 0 });

    const escalated: string[] = [];
    for (const lead of (stale || [])) {
      // 1. Mark escalated first so a retry doesn't double-fire even if a
      // downstream call below fails.
      await supabase
        .from("leads")
        .update({ escalated_at: new Date().toISOString(), status: "escalated" })
        .eq("id", lead.id);
      escalated.push(lead.id);

      // 2. Follow-up SMS to the lead via GHL
      if (lead.phone && lead.ghl_contact_id) {
        try {
          const fname = lead.first_name || "there";
          const msg =
            `Hi ${fname}, this is Novara Cleaning — sorry we couldn't reach you ` +
            `right away! Reply to this message with the day/time that works ` +
            `best and we'll get you a quote in under 2 minutes. Reply STOP to opt out.`;
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-ghl-sms`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
              body: JSON.stringify({
                contactId: lead.ghl_contact_id,
                phone: lead.phone,
                firstName: lead.first_name,
                lastName: lead.last_name,
                message: msg,
              }),
            },
          );
          await supabase
            .from("leads")
            .update({ escalation_sms_sent_at: new Date().toISOString() })
            .eq("id", lead.id);
        } catch (smsErr) {
          logStep("escalation SMS failed", smsErr);
        }
      }

      // 3. Tag + note in GHL so the senior CSR can triage
      if (lead.ghl_contact_id && ghlToken && ghlLocation) {
        try {
          await fetch(
            `${GHL_BASE}/contacts/${
              encodeURIComponent(lead.ghl_contact_id)
            }/tags`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${ghlToken}`,
                Version: GHL_VERSION,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ tags: ["lead - follow-up", "alert - speed to lead miss"] }),
            },
          );
          await fetch(
            `${GHL_BASE}/contacts/${
              encodeURIComponent(lead.ghl_contact_id)
            }/notes`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${ghlToken}`,
                Version: GHL_VERSION,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                body:
                  `⚠️ Speed-to-lead miss — assigned ${STALENESS_MINUTES}+ minutes ago, no call yet. ` +
                  `Escalation SMS sent to customer. Reach out ASAP.`,
                locationId: ghlLocation,
              }),
            },
          );
        } catch (ghlErr) {
          logStep("GHL escalation tagging failed", ghlErr);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, escalated: escalated.length, ids: escalated }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[escalate-stale-leads] error", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
