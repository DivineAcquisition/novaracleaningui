// Dial Facebook Lead Ads and LSA leads with the outbound booking assistant.
// One attempt per lead. Calls only from 8:00 AM to 8:00 PM Eastern.
// A lead marked do_not_call is never dialed.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

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
  return "";
}

function isAdLead(source: string | null | undefined): boolean {
  const s = String(source || "").toLowerCase();
  return s.includes("fb") || s.includes("facebook") || s.includes("meta") || s.includes("instagram")
    || s.includes("lsa") || s.includes("local_service") || s.includes("google_lsa");
}

function easternHour(now = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

function callingWindowOpen(now = new Date()): boolean {
  const hour = easternHour(now);
  return hour >= 8 && hour < 20;
}

async function secret(supabase: any, key: string): Promise<string> {
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return String(data?.value || Deno.env.get(key) || "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const cronSecret = await secret(supabase, "CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* sweep */ }
  const dryRun = body.dryRun === true;
  const onlyLeadId = body.leadId ? String(body.leadId) : "";

  const assistantId = await secret(supabase, "OUTBOUND_AI_ASSISTANT_ID");
  const fromNumber = await secret(supabase, "OUTBOUND_AI_FROM_NUMBER");
  const connectionId = await secret(supabase, "OUTBOUND_AI_CONNECTION_ID");
  const apiKey = Deno.env.get("TELNYX_API_KEY") || "";
  if (!assistantId || !fromNumber || !connectionId || !apiKey) {
    return json({ ok: false, reason: "outbound_agent_not_configured" }, 500);
  }

  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("leads")
    .select("id, first_name, last_name, phone, source, zip_code, service_type, bedrooms, do_not_call, last_call_at, created_at")
    .is("last_call_at", null)
    .not("phone", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(25);
  if (onlyLeadId) query = query.eq("id", onlyLeadId);
  const { data: rows, error } = await query;
  if (error) return json({ ok: false, reason: error.message }, 500);

  const eligible = (rows || []).filter((row: any) => row.do_not_call !== true && isAdLead(row.source) && toE164(row.phone));
  const batch = eligible.slice(0, onlyLeadId ? 1 : 3);
  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      calling_window_open: callingWindowOpen(),
      count: batch.length,
      leads: batch.map((row: any) => ({ id: row.id, source: row.source, first_name: row.first_name })),
    });
  }

  if (!callingWindowOpen()) {
    return json({ ok: true, deferred: true, reason: "outside_eastern_calling_hours", waiting: batch.length });
  }

  const results: any[] = [];
  for (const lead of batch) {
    const claimed = await supabase
      .from("leads")
      .update({
        call_attempts: 1,
        last_call_at: new Date().toISOString(),
        last_call_outcome: "ai_dialing",
      })
      .eq("id", lead.id)
      .is("last_call_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed.data?.id) {
      results.push({ id: lead.id, skipped: "already_claimed" });
      continue;
    }
    const to = toE164(lead.phone);
    const firstName = String(lead.first_name || "").trim();
    const dial = await fetch(`https://api.telnyx.com/v2/texml/ai_calls/${connectionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: fromNumber,
        To: to,
        AIAssistantId: assistantId,
        CallerId: "Novara Cleaning",
        MachineDetection: "Enable",
        AsyncAmd: true,
        DetectionMode: "Premium",
        AIAssistantDynamicVariables: {
          first_name: firstName && firstName.toLowerCase() !== "lead" ? firstName : "there",
          zip_code: String(lead.zip_code || ""),
          lead_source: String(lead.source || ""),
          service_type: String(lead.service_type || ""),
          bedrooms: lead.bedrooms == null ? "" : String(lead.bedrooms),
        },
      }),
    });
    const dialText = await dial.text();
    let dialJson: any = {};
    try { dialJson = JSON.parse(dialText); } catch { dialJson = { raw: dialText.slice(0, 300) }; }
    await supabase.from("leads").update({
      last_call_outcome: dial.ok ? "ai_dial_queued" : "ai_dial_failed",
    }).eq("id", lead.id);
    results.push({
      id: lead.id,
      ok: dial.ok,
      status: dial.status,
      call_sid: dialJson.call_sid || dialJson.data?.call_sid || null,
    });
  }

  return json({ ok: true, dialed: results.filter((row) => row.ok).length, results });
});
