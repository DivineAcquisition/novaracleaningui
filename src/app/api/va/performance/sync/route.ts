// ─── Verified metrics sync (cron + admin "sync now") ──────────────────────────
//
// Pulls actuals from every source and upserts one row per VA per day. Runs on a
// schedule through the day so the EOD form pre-fills with current data, and
// again after the cutoff to settle the day.
//
// Auth mirrors the talent sync: a shared secret for pg_cron (query ?secret= or
// x-va-metrics-secret), or an admin bearer token for a manual run.
//
// Idempotent by construction — every write is an upsert on (va_id, work_date),
// so replaying a day updates in place and never duplicates.

import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncTeamPerformanceBase } from "@/lib/va-performance/airtable";
import { retryPendingReports } from "@/lib/va-performance/eod-report";
import {
  addDays,
  dateRange,
  getEodSettings,
  localDate,
  primePerformanceSecrets,
} from "@/lib/va-performance/settings";
import { syncVerifiedMetrics } from "@/lib/va-performance/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function resolveSecret(name: string): Promise<string> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through to env */
  }
  return (process.env[name] || "").trim();
}

async function handle(req: Request, body: Record<string, unknown>): Promise<NextResponse> {
  const provided =
    new URL(req.url).searchParams.get("secret") || req.headers.get("x-va-metrics-secret") || "";
  const expected = await resolveSecret("VA_METRICS_SYNC_SECRET");
  const viaSecret = Boolean(expected) && provided === expected;

  if (!viaSecret) {
    try {
      await requireAdmin(req);
    } catch (err) {
      const e = err as AdminAuthError;
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 401 });
    }
  }

  await primePerformanceSecrets();
  const settings = await getEodSettings();
  const today = localDate(new Date(), settings.timezone);

  // Default: today plus the backdate window, so a day a VA can still edit is
  // always kept current.
  let dates: string[];
  if (Array.isArray(body.dates) && body.dates.length) {
    dates = body.dates.map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 62);
  } else if (body.startDate && body.endDate) {
    dates = dateRange(String(body.startDate), String(body.endDate)).slice(0, 62);
  } else if (body.scope === "today") {
    dates = [today];
  } else {
    dates = dateRange(addDays(today, -settings.backdateDays), today);
  }

  const vaIds = Array.isArray(body.vaIds) ? body.vaIds.map(String) : undefined;

  try {
    const report = await syncVerifiedMetrics(dates, vaIds);

    // Heal any EOD report whose PDF or Drive mirror didn't land. Automatic and
    // logged, so a Drive outage recovers without anyone noticing it happened.
    let pdfRetry: { retried: number; healed: number } | undefined;
    try {
      pdfRetry = await retryPendingReports();
      if (pdfRetry.retried > pdfRetry.healed) {
        report.warnings.push(
          `EOD reports: ${pdfRetry.retried - pdfRetry.healed} still pending after retry.`,
        );
      }
    } catch (err) {
      report.warnings.push(`EOD report retry: ${(err as Error).message}`);
    }

    // Push the Airtable mirror on the same schedule, the way the other
    // Airtable flows here run. Never fatal: a mirror failure must not fail the
    // sync that produced the source-of-truth rows.
    let airtable: unknown;
    if (body.airtable !== false) {
      try {
        airtable = await syncTeamPerformanceBase({
          startDate: dates[0] ?? today,
          endDate: dates[dates.length - 1] ?? today,
        });
      } catch (err) {
        airtable = { ok: false, error: (err as Error).message };
        report.warnings.push(`Airtable mirror: ${(err as Error).message}`);
      }
    }

    return NextResponse.json({ ok: true, ...report, airtable, pdfRetry });
  } catch (err) {
    console.error("[va-metrics-sync] failed:", (err as Error).message);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(req, body);
}

/** pg_cron posts a body, but a plain GET with ?secret= is supported too. */
export async function GET(req: Request): Promise<NextResponse> {
  return handle(req, {});
}
