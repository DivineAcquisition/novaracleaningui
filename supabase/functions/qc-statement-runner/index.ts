// qc-statement-runner
//
// Periodic sweeper:
//   1. Reminder SMS+email at the configured interval before due (default 24h).
//   2. After due with no submission: flag Statement Not Provided.
//      NEVER writes Score, accountability, cleaner status, or qc_issues.status.
//   3. Retry failed statement PDFs / Drive mirrors.
//
// Auth: service-role bearer, x-cron-secret, or admin/VA JWT.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { statementSweepAction } from "../_shared/qc-statement.ts";
import {
  loadQcStatementSettings,
  markStatementNotProvided,
  remindQcStatement,
} from "../_shared/qc-statement-ops.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[qc-statement-runner] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

async function authorize(req: Request, admin: SB): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token && serviceKey && token === serviceKey) return true;

  const cronHeader = (req.headers.get("x-cron-secret") || "").trim();
  if (cronHeader) {
    let expected = (Deno.env.get("CRON_SECRET") || "").trim();
    try {
      const { data } = await admin.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
      if (data?.value && typeof data.value === "string" && data.value.trim()) {
        expected = data.value.trim();
      }
    } catch {
      /* env fallback */
    }
    if (expected && cronHeader === expected) return true;
  }

  if (!token) return false;
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user?.id) return false;
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  return (roles || []).some((r: { role: string }) => r.role === "admin" || r.role === "va");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  if (!(await authorize(req, admin))) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body?.dryRun || body?.dry_run);
    const settings = await loadQcStatementSettings(admin);
    const now = new Date();

    const { data: pending } = await admin
      .from("qc_statement_requests")
      .select("*")
      .eq("status", "requested")
      .order("due_at", { ascending: true })
      .limit(80);

    let reminded = 0;
    let flagged = 0;
    for (const row of pending || []) {
      const action = statementSweepAction({
        status: row.status,
        submittedAt: row.submitted_at,
        dueAt: row.due_at,
        reminderSentAt: row.reminder_sent_at,
        reminderHoursBefore: settings.reminder_hours_before,
        now,
      });
      if (action === "none") continue;
      if (dryRun) {
        if (action === "remind") reminded++;
        if (action === "mark_not_provided") flagged++;
        continue;
      }
      if (action === "remind") {
        const r = await remindQcStatement(admin, row, settings);
        if (r.ok && !("skipped" in r && r.skipped)) reminded++;
      } else if (action === "mark_not_provided") {
        await markStatementNotProvided(admin, row);
        flagged++;
      }
    }

    let pdfRetried = 0;
    const { data: failedPdfs } = await admin
      .from("qc_statement_submissions")
      .select("id")
      .eq("pdf_status", "failed")
      .lt("pdf_attempts", 8)
      .order("created_at", { ascending: true })
      .limit(8);
    if (!dryRun) {
      for (const row of failedPdfs || []) {
        try {
          await admin.functions.invoke("qc-statement-drive", {
            body: { action: "finalize", submissionId: row.id },
          });
          pdfRetried++;
        } catch (e) {
          log("pdf retry invoke failed", { id: row.id, err: e instanceof Error ? e.message : e });
        }
      }
    }

    log("ran", { reminded, flagged, pdfRetried, dryRun, pending: (pending || []).length });
    return json({
      ok: true,
      reminded,
      flaggedNotProvided: flagged,
      pdfRetried,
      dryRun,
      noAutoPenalty: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ error: msg }, 500);
  }
});
