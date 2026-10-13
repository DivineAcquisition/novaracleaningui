// ─── GET/PATCH /api/hiring/session/[token] ────────────────────────────────────
//
// Public read and autosave for one tokenized application. The token is the
// only credential. Submitted sessions stay readable so the form can show that
// the application was already received.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  loadHiringSession,
  sanitizeAnswers,
  sessionExpiry,
  toPublicSession,
  type HiringSessionAnswers,
} from "@/lib/hiring/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  let supabase;
  try {
    supabase = getAdminSupabase();
  } catch {
    return NextResponse.json({ error: "This application link is unavailable right now." }, { status: 500 });
  }

  const { row, expired } = await loadHiringSession(supabase, params.token);
  if (!row) return NextResponse.json({ error: "This application link is not valid." }, { status: 404 });
  if (expired) {
    return NextResponse.json(
      { error: "This application link has expired. Reply to your invite and we’ll send a fresh one." },
      { status: 410 },
    );
  }
  return NextResponse.json({ ok: true, session: toPublicSession(row) });
}

export async function PATCH(
  req: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  let supabase;
  try {
    supabase = getAdminSupabase();
  } catch {
    return NextResponse.json({ error: "Could not save your progress." }, { status: 500 });
  }

  const { row, expired } = await loadHiringSession(supabase, params.token);
  if (!row) return NextResponse.json({ error: "This application link is not valid." }, { status: 404 });
  if (expired) {
    return NextResponse.json({ error: "This application link has expired." }, { status: 410 });
  }
  if (row.status === "submitted") {
    return NextResponse.json({ ok: true, session: toPublicSession(row), saved: false });
  }

  let body: { answers?: unknown; stepIndex?: unknown };
  try {
    body = (await req.json()) as { answers?: unknown; stepIndex?: unknown };
  } catch {
    return NextResponse.json({ error: "Could not read your progress." }, { status: 400 });
  }

  const incoming = sanitizeAnswers(body.answers);
  const merged: HiringSessionAnswers = { ...sanitizeAnswers(row.answers), ...incoming };
  const stepIndex = Math.max(0, Math.min(40, Number(body.stepIndex) || 0));

  const { data, error } = await supabase
    .from("hiring_application_sessions")
    .update({
      answers: merged,
      step_index: stepIndex,
      expires_at: sessionExpiry(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select(
      "id, token, email, full_name, phone, source, job_title, answers, step_index, status, expires_at, submitted_at",
    )
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not save your progress." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: true, session: toPublicSession(data) });
}
