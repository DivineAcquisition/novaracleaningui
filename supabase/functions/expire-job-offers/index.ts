// expire-job-offers
//
// Cron / manual: mark Offered assignments past expires_at as Expired.
// When a job no longer has enough Confirmed cleaners, set job back to
// Dispatching and optionally re-invoke dispatch-job for backfill.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: unknown) =>
  console.log(`[EXPIRE-OFFERS] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = req.headers.get("Authorization") || "";
    if (serviceKey && auth !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const nowIso = new Date().toISOString();

    const { data: stale, error: fetchErr } = await supabase
      .from("job_assignments")
      .select("id, job_id, cleaner_id, status, expires_at")
      .ilike("status", "offered")
      .not("expires_at", "is", null)
      .lt("expires_at", nowIso)
      .limit(200);

    if (fetchErr) throw fetchErr;

    const expiredIds = (stale || []).map((r: { id: string }) => r.id);
    if (expiredIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, expired: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("job_assignments")
      .update({ status: "Expired", responded_at: nowIso })
      .in("id", expiredIds);

    log("expired assignments", { count: expiredIds.length });

    const jobIds = [...new Set((stale || []).map((r: { job_id: string }) => r.job_id))];

    for (const jobId of jobIds) {
      const { data: job } = await supabase
        .from("jobs")
        .select("id, min_cleaners_required, status")
        .eq("id", jobId)
        .maybeSingle();
      if (!job) continue;

      const { count: confirmedCount } = await supabase
        .from("job_assignments")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId)
        .or("status.ilike.confirmed,status.ilike.accepted");

      const need = Number(job.min_cleaners_required) || 1;
      const have = confirmedCount ?? 0;

      if (have >= need) continue;

      await supabase
        .from("jobs")
        .update({
          status: "Dispatching",
          dispatch_alert_reason: `Offer window closed — ${have}/${need} cleaners confirmed`,
        })
        .eq("id", jobId);

      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: `Auto-offer expired: only ${have}/${need} cleaners confirmed within window`,
        severity: "warning",
      });

      try {
        await supabase.functions.invoke("dispatch-job", { body: { jobId, backfill: true } });
      } catch (e) {
        log("backfill dispatch failed", { jobId, err: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, expired: expiredIds.length, jobsChecked: jobIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
