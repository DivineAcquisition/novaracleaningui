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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORTAL_BASE = (
  process.env.NEXT_PUBLIC_PARTNER_PORTAL_URL || "https://app.novaracleaning.com"
).replace(/\/+$/, "");

function edgeConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

async function invokeEdge(fn: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const cfg = edgeConfig();
  if (!cfg) return { ok: false, error: "Server messaging is not configured." };
  try {
    const res = await fetch(`${cfg.url}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: t.slice(0, 200) || `${fn} ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

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
  // Tokenized open scheduler (no login) when we have the host's token; else the
  // authenticated portal scheduler.
  const scheduleUrl = calendarToken
    ? `${PORTAL_BASE}/partner/schedule/${calendarToken}`
    : `${PORTAL_BASE}/partner/schedule`;

  const smsMessage =
    `Hi ${firstName}! Here's your Novara weekly cleaning scheduler — pick the days you need turnovers this week here: ${scheduleUrl}`;
  const emailHtml = `
    <p>Hi ${firstName},</p>
    <p>You can schedule your short-term-rental turnovers for the week right here:</p>
    <p><a href="${scheduleUrl}" style="display:inline-block;background:#5C0FFE;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open my weekly scheduler</a></p>
    <p>Or paste this link into your browser:<br><a href="${scheduleUrl}">${scheduleUrl}</a></p>
    <p>Pick your days and windows, and we'll handle the rest.</p>
    <p>— Novara Cleaning</p>
  `.trim();

  const [smsRes, emailRes] = await Promise.all([
    phone
      ? invokeEdge("send-ghl-sms", { phone, email, message: smsMessage, type: "notification" })
      : Promise.resolve({ ok: false, error: "No phone on file." }),
    invokeEdge("admin-send-email", {
      to: email,
      subject: "Your Novara weekly cleaning scheduler",
      html: emailHtml,
    }),
  ]);

  if (!smsRes.ok && !emailRes.ok) {
    return NextResponse.json(
      { error: `Could not send. SMS: ${smsRes.error}; Email: ${emailRes.error}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    smsSent: smsRes.ok,
    emailSent: emailRes.ok,
    scheduleUrl,
    warnings: [smsRes.ok ? null : `SMS: ${smsRes.error}`, emailRes.ok ? null : `Email: ${emailRes.error}`].filter(
      Boolean,
    ),
  });
}
