// ─── /api/ops-assistant/feedback ──────────────────────────────────────────
//
// Per-response helpful / not-helpful. Writes the rating onto the caller's
// own assistant message. Never changes prompt, knowledge, or behaviour.

import { NextResponse } from "next/server";

import { AdminAuthError } from "@/lib/admin-auth";
import { requireOpsAssistant } from "@/lib/ops-assistant/principal";
import { getOpsSupabase } from "@/lib/ops-assistant/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const principal = await requireOpsAssistant(req);
    const sb = getOpsSupabase();
    if (!sb) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });

    const body = (await req.json()) as Record<string, unknown>;
    const messageId = String(body.messageId || "").trim();
    const rating = String(body.rating || "").trim();
    const note = String(body.note || "").trim().slice(0, 1000);
    if (!messageId) return NextResponse.json({ error: "messageId is required." }, { status: 400 });
    if (rating !== "helpful" && rating !== "not_helpful") {
      return NextResponse.json({ error: "rating must be helpful or not_helpful." }, { status: 400 });
    }

    const { data: message, error: readErr } = await sb
      .from("ops_assistant_messages")
      .select("id, role, thread_id")
      .eq("id", messageId)
      .maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    if (!message || message.role !== "assistant") {
      return NextResponse.json({ error: "That assistant message was not found." }, { status: 404 });
    }

    const { data: thread } = await sb
      .from("ops_assistant_threads")
      .select("user_id")
      .eq("id", message.thread_id)
      .maybeSingle();
    if (!thread || thread.user_id !== principal.userId) {
      return NextResponse.json({ error: "You can only rate your own conversation." }, { status: 403 });
    }

    const { error } = await sb
      .from("ops_assistant_messages")
      .update({
        rating,
        rating_note: note || null,
        rated_at: new Date().toISOString(),
        rated_by: principal.userId,
      })
      .eq("id", messageId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, messageId, rating });
  } catch (err) {
    return fail(err);
  }
}
