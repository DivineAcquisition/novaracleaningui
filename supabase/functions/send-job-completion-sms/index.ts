// send-job-completion-sms — TOMBSTONE (disabled 2026-07-06)
//
// The original version of this function (deployed 2026-05-22 from a branch
// that never merged) texted cleaners "✅ Job wrap-up time!" every 15 minutes
// via pg_cron, linking to /cleaner/job/<token>/complete — a page that was
// never shipped. The result was purposeless repeat SMS to contractors.
//
// The cron is unscheduled by migration 20260706130000_kill_job_wrapup_sms_cron
// and this no-op replaces the deployed function so nothing can ever send
// that message again, even if an old scheduler or manual invocation hits it.
//
// The job wrap-up flow is handled by the real pipeline instead:
//   • send-day-of-reminders → check-in prompt + job checklist link (~30 min out)
//   • job-check-in          → texts the BEFORE-photos link right after check-in
//   • cleaner-job-checklist → on-site execution checklist + add-on reporting
//   • cleaner-mark-complete → completion review + AFTER-photos link

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  console.log("[send-job-completion-sms] invoked but permanently disabled — no SMS sent");
  return new Response(
    JSON.stringify({
      ok: true,
      disabled: true,
      sent: 0,
      message: "send-job-completion-sms is retired. Wrap-up is handled by check-in → before photos → checklist → cleaner-mark-complete.",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
