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
import { syncJob, JOB_SERVICE_TYPE, PAYMENT_STATUS, ENTRY_SOURCE } from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cleaner keeps 70% of the turnover price (mirrors _shared/turnover-engine.ts).
const CLEANER_SHARE = 0.7;

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

  try {
    const supabase = getAdminSupabase();
    const { data: tr } = await supabase
      .from("turnover_requests")
      .select("*")
      .eq("id", turnoverId)
      .maybeSingle();
    if (!tr) return NextResponse.json({ error: "Turnover not found" }, { status: 404 });
    if (tr.status !== "completed") {
      return NextResponse.json({ ok: true, skipped: `status=${tr.status}` });
    }

    const [{ data: host }, { data: property }] = await Promise.all([
      supabase.from("hosts").select("name, email").eq("id", tr.host_id).maybeSingle(),
      supabase.from("properties").select("nickname, address").eq("id", tr.property_id).maybeSingle(),
    ]);

    let cleanerName: string | undefined;
    if (tr.assigned_cleaner_id) {
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("first_name, last_name")
        .eq("id", tr.assigned_cleaner_id)
        .maybeSingle();
      if (cleaner) cleanerName = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || undefined;
    }

    const priceCents = Math.round(Number(tr.price || 0) * 100);
    const cleanerPayCents = Math.round(priceCents * CLEANER_SHARE);

    await syncJob({
      jobId: `STR-${turnoverId}`,
      dateCompleted: (tr.completed_at ? String(tr.completed_at).slice(0, 10) : tr.requested_date) || undefined,
      serviceType: JOB_SERVICE_TYPE.strTurnover,
      customerPaidCents: priceCents,
      cleanerName,
      numberOfCleaners: 1,
      // Authoritative turnover pay (70% of price) — wins over the tier estimate.
      cleanerPayPoolCents: cleanerPayCents,
      payPerCleanerCents: cleanerPayCents,
      paymentStatus: tr.balance_charged_at || tr.payment_option === "full" || tr.paid_at ? PAYMENT_STATUS.paid : PAYMENT_STATUS.pending,
      entrySource: ENTRY_SOURCE.portal,
      clientEmail: host?.email || undefined,
      propertyNickname: property?.nickname || undefined,
    });

    await supabase
      .from("turnover_requests")
      .update({ cleaner_payout_cents: cleanerPayCents, airtable_job_synced_at: new Date().toISOString() })
      .eq("id", turnoverId);

    return NextResponse.json({ ok: true, jobId: `STR-${turnoverId}`, cleanerPayCents });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[turnover-job-sync]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
