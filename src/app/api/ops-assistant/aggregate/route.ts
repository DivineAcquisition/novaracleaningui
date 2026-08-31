// ─── /api/ops-assistant/aggregate ─────────────────────────────────────────
//
// Monthly (pg_cron) or on demand from the review queue. Writes insight rows
// only — never the system prompt, never the guides.

import { NextResponse } from "next/server";

import { AdminAuthError } from "@/lib/admin-auth";
import { runFeedbackAggregation } from "@/lib/ops-assistant/feedback-aggregate";
import { requireOpsAssistant } from "@/lib/ops-assistant/principal";
import { getOpsSupabase } from "@/lib/ops-assistant/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function cronOk(req: Request, sb: NonNullable<ReturnType<typeof getOpsSupabase>>): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret") || "";
  if (!provided) return false;
  try {
    const { data } = await sb.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
    const expected = String(data?.value || process.env.CRON_SECRET || "").trim();
    return Boolean(expected && provided === expected);
  } catch {
    return Boolean(process.env.CRON_SECRET && provided === process.env.CRON_SECRET);
  }
}

export async function POST(req: Request) {
  const sb = getOpsSupabase();
  if (!sb) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });

  const isCron = await cronOk(req, sb);
  if (!isCron) {
    try {
      const principal = await requireOpsAssistant(req);
      if (!principal.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    } catch (err) {
      if (err instanceof AdminAuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status || 401 });
      }
      throw err;
    }
  }

  try {
    const result = await runFeedbackAggregation(sb);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Aggregation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
