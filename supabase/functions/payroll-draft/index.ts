// payroll-draft
//
// Scheduled (weekly, Mon 11:00 UTC via pg_cron) auto-compute + draft of the
// prior Mon–Sun payroll run. No money moves — it only groups approved payroll
// jobs by cleaner and upserts Draft payroll_runs (idempotent), then pings the
// admin via Discord so they can review and click "Approve & Pay".
//
// Can also be invoked manually with an explicit { period: "YYYY-MM-DD" } body
// (any date in the target week) — used by the admin "Build draft" button as a
// safety net. Re-running never duplicates runs or double-attaches jobs.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { notifyDiscord } from "../_shared/discord.ts";
import { buildDraftRuns, priorPeriodMonday } from "../_shared/payroll-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  try {
    const body = await req.json().catch(() => ({}));
    const period = body?.period ? String(body.period) : priorPeriodMonday();

    const result = await buildDraftRuns(admin, period);
    console.log("[payroll-draft] built", result);

    // Notify admin (best-effort) — only when there's something to review.
    if (result.runs > 0 || result.pendingJobs > 0) {
      const pendingLine = result.pendingJobs > 0
        ? `\n⚠️ ${result.pendingJobs} job(s) still PENDING approval for this period — approve them then rebuild to include their pay.`
        : "";
      await notifyDiscord(admin, {
        title: "Payroll draft ready for review",
        color: 3447003,
        fields: [
          { name: "Pay period", value: `${result.period} → ${result.periodEnd}`, inline: true },
          { name: "Cleaners drafted", value: String(result.runs), inline: true },
          { name: "Net total", value: usd(result.netCents), inline: true },
        ],
        description: `Review and click **Approve & Pay** in Admin → Payroll → Auto Payroll.${pendingLine}`,
      }).catch(() => undefined);
    }

    return json({ success: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[payroll-draft]", msg);
    return json({ error: msg }, 500);
  }
});
