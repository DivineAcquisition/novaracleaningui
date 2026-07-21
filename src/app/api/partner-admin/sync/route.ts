// ─── POST /api/partner-admin/sync ─────────────────────────────────────────────
//
// Reconciles the operational STR data in Supabase (the turnover portal: hosts +
// properties) INTO the Airtable "Client & Revenue Ops" base that powers the Host
// Accounts management view — so the two halves of the Partnerships tab stay one
// dataset. Identity-only sync (host contact + property nickname/address/beds +
// host link); pricing, lifecycle, and status remain owned by Airtable so a
// backfill never clobbers admin-set rates.
//
// Admin/VA gated. Safe to run repeatedly (idempotent upserts on email / nickname).

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncAllPartners } from "@/lib/airtable/flows";
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
  // Allow either an admin/VA session OR the shared secret (DB trigger / cron).
  const provided = new URL(req.url).searchParams.get("secret") || req.headers.get("x-partner-secret") || "";
  const expected = await resolveSecret("PARTNER_SYNC_SECRET");
  const viaSecret = !!expected && provided === expected;
  if (!viaSecret) {
    try {
      await requireAdmin(req);
    } catch (err) {
      const e = err as AdminAuthError;
      return NextResponse.json({ error: e.message }, { status: e.status || 401 });
    }
  }

  // Shared flow implementation (same one the queue worker runs) + telemetry.
  installAirtableReviewHooks();
  const startedAt = Date.now();
  try {
    const result = await syncAllPartners();
    const detail = (result.detail || {}) as {
      hostsSynced?: number;
      propertiesSynced?: number;
      warnings?: string[];
    };
    await logSyncRun({
      flow: "partner",
      trigger: viaSecret ? "external" : "manual",
      status: "success",
      records: result.records,
      detail: result.detail,
      startedAt,
    });
    return NextResponse.json({
      ok: true,
      hostsSynced: detail.hostsSynced ?? 0,
      propertiesSynced: detail.propertiesSynced ?? 0,
      warnings: detail.warnings ?? [],
    });
  } catch (err) {
    await logSyncRun({
      flow: "partner",
      trigger: viaSecret ? "external" : "manual",
      status: "error",
      error: (err as Error).message,
      startedAt,
    });
    // eslint-disable-next-line no-console
    console.error("[partner-admin/sync]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
