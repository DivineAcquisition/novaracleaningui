// ─── POST /api/va/airtable-sync ───────────────────────────────────────────────
//
// Creates the Airtable "VAs" table (if missing) in the Client & Revenue Ops
// base and backlogs every VA onboarding record into it (identity, role + pay
// type, onboarding status, signed agreement, submitted details). Admin/VA
// gated. Idempotent (merge on Email).

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { syncVas } from "@/lib/airtable/vas";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { installAirtableReviewHooks, logSyncRun } from "@/lib/airtable/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  const startedAt = Date.now();
  try {
    await primeAirtablePat();
    installAirtableReviewHooks();
    const result = await syncVas();
    await logSyncRun({
      flow: "vas",
      trigger: "manual",
      status: "success",
      records: result.vasSynced,
      detail: { warnings: result.warnings.slice(0, 20) },
      startedAt,
    });
    return NextResponse.json(result);
  } catch (err) {
    await logSyncRun({
      flow: "vas",
      trigger: "manual",
      status: "error",
      error: (err as Error).message,
      startedAt,
    });
    // eslint-disable-next-line no-console
    console.error("[va/airtable-sync]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
