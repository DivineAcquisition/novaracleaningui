// ─── weekly-report-generate ────────────────────────────────────────────────
//
// Builds the weekly Sales / Retention / Growth PDF from existing systems,
// writes insights that cite those numbers, stores the PDF, mirrors it to
// Drive (NVC WeekLt Report & Forcast), attaches in Airtable, and notifies
// admin. Never auto-changes budgets, zones, or pricing.
//
// Auth: service-role bearer, x-cron-secret, or admin JWT.
// Actions:
//   tick        — hourly cron: generate if it's the configured weekday/hour,
//                 else retry failed / drive-pending reports
//   generate    — on-demand for prior week or { periodStart, periodEnd }
//   save_settings — persist weekly_report_settings
//   get_settings

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { collectWeeklySnapshot } from "../_shared/weekly-report/collect.ts";
import { notifyWeeklyReport, mirrorWeeklyPdfToDrive, syncWeeklyReportToAirtable } from "../_shared/weekly-report/distribute.ts";
import { generateInsights } from "../_shared/weekly-report/insights.ts";
import { buildWeeklyReportPdf, reportPath } from "../_shared/weekly-report/pdf.ts";
import { priorCompletedWeek, zonedNowParts } from "../_shared/weekly-report/period.ts";
import { DEFAULT_SETTINGS, parseSettings, type WeeklyReportSettings } from "../_shared/weekly-report/types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "weekly-reports";
const MAX_ATTEMPTS = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;

async function authorize(req: Request, sb: SB): Promise<{ ok: boolean; userId?: string; cron?: boolean }> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (token && serviceKey && token === serviceKey) return { ok: true, cron: true };

  const cronSecret = req.headers.get("x-cron-secret") || "";
  if (cronSecret) {
    const expected = (await resolveSecret(sb, "CRON_SECRET")).trim();
    if (expected && cronSecret === expected) return { ok: true, cron: true };
  }

  if (!token) return { ok: false };
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user?.id) return { ok: false };
  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => r.role === "admin");
  return allowed ? { ok: true, userId: u.user.id } : { ok: false };
}

async function loadSettings(sb: SB): Promise<WeeklyReportSettings> {
  const { data } = await sb.from("app_settings").select("value").eq("key", "weekly_report_settings").maybeSingle();
  return parseSettings(data?.value);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const auth = await authorize(req, sb);
  if (!auth.ok) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as {
    action?: string;
    source?: string;
    force?: boolean;
    periodStart?: string;
    periodEnd?: string;
    settings?: unknown;
  };
  const action = body.action || (body.source === "pg_cron" ? "tick" : "generate");

  try {
    if (action === "get_settings") {
      return json({ ok: true, settings: await loadSettings(sb), defaults: DEFAULT_SETTINGS });
    }
    if (action === "save_settings") {
      if (auth.cron) return json({ error: "Settings changes must come from an admin session." }, 403);
      const next = parseSettings(body.settings);
      await sb.from("app_settings").upsert({
        key: "weekly_report_settings",
        value: next,
        updated_at: new Date().toISOString(),
        updated_by: auth.userId || null,
      }, { onConflict: "key" });
      if (next.drive_root_folder_id) {
        await sb.from("app_secrets").upsert({
          key: "GDRIVE_WEEKLY_REPORT_ROOT_FOLDER_ID",
          value: next.drive_root_folder_id,
          description: "Google Drive folder for weekly report PDFs (NVC WeekLt Report & Forcast).",
        }, { onConflict: "key" });
      }
      return json({ ok: true, settings: next });
    }

    const settings = await loadSettings(sb);
    const now = new Date();

    if (action === "tick") {
      const parts = zonedNowParts(now, settings.timezone);
      const pastRunSlot =
        parts.weekday > settings.run_weekday ||
        (parts.weekday === settings.run_weekday && parts.hour >= settings.run_hour);
      const due = settings.enabled && pastRunSlot;
      const results: unknown[] = [];
      if (due) {
        const week = priorCompletedWeek(now, settings.timezone);
        results.push(await generateForPeriod(sb, settings, week.start, week.end, "scheduled", false, auth.userId));
      }
      results.push(...await retryPending(sb, settings));
      return json({ ok: true, due, results });
    }

    if (action === "retry") {
      const retried = await retryPending(sb, settings);
      return json({ ok: true, retried });
    }

    const week = body.periodStart && body.periodEnd
      ? { start: body.periodStart, end: body.periodEnd }
      : priorCompletedWeek(now, settings.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week.start) || !/^\d{4}-\d{2}-\d{2}$/.test(week.end)) {
      return json({ error: "periodStart/periodEnd must be YYYY-MM-DD" }, 400);
    }
    const result = await generateForPeriod(
      sb,
      settings,
      week.start,
      week.end,
      auth.cron ? "scheduled" : "on_demand",
      Boolean(body.force),
      auth.userId,
    );
    return json(result);
  } catch (err) {
    console.error("[weekly-report-generate]", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function retryPending(sb: SB, settings: WeeklyReportSettings) {
  const { data } = await sb
    .from("weekly_reports")
    .select("period_start, period_end, status, pdf_attempts")
    .in("status", ["failed", "drive_pending"])
    .lt("pdf_attempts", MAX_ATTEMPTS)
    .order("updated_at", { ascending: true })
    .limit(5);
  const rows = (data || []) as Array<{ period_start: string; period_end: string }>;
  const out = [];
  for (const row of rows) {
    out.push(await generateForPeriod(sb, settings, row.period_start, row.period_end, "retry", true));
  }
  return out;
}

async function generateForPeriod(
  sb: SB,
  settings: WeeklyReportSettings,
  periodStart: string,
  periodEnd: string,
  trigger: "scheduled" | "on_demand" | "retry",
  force: boolean,
  userId?: string,
) {
  const { data: existing } = await sb
    .from("weekly_reports")
    .select("*")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  if (existing?.status === "generated" && existing?.pdf_status === "generated" && !force) {
    return { ok: true, skipped: "already_generated", id: existing.id, driveUrl: existing.drive_url };
  }

  const attempts = Number(existing?.pdf_attempts || 0) + 1;
  const upsertBase = {
    period_start: periodStart,
    period_end: periodEnd,
    status: "generating",
    trigger,
    pdf_attempts: attempts,
    generated_by: userId || null,
  };
  const { data: row, error: upErr } = await sb
    .from("weekly_reports")
    .upsert(upsertBase, { onConflict: "period_start,period_end" })
    .select("id")
    .maybeSingle();
  if (upErr) throw new Error(`Could not claim report row: ${upErr.message}`);
  const id = row?.id || existing?.id;

  try {
    const snapshot = await collectWeeklySnapshot(sb, periodStart, periodEnd, settings.timezone);
    const priorWatch = await loadPriorWatch(sb, periodStart);
    const insight = await generateInsights(sb, snapshot, {
      maxInsights: settings.max_insights,
      priorWatch,
    });
    const bytes = await buildWeeklyReportPdf({
      snapshot,
      executiveSummary: insight.executive_summary,
      insights: insight.insights,
      watchList: insight.watch_list,
      model: insight.model,
      modelVersion: insight.model_version,
      generatedAt: new Date(),
    });
    const path = reportPath(periodStart, periodEnd);
    const { error: storErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (storErr) throw new Error(`Storage upload failed: ${storErr.message}`);

    const drive = await mirrorWeeklyPdfToDrive(sb, settings, periodStart, bytes);
    const generatedAt = new Date().toISOString();
    const status = drive.ok ? "generated" : "drive_pending";
    const pdfStatus = drive.ok ? "generated" : "drive_pending";

    await sb.from("weekly_reports").update({
      status,
      pdf_status: pdfStatus,
      pdf_path: path,
      pdf_generated_at: generatedAt,
      pdf_last_error: drive.ok ? null : (drive.error || drive.skipped || "drive mirror failed"),
      drive_file_id: drive.fileId || null,
      drive_url: drive.url || null,
      drive_folder_id: drive.folderId || null,
      metrics: snapshot,
      unavailable_sources: snapshot.sources.filter((s) => !s.available).map((s) => s.id),
      insights: insight.insights,
      watch_list: insight.watch_list,
      executive_summary: insight.executive_summary,
      insight_model: insight.model,
      insight_model_version: insight.model_version,
      generated_at: generatedAt,
    }).eq("id", id);

    const airtable = await syncWeeklyReportToAirtable(sb, {
      period_start: periodStart,
      period_end: periodEnd,
      status,
      executive_summary: insight.executive_summary,
      insight_model: insight.model,
      drive_url: drive.url || null,
      pdf_path: path,
      generated_at: generatedAt,
    });

    await notifyWeeklyReport(sb, "ready", settings, {
      periodStart,
      periodEnd,
      driveUrl: drive.url,
      summary: insight.executive_summary,
    });
    await sb.from("weekly_reports").update({ notified_at: new Date().toISOString() }).eq("id", id);

    return {
      ok: true,
      id,
      status,
      driveUrl: drive.url || null,
      driveError: drive.ok ? undefined : (drive.error || drive.skipped),
      airtable,
      model: insight.model,
      path,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb.from("weekly_reports").update({
      status: "failed",
      pdf_status: "failed",
      pdf_last_error: message.slice(0, 500),
      pdf_attempts: attempts,
    }).eq("id", id);

    const already = existing?.failure_notified_at;
    if (!already || attempts >= MAX_ATTEMPTS) {
      await notifyWeeklyReport(sb, "failed", settings, {
        periodStart,
        periodEnd,
        error: message,
      });
      await sb.from("weekly_reports").update({ failure_notified_at: new Date().toISOString() }).eq("id", id);
    }
    return { ok: false, id, error: message, attempts };
  }
}

async function loadPriorWatch(sb: SB, periodStart: string): Promise<string[]> {
  const { data } = await sb
    .from("weekly_reports")
    .select("watch_list")
    .lt("period_start", periodStart)
    .eq("status", "generated")
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  const list = data?.watch_list;
  return Array.isArray(list) ? list.map((x: unknown) => String(x)).filter(Boolean) : [];
}
