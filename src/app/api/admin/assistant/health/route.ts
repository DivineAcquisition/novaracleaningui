// ─── /api/admin/assistant/health ──────────────────────────────────────────
//
// Assistant Health — helpful/not-helpful rate and escalation-vs-genuine-answer
// over time, plus before/after the last prompt or docs action from the queue.

import { NextResponse } from "next/server";

import { AdminAuthError } from "@/lib/admin-auth";
import { loadSystemPrompt } from "@/lib/ops-assistant/prompt";
import { requireOpsAssistant } from "@/lib/ops-assistant/principal";
import { getOpsSupabase } from "@/lib/ops-assistant/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const principal = await requireOpsAssistant(req);
    if (!principal.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const sb = getOpsSupabase();
    if (!sb) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });

    const [daily, rollup, versions, changes, settings] = await Promise.all([
      sb.from("ops_assistant_health_daily").select("*").order("day", { ascending: false }).limit(90),
      sb.from("ops_assistant_health").select("*").maybeSingle(),
      sb
        .from("ops_assistant_prompt_versions")
        .select("id, version, change_summary, source_insight_id, changed_by_name, created_at")
        .order("version", { ascending: false })
        .limit(20),
      sb
        .from("ops_assistant_change_log")
        .select("id, kind, source_insight_id, summary, changed_by_name, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      sb.from("app_settings").select("value").eq("key", "ops_assistant_feedback_settings").maybeSingle(),
    ]);

    const prompt = await loadSystemPrompt(sb);

    return NextResponse.json({
      ok: true,
      daily: daily.data || [],
      health: rollup.data || null,
      promptVersions: versions.data || [],
      changes: changes.data || [],
      settings: settings.data?.value || null,
      prompt: { version: prompt.version, source: prompt.source },
      dailyError: daily.error?.message || null,
      healthError: rollup.error?.message || null,
    });
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
