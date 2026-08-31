// ─── /api/partner-admin/host-onboarding ────────────────────────────────────
//
// Admin: send the tokenized host session, list stalled sessions, toggle
// Pay After (Company discretion).

import { NextResponse } from "next/server";

import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  hostOnboardingAttention,
  sendHostOnboardingLink,
  startHostOnboardingSession,
} from "@/lib/host-onboarding/admin";
import { onboardingUrl } from "@/lib/host-onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }
  const supabase = getAdminSupabase();
  const attention = await hostOnboardingAttention(supabase);
  return NextResponse.json({ ok: true, attention });
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const supabase = getAdminSupabase();

  if (action === "send" || action === "send_host_onboarding") {
    const hostId = String(body.hostId || "");
    if (!hostId) return NextResponse.json({ error: "hostId is required." }, { status: 400 });
    const result = await startHostOnboardingSession(supabase, {
      hostId,
      actorName: principal.email,
      send: true,
    });
    return NextResponse.json(result, { status: result.status });
  }

  if (action === "nudge") {
    const sessionId = String(body.sessionId || "");
    if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    const { data: session } = await supabase
      .from("host_onboarding_sessions")
      .select("id, token, recipient_name, recipient_email, recipient_phone, host_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session?.token) return NextResponse.json({ error: "No live link on that session." }, { status: 404 });
    const { data: host } = await supabase.from("hosts").select("name").eq("id", session.host_id).maybeSingle();
    const sent = await sendHostOnboardingLink(supabase, {
      sessionId: session.id,
      hostName: String(host?.name || session.recipient_name || "there"),
      recipientName: session.recipient_name,
      recipientEmail: session.recipient_email,
      recipientPhone: session.recipient_phone,
      link: onboardingUrl(session.token),
      reminder: true,
    });
    return NextResponse.json({ ok: true, ...sent });
  }

  if (action === "set_pay_after") {
    const hostId = String(body.hostId || "");
    if (!hostId) return NextResponse.json({ error: "hostId is required." }, { status: 400 });
    const enabled = !!body.enabled;
    const { error } = await supabase
      .from("hosts")
      .update({ pay_after_enabled: enabled })
      .eq("id", hostId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await supabase.from("events").insert({
      event_type: "host.pay_after_toggled",
      source: "partner-admin",
      summary: `${principal.email} ${enabled ? "enabled" : "disabled"} Pay After for host ${hostId}.`,
      data: { host_id: hostId, enabled },
    });
    return NextResponse.json({ ok: true, pay_after_enabled: enabled });
  }

  return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
}
