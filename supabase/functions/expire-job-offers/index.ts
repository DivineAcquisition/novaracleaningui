// expire-job-offers
//
// Cron: expire stale Offered rows, auto-offer the next closest cleaners,
// email Admins + VAs when no one is left to offer.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { runJobDispatchBackfill, type BackfillResult } from "../_shared/dispatch-backfill.ts";

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
    const backfillResults: BackfillResult[] = [];

    for (const jobId of jobIds) {
      const result = await runJobDispatchBackfill(
        supabase,
        jobId,
        "Offer not accepted within 10 minutes",
      );
      backfillResults.push(result);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        expired: expiredIds.length,
        jobsChecked: jobIds.length,
        backfills: backfillResults,
      }),
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
