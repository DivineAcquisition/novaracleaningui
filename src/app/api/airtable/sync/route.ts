// ─── Airtable sync webhook (trigger point) ────────────────────────────────────
//
// Single entry point that keeps the Airtable "Client & Revenue Ops" base current
// as source data changes. Wire it from whichever trigger your source uses:
//
//   • Supabase Database Webhooks → POST here on insert/update of customers,
//     bookings, payouts (recommended for the partner-portal DB source).
//   • GHL / external webhooks → POST here from the automation.
//   • Scheduled / cron → call the backfill instead (scripts/backfill-airtable.ts).
//
// Auth: every request must carry the shared secret in `x-airtable-sync-secret`
// (or `?secret=`), compared against AIRTABLE_SYNC_WEBHOOK_SECRET. The PAT itself
// is never exposed here — it lives only in the server-side Airtable client.
//
// Accepted bodies:
//   { "type": "client",       "id": "<customer uuid>" }
//   { "type": "client",       "email": "<email>" }
//   { "type": "job",          "id": "<booking uuid>" }
//   { "type": "payroll_runs" }                         // rebuilds weekly runs
//   Supabase DB webhook shape: { "table": "...", "record": { ... }, "type": "INSERT" }

import { NextResponse } from "next/server";
import {
  DEFAULT_LIVE_ENTRY_SOURCE,
  syncAllPayrollRuns,
  syncClientByEmail,
  syncClientById,
  syncJobByBookingId,
} from "@/lib/airtable/sync";
import { syncAllQcIssues, syncQcIssueById } from "@/lib/airtable/qc";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { installAirtableReviewHooks, logSyncRun } from "@/lib/airtable/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveSyncSecret(): Promise<string> {
  const fromEnv = (process.env.AIRTABLE_SYNC_WEBHOOK_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  // Fall back to Supabase app_secrets so the DB trigger (which signs with the
  // app_secrets value) authorizes even when the Vercel env var isn't set.
  try {
    const { getAdminSupabase } = await import("@/lib/airtable/sources/admin-client");
    const { data } = await getAdminSupabase()
      .from("app_secrets")
      .select("value")
      .eq("key", "AIRTABLE_SYNC_WEBHOOK_SECRET")
      .maybeSingle();
    return (data?.value || "").trim();
  } catch {
    return "";
  }
}

async function authorized(req: Request): Promise<boolean> {
  const expected = await resolveSyncSecret();
  if (!expected) return false; // closed by default until configured
  const header = req.headers.get("x-airtable-sync-secret");
  const url = new URL(req.url);
  const query = url.searchParams.get("secret");
  return header === expected || query === expected;
}

type Payload = {
  type?: string;
  id?: string;
  email?: string;
  table?: string;
  record?: Record<string, unknown>;
};

/** Normalize either our simple shape or a Supabase DB-webhook shape. */
function normalize(body: Payload): { entity: string; id?: string; email?: string } {
  if (body.table && body.record) {
    const rec = body.record as Record<string, unknown>;
    if (body.table === "customers") return { entity: "client", id: String(rec.id || ""), email: String(rec.email || "") };
    if (body.table === "bookings") return { entity: "job", id: String(rec.id || "") };
    if (body.table === "payouts") return { entity: "payroll_runs" };
    if (body.table === "qc_issues") return { entity: "qc_issue", id: String(rec.id || "") };
    return { entity: body.table };
  }
  return { entity: String(body.type || ""), id: body.id, email: body.email };
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entity, id, email } = normalize(body);

  // Make app_secrets a single source of truth for the PAT (env still wins).
  await primeAirtablePat();
  installAirtableReviewHooks();

  // External callers (GHL automations, edge functions) hit this route directly;
  // report those passes into the same sync-health telemetry as the queue worker.
  const startedAt = Date.now();
  const flowFor: Record<string, string> = {
    client: "client",
    job: "job",
    payroll_runs: "payroll_runs",
    payroll_run: "payroll_runs",
    qc_issue: "qc_issue",
    qc_issues_all: "qc_issues_all",
  };
  const report = (status: "success" | "error" | "skipped", records?: number, error?: string) => {
    const flow = flowFor[entity];
    if (!flow) return Promise.resolve();
    return logSyncRun({ flow, trigger: "external", status, records, error, startedAt });
  };

  try {
    switch (entity) {
      case "client": {
        const recordId = id
          ? await syncClientById(id)
          : email
            ? await syncClientByEmail(email)
            : null;
        if (!recordId) {
          await report("skipped", 0, "Client not found");
          return NextResponse.json({ error: "Client not found" }, { status: 404 });
        }
        await report("success", 1);
        return NextResponse.json({ ok: true, entity, recordId });
      }
      case "job": {
        if (!id) return NextResponse.json({ error: "Missing booking id" }, { status: 400 });
        const recordId = await syncJobByBookingId(id, { entrySource: DEFAULT_LIVE_ENTRY_SOURCE });
        if (!recordId) {
          await report("skipped", 0, "Booking not found");
          return NextResponse.json({ error: "Booking not found" }, { status: 404 });
        }
        await report("success", 1);
        return NextResponse.json({ ok: true, entity, recordId });
      }
      case "payroll_runs":
      case "payroll_run": {
        const count = await syncAllPayrollRuns();
        await report("success", count);
        return NextResponse.json({ ok: true, entity: "payroll_runs", synced: count });
      }
      case "qc_issue": {
        if (!id) return NextResponse.json({ error: "Missing issue id" }, { status: 400 });
        const recordId = await syncQcIssueById(id);
        if (!recordId) {
          await report("skipped", 0, "Issue not found");
          return NextResponse.json({ error: "Issue not found" }, { status: 404 });
        }
        await report("success", 1);
        return NextResponse.json({ ok: true, entity, recordId });
      }
      case "qc_issues_all": {
        const count = await syncAllQcIssues();
        await report("success", count);
        return NextResponse.json({ ok: true, entity: "qc_issues_all", synced: count });
      }
      default:
        return NextResponse.json({ error: `Unsupported entity: ${entity}` }, { status: 400 });
    }
  } catch (err) {
    await report("error", undefined, (err as Error).message);
    // eslint-disable-next-line no-console
    console.error("[airtable-sync route]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
