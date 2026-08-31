// ─── /api/admin/assistant/insights ────────────────────────────────────────
//
// The Assistant Review Queue.
//
//   GET  → surfaced patterns with supporting questions and counts
//   POST { action: "resolve", … } → docs note / prompt edit / capability gap / dismiss
//
// Resolving is the ONLY path that changes prompt or records a docs action,
// and it is always an explicit admin action. Nothing here mutates the
// assistant on its own.

import { NextResponse } from "next/server";

import { AdminAuthError } from "@/lib/admin-auth";
import { DEFAULT_SYSTEM_PROMPT, loadSystemPrompt } from "@/lib/ops-assistant/prompt";
import { requireOpsAssistant } from "@/lib/ops-assistant/principal";
import { getOpsSupabase } from "@/lib/ops-assistant/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Resolution = "docs_noted" | "prompt_edited" | "capability_gap" | "dismissed";

async function guard(req: Request) {
  try {
    const principal = await requireOpsAssistant(req);
    if (!principal.isAdmin) {
      return {
        principal: null,
        failure: NextResponse.json({ error: "Admins only." }, { status: 403 }),
      };
    }
    return { principal, failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

export async function GET(req: Request) {
  const { failure } = await guard(req);
  if (failure) return failure;

  const sb = getOpsSupabase();
  if (!sb) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "open";

  let query = sb
    .from("ops_assistant_insights")
    .select(
      "id, topic_key, topic_label, cycle_start, cycle_end, counts, not_helpful_count, dont_know_count, " +
        "escalation_gap_count, escalation_policy_count, example_questions, observation, numbers, hypothesis, " +
        "suggested_gap, model, model_version, status, resolution_note, resolved_by_name, resolved_at, created_at",
    )
    .order("cycle_start", { ascending: false })
    .order("not_helpful_count", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const prompt = await loadSystemPrompt(sb);
  return NextResponse.json({
    ok: true,
    insights: data || [],
    prompt: { version: prompt.version, source: prompt.source, body: prompt.body },
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
  });
}

export async function POST(req: Request) {
  const { principal, failure } = await guard(req);
  if (failure || !principal) return failure!;

  const sb = getOpsSupabase();
  if (!sb) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.action || "") !== "resolve") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const insightId = String(body.insightId || "").trim();
  const resolution = String(body.resolution || "") as Resolution;
  const note = String(body.note || "").trim();
  const promptBody = String(body.promptBody || "");

  if (!insightId) return NextResponse.json({ error: "insightId is required." }, { status: 400 });
  if (!["docs_noted", "prompt_edited", "capability_gap", "dismissed"].includes(resolution)) {
    return NextResponse.json({ error: "Unknown resolution." }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json(
      { error: "Record why — every action from this queue is logged against the pattern that prompted it." },
      { status: 400 },
    );
  }

  const { data: insight, error: readErr } = await sb
    .from("ops_assistant_insights")
    .select("id, topic_key, status")
    .eq("id", insightId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!insight) return NextResponse.json({ error: "That insight no longer exists." }, { status: 404 });
  if (insight.status !== "open") {
    return NextResponse.json({ error: `This was already resolved as "${insight.status}".` }, { status: 409 });
  }

  let promptVersion: unknown = null;
  if (resolution === "prompt_edited") {
    if (!promptBody.trim()) {
      return NextResponse.json({ error: "Provide the new system prompt." }, { status: 400 });
    }
    const { data, error } = await sb.rpc("apply_ops_assistant_prompt_edit", {
      p_body: promptBody,
      p_change_summary: note,
      p_source_insight_id: insightId,
      p_actor_id: principal.userId,
      p_actor_name: principal.email,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    promptVersion = data;
  } else {
    await sb.from("ops_assistant_change_log").insert({
      kind: resolution === "docs_noted" ? "docs_noted" : resolution === "capability_gap" ? "capability_gap" : "dismissed",
      source_insight_id: insightId,
      summary: note,
      payload: { topic_key: insight.topic_key, resolution },
      changed_by: principal.userId,
      changed_by_name: principal.email,
    });
  }

  const { error: updateErr } = await sb
    .from("ops_assistant_insights")
    .update({
      status: resolution,
      resolution_note: note,
      resolved_by: principal.userId,
      resolved_by_name: principal.email,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", insightId)
    .eq("status", "open");
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  try {
    await sb.from("events").insert({
      event_type: "ops_assistant.review_resolved",
      source: "ops-assistant-feedback",
      summary: `${principal.email} resolved ${insight.topic_key} as ${resolution}.`,
      data: { insight_id: insightId, topic_key: insight.topic_key, resolution },
    });
  } catch {
    /* events table shape may differ in preview */
  }

  return NextResponse.json({ ok: true, resolution, promptVersion });
}
