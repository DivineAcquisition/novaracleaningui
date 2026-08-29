// ─── /api/admin/checklists/insights ──────────────────────────────────────
//
// The Checklist Review queue.
//
//   GET  → surfaced insights with their supporting counts and linked records
//   POST { action: "resolve", … } → edit / leave unchanged / escalate
//
// Resolving is the ONLY path that changes a checklist's live content, and it
// is always an explicit admin action. An "edit" resolution calls the same
// versioned edit RPC as the item editor and links the new version back to the
// insight that prompted it.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Resolution = "edited" | "unchanged" | "escalated";

const ESCALATION_TARGETS = ["pricing_scope", "duration_learning", "training", "other"] as const;

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "open";

  const supabase = getAdminSupabase();
  let query = supabase
    .from("checklist_insights")
    .select(
      "id, item_id, cycle_start, cycle_end, checklist_keys, area, item_text_at_surface, counts, " +
        "quality_miss_count, scope_confusion_count, qc_case_count, review_theme_count, " +
        "duration_variance_count, recurrence_count, signal_ids, observation, numbers, hypothesis, " +
        "model, model_version, status, resolution_note, escalated_to, resolved_by_name, resolved_at, created_at",
    )
    .order("cycle_start", { ascending: false })
    .order("quality_miss_count", { ascending: false })
    .limit(200);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The live wording, which may already differ from what was surfaced.
  const rows = (data || []) as unknown as Array<{ item_id: string }>;
  const itemIds = Array.from(new Set(rows.map((r) => r.item_id)));
  let items: unknown[] = [];
  if (itemIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("checklist_items")
      .select("item_id, item_text, current_version, area, checklists")
      .in("item_id", itemIds);
    items = itemRows || [];
  }

  return NextResponse.json({
    ok: true,
    insights: data || [],
    items,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure || !principal) return failure!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.action || "") !== "resolve") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const insightId = String(body.insightId || "").trim();
  const resolution = String(body.resolution || "") as Resolution;
  const note = String(body.note || "").trim();
  const itemText = String(body.itemText || "").trim();
  const escalatedTo = String(body.escalatedTo || "").trim();
  const photoRequired = typeof body.photoRequired === "boolean" ? body.photoRequired : null;

  if (!insightId) return NextResponse.json({ error: "insightId is required." }, { status: 400 });
  if (!["edited", "unchanged", "escalated"].includes(resolution)) {
    return NextResponse.json({ error: "resolution must be edited, unchanged, or escalated." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: insight, error: readErr } = await supabase
    .from("checklist_insights")
    .select("id, item_id, status")
    .eq("id", insightId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!insight) return NextResponse.json({ error: "That insight no longer exists." }, { status: 404 });
  if (insight.status !== "open") {
    return NextResponse.json(
      { error: `This was already resolved as "${insight.status}".` },
      { status: 409 },
    );
  }

  let newVersion: unknown = null;

  if (resolution === "edited") {
    if (!itemText) {
      return NextResponse.json({ error: "Provide the new wording for the item." }, { status: 400 });
    }
    if (!note) {
      return NextResponse.json(
        { error: "Record what changed and why — it is kept in version history." },
        { status: 400 },
      );
    }
    const { data, error } = await supabase.rpc("apply_checklist_item_edit", {
      p_item_id: insight.item_id,
      p_item_text: itemText,
      p_photo_required: photoRequired,
      p_change_summary: note,
      p_source_insight_id: insightId,
      p_actor_id: principal.userId,
      p_actor_name: principal.email,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    newVersion = data;
  }

  if (resolution === "unchanged" && !note) {
    return NextResponse.json(
      {
        error:
          "Say why it stays as-is, so the same signal isn't re-litigated next cycle unless it worsens.",
      },
      { status: 400 },
    );
  }

  if (resolution === "escalated" && !ESCALATION_TARGETS.includes(escalatedTo as typeof ESCALATION_TARGETS[number])) {
    return NextResponse.json(
      { error: `escalatedTo must be one of ${ESCALATION_TARGETS.join(", ")}.` },
      { status: 400 },
    );
  }

  const { error: updateErr } = await supabase
    .from("checklist_insights")
    .update({
      status: resolution,
      resolution_note: note || null,
      escalated_to: resolution === "escalated" ? escalatedTo : null,
      resolved_by: principal.userId,
      resolved_by_name: principal.email,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", insightId)
    .eq("status", "open");
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await supabase.from("events").insert({
    event_type: "checklist.review_resolved",
    source: "checklist-feedback",
    summary: `${principal.email} resolved ${insight.item_id} as ${resolution}.`,
    data: { insight_id: insightId, item_id: insight.item_id, resolution, escalated_to: escalatedTo || null },
  });

  return NextResponse.json({ ok: true, resolution, version: newVersion });
}
