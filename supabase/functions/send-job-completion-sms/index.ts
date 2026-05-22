// send-job-completion-sms
//
// Cron-triggered (every 15 min via pg_cron). Finds Confirmed / Accepted /
// In Progress job_assignments whose job's end_time (start_datetime +
// duration) is inside the window [now - 30min, now + 15min] AND that
// haven't yet received the completion SMS. For each:
//   1. Generate a 32-char hex completion_token (skip if one already exists)
//   2. Atomically stamp completion_sms_sent_at + completion_token (so two
//      concurrent crons can't double-send)
//   3. Send SMS via send-ghl-sms with link to
//      https://contractor.novaracleaning.com/cleaner/job/<token>/complete

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CONTRACTOR_BASE = "https://contractor.novaracleaning.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = new Date();
    const windowStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const windowEnd = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    const { data: candidates, error } = await supabase
      .from("job_assignments")
      .select(
        "id, job_id, cleaner_id, status, completion_sms_sent_at, completion_token, jobs!inner(id, start_datetime, duration_est_hours, address, city, zip), cleaners!inner(first_name, last_name, phone, sms_notifications_enabled)",
      )
      .or("status.ilike.confirmed,status.ilike.accepted,status.ilike.in progress,status.ilike.in_progress")
      .is("completion_sms_sent_at", null)
      .limit(200);
    if (error) throw error;

    const targets: any[] = [];
    for (const c of candidates || []) {
      const job = (c as any).jobs;
      if (!job?.start_datetime) continue;
      const startMs = new Date(job.start_datetime).getTime();
      const endIso = new Date(
        startMs + (Number(job.duration_est_hours) || 3) * 60 * 60 * 1000,
      ).toISOString();
      if (endIso >= windowStart && endIso <= windowEnd) targets.push({ ...(c as any), end_iso: endIso });
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, processed: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const sentIds: string[] = [];
    for (const t of targets) {
      let token: string = t.completion_token;
      if (!token) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      }

      const { data: claimed, error: claimErr } = await supabase
        .from("job_assignments")
        .update({
          completion_token: token,
          completion_sms_sent_at: new Date().toISOString(),
        })
        .eq("id", t.id)
        .is("completion_sms_sent_at", null)
        .select("id")
        .maybeSingle();
      if (claimErr || !claimed) continue;

      const cleaner = t.cleaners;
      if (!cleaner?.phone || cleaner.sms_notifications_enabled === false) {
        sentIds.push(t.id);
        continue;
      }
      const job = t.jobs;
      const url = `${CONTRACTOR_BASE}/cleaner/job/${token}/complete`;
      const where = `${job?.city || ""}${job?.zip ? " " + job.zip : ""}`.trim();
      const message =
        `✅ Job wrap-up time!${where ? `\n${where}` : ""}\n` +
        `Tap to mark complete, flag an issue, or escalate:\n${url}`;

      try {
        await supabase.functions.invoke("send-ghl-sms", {
          body: {
            phone: cleaner.phone,
            firstName: cleaner.first_name,
            lastName: cleaner.last_name,
            message,
            type: "SMS",
          },
        });
      } catch (err) {
        console.warn("[completion-sms] GHL SMS failed", err instanceof Error ? err.message : String(err));
      }
      try {
        await supabase.from("sms_logs").insert({
          to_phone: cleaner.phone,
          type: "job_completion",
          message,
          status: "sent",
          cleaner_id: t.cleaner_id,
          job_assignment_id: t.id,
        });
      } catch { /* non-blocking */ }
      sentIds.push(t.id);
    }

    return new Response(JSON.stringify({ ok: true, sent: sentIds.length, processed: sentIds }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-job-completion-sms] error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
