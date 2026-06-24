// ─── POST /api/partner-admin/contractors-sync ─────────────────────────────────
//
// Creates the Airtable "Contractors" table (if missing) in the Client & Revenue
// Ops base and syncs every cleaner into it with pay totals (lifetime + this
// month), linked Payroll Runs, and their signed Independent Contractor
// Agreement (URL + attached PDF). Admin/VA gated. Idempotent.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncContractors } from "@/lib/airtable/contractors";

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
  const provided = new URL(req.url).searchParams.get("secret") || req.headers.get("x-contractor-secret") || "";
  const expected = await resolveSecret("CONTRACTOR_SYNC_SECRET");
  const viaSecret = !!expected && provided === expected;
  if (!viaSecret) {
    try {
      await requireAdmin(req);
    } catch (err) {
      const e = err as AdminAuthError;
      return NextResponse.json({ error: e.message }, { status: e.status || 401 });
    }
  }

  try {
    const result = await syncContractors();
    return NextResponse.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[partner-admin/contractors-sync]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
