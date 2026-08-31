// ─── POST /api/partner-admin/send-calendar-link ───────────────────────────────
//
// Admin/VA-gated: text + email a host the link to their weekly cleaning
// scheduler so they can slot their turnovers for the week. Uses the live
// send-ghl-sms (SMS) and admin-send-email (email) edge functions.
//
// Body: { email, name?, phone? }. Phone is resolved from the Supabase hosts row
// when not provided.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORTAL_BASE = (
  process.env.NEXT_PUBLIC_PARTNER_PORTAL_URL || "https://app.novaracleaning.com"
).replace(/\/+$/, "");

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: { email?: string; name?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  // Resolve phone + name + the open-scheduler token from the Supabase host.
  let phone = (body.phone || "").trim();
  let name = (body.name || "").trim();
  let calendarToken = "";
  try {
    const supabase = getAdminSupabase();
    const { data: host } = await supabase
      .from("hosts")
      .select("name, phone, calendar_token")
      .eq("email", email)
      .maybeSingle();
    if (host) {
      if (!phone && host.phone) phone = String(host.phone);
      if (!name && host.name) name = String(host.name);
      if (host.calendar_token) calendarToken = String(host.calendar_token);
    }
  } catch {
    /* best-effort */
  }

  const firstName = (name || "there").split(" ")[0];
  const scheduleUrl = calendarToken
    ? `${PORTAL_BASE}/partner/schedule/${calendarToken}`
    : `${PORTAL_BASE}/partner/schedule`;

  const supabase = getAdminSupabase();
  const sent = await sendPartnershipMessage(supabase, {
    templateKey: "host_calendar_link",
    trigger: "partner-admin.calendar_link",
    email,
    phone: phone || null,
    vars: { first_name: firstName, link: scheduleUrl },
  });

  if (!sent.emailed && !sent.texted) {
    const err = sent.results.find((r) => r.error)?.error || "Could not send.";
    return NextResponse.json({ error: err }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    smsSent: sent.texted,
    emailSent: sent.emailed,
    scheduleUrl,
    warnings: [
      sent.texted ? null : "SMS: not sent",
      sent.emailed ? null : "Email: not sent",
    ].filter(Boolean),
  });
}
