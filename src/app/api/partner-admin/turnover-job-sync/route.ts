// ─── POST /api/partner-admin/turnover-job-sync?secret=... ─────────────────────
//
// Maps a COMPLETED partner turnover into the Airtable "Client & Revenue Ops"
// base as a Job row, including the cleaner's pay — so turnover revenue + cleaner
// pay land in Airtable alongside residential jobs. Fired by a DB trigger
// (pg_net) the moment a turnover flips to 'completed', and idempotent
// (merge on Job ID = STR-{turnoverId}).
//
// Authenticated by the shared secret in ?secret= (TURNOVER_SYNC_SECRET in
// app_secrets) since the caller is the database, not an admin session.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncTurnoverJob } from "@/lib/airtable/flows";
import { installAirtableReviewHooks, logSyncRun } from "@/lib/airtable/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveSecret(name: string): Promise<string> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through */
  }
  return (process.env[name] || "").trim();
}

export async function POST(req: Request): Promise<NextResponse> {
  const expected = await resolveSecret("TURNOVER_SYNC_SECRET");
  const provided = new URL(req.url).searchParams.get("secret") || req.headers.get("x-turnover-secret") || "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { turnoverId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const turnoverId = body.turnoverId;
  if (!turnoverId) return NextResponse.json({ error: "turnoverId required" }, { status: 400 });

  // Shared flow implementation (same one the queue worker runs) + telemetry.
  installAirtableReviewHooks();
  const startedAt = Date.now();
  try {
    const result = await syncTurnoverJob(turnoverId);
    await logSyncRun({
      flow: "turnover",
      trigger: "external",
      status: result.status === "skipped" ? "skipped" : "success",
      records: result.records,
      detail: result.detail,
      startedAt,
    });
    if (result.status === "skipped") {
      const reason = String((result.detail as { reason?: string } | undefined)?.reason || "skipped");
      if (reason === "turnover not found") {
        return NextResponse.json({ error: "Turnover not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, skipped: reason });
    }
    const detail = (result.detail || {}) as { jobId?: string; cleanerPayCents?: number };
    return NextResponse.json({ ok: true, jobId: detail.jobId, cleanerPayCents: detail.cleanerPayCents });
  } catch (err) {
    await logSyncRun({
      flow: "turnover",
      trigger: "external",
      status: "error",
      error: (err as Error).message,
      startedAt,
    });
    // eslint-disable-next-line no-console
    console.error("[turnover-job-sync]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
