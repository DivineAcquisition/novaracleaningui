// sync-turnover-calendar
//
// Pushes a partner TURNOVER onto (1) our Google Calendar (service account) and
// (2) GoHighLevel as a calendar APPOINTMENT (not a contact custom field).
// Self-contained (no shared imports) so it can be deployed independently and
// fired by a DB trigger on turnover schedule/reschedule/cancel.
//
// Body: { turnoverId: string, action?: "cancel" }
// Idempotent: reuses turnover_requests.google_calendar_event_id /
// ghl_appointment_id (claim/PUT) so repeated calls never duplicate.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const log = (s: string, d?: unknown) =>
  console.log(`[TURNOVER-CAL] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function resolveSecret(supabase: any, name: string): Promise<string> {
  let value = "";
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch (_) { /* ignore */ }
  if (!value) value = (Deno.env.get(name) || "").trim();
  return value;
}

function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (raw.startsWith("+")) { const d = raw.slice(1).replace(/[^0-9]/g, ""); return d ? `+${d}` : null; }
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return d ? `+${d}` : null;
}

/** "11:00:00" → {h,m}; defaults applied by caller. */
function clock(t: string | null | undefined): { h: number; m: number } | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}
const pad = (n: number) => String(n).padStart(2, "0");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { turnoverId, action } = await req.json();
    if (!turnoverId) return json({ error: "turnoverId required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: tr } = await supabase.from("turnover_requests").select("*").eq("id", turnoverId).maybeSingle();
    if (!tr) return json({ error: "Turnover not found" }, 404);
    const [{ data: property }, { data: host }] = await Promise.all([
      supabase.from("properties").select("*").eq("id", tr.property_id).maybeSingle(),
      supabase.from("hosts").select("*").eq("id", tr.host_id).maybeSingle(),
    ]);

    const isCancel = action === "cancel" || tr.status === "cancelled";
    const date: string = tr.requested_date;
    const start = clock(tr.window_start) || { h: 11, m: 0 };
    const end = clock(tr.window_end) || { h: start.h + 3, m: start.m };
    const propLabel = property?.nickname || property?.address || "Property";
    const title = `STR Turnover — ${propLabel}`;
    const addr = property?.address || "";

    const out: Record<string, unknown> = { turnoverId };

    // ── 1. Google Calendar ──────────────────────────────────────────────────
    try {
      const gcalRes = await syncGoogleCalendar(supabase, tr, { date, start, end, title, addr, isCancel });
      out.googleCalendar = gcalRes;
    } catch (e) {
      out.googleCalendar = { error: e instanceof Error ? e.message : String(e) };
      log("gcal failed", out.googleCalendar);
    }

    // ── 2. GHL appointment ──────────────────────────────────────────────────
    try {
      const ghlRes = await syncGhlAppointment(supabase, tr, host, { date, start, end, title, addr, isCancel });
      out.ghl = ghlRes;
    } catch (e) {
      out.ghl = { error: e instanceof Error ? e.message : String(e) };
      log("ghl failed", out.ghl);
    }

    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─── Google Calendar ────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function syncGoogleCalendar(
  supabase: any,
  tr: Record<string, unknown>,
  ctx: { date: string; start: { h: number; m: number }; end: { h: number; m: number }; title: string; addr: string; isCancel: boolean },
) {
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  const serviceAccountEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!calendarId || !serviceAccountEmail || !privateKey) return { skipped: "no google creds" };

  const existing = tr.google_calendar_event_id as string | null;
  const token = await googleToken(serviceAccountEmail, privateKey);

  if (ctx.isCancel) {
    if (existing && !existing.startsWith("pending:")) {
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await supabase.from("turnover_requests").update({ google_calendar_event_id: null }).eq("id", tr.id);
    }
    return { cancelled: true };
  }

  const startDt = `${ctx.date}T${pad(ctx.start.h)}:${pad(ctx.start.m)}:00`;
  const endDt = `${ctx.date}T${pad(ctx.end.h)}:${pad(ctx.end.m)}:00`;
  const payload = {
    summary: ctx.title,
    description: `STR turnover for ${ctx.title}.`,
    location: ctx.addr,
    start: { dateTime: startDt, timeZone: "America/New_York" },
    end: { dateTime: endDt, timeZone: "America/New_York" },
    colorId: "5",
  };

  // Update if we already have a real event id.
  if (existing && !existing.startsWith("pending:")) {
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { updated: existing };
    // fall through to create if the event vanished
  }

  // Claim to avoid duplicate creates across concurrent callers.
  const sentinel = `pending:${new Date().toISOString()}`;
  const { data: claimed } = await supabase
    .from("turnover_requests")
    .update({ google_calendar_event_id: sentinel })
    .eq("id", tr.id)
    .is("google_calendar_event_id", null)
    .select("id");
  if ((!claimed || claimed.length === 0) && !existing?.startsWith("pending:")) {
    return { claimedByOther: true };
  }

  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    await supabase.from("turnover_requests").update({ google_calendar_event_id: null }).eq("id", tr.id).eq("google_calendar_event_id", sentinel);
    throw new Error(`gcal create ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const ev = await r.json();
  await supabase.from("turnover_requests").update({ google_calendar_event_id: ev.id }).eq("id", tr.id);
  return { created: ev.id };
}

async function googleToken(serviceAccountEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    iss: serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const keyData = privateKey.replace(/\\n/g, "\n");
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pem = keyData.substring(keyData.indexOf(pemHeader) + pemHeader.length, keyData.indexOf(pemFooter)).trim();
  const bin = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bin, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const jwt = `${header}.${payload}.${sigB64}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  return (await res.json()).access_token;
}

// ─── GHL appointment ──────────────────────────────────────────────────────────

async function ghlFetch(path: string, init: RequestInit, token: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return fetch(`${GHL_BASE}${path}`, { ...init, headers });
}

// deno-lint-ignore no-explicit-any
async function syncGhlAppointment(
  supabase: any,
  tr: Record<string, unknown>,
  host: Record<string, unknown> | null,
  ctx: { date: string; start: { h: number; m: number }; end: { h: number; m: number }; title: string; addr: string; isCancel: boolean },
) {
  const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
  const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
  if (!token || !locationId) return { skipped: "no ghl creds" };
  const calendarId = await resolveSecret(supabase, "GHL_CLEANING_CALENDAR_ID");
  if (!calendarId) return { skipped: "no GHL_CLEANING_CALENDAR_ID" };

  const offset = (Deno.env.get("DEFAULT_TZ_OFFSET") || "-05:00").trim();
  const startIso = `${ctx.date}T${pad(ctx.start.h)}:${pad(ctx.start.m)}:00${offset}`;
  const endIso = `${ctx.date}T${pad(ctx.end.h)}:${pad(ctx.end.m)}:00${offset}`;

  // Ensure a GHL contact exists for the host.
  let contactId = (host?.ghl_contact_id as string) || null;
  if (!contactId) {
    const nameParts = String(host?.name || "").trim().split(" ");
    const r = await ghlFetch("/contacts/upsert", {
      method: "POST",
      body: JSON.stringify({
        locationId,
        email: host?.email || undefined,
        phone: toE164(host?.phone as string) || undefined,
        firstName: nameParts[0] || undefined,
        lastName: nameParts.slice(1).join(" ") || undefined,
        source: "Novara STR Turnover",
      }),
    }, token);
    if (r.ok) {
      const j = await r.json();
      contactId = j?.contact?.id || j?.id || null;
      if (contactId && host?.id) await supabase.from("hosts").update({ ghl_contact_id: contactId }).eq("id", host.id);
    }
  }
  if (!contactId) return { error: "no contact id" };

  const existingAppt = (tr.ghl_appointment_id as string) || null;
  const apptBody: Record<string, unknown> = {
    title: ctx.title,
    meetingLocationType: "address",
    address: ctx.addr || undefined,
    appointmentStatus: ctx.isCancel ? "cancelled" : "confirmed",
    startTime: startIso,
    endTime: endIso,
    ignoreDateRange: true,
    toNotify: false,
  };

  if (existingAppt) {
    const r = await ghlFetch(`/calendars/events/appointments/${encodeURIComponent(existingAppt)}`, {
      method: "PUT",
      body: JSON.stringify(apptBody),
    }, token);
    if (r.ok) return { updated: existingAppt, status: apptBody.appointmentStatus };
    log("appt update failed; recreating", { status: r.status });
  }
  if (ctx.isCancel) return { cancelled: true };

  const r = await ghlFetch("/calendars/events/appointments", {
    method: "POST",
    body: JSON.stringify({ ...apptBody, calendarId, locationId, contactId }),
  }, token);
  const t = await r.text();
  if (!r.ok) throw new Error(`ghl appt create ${r.status}: ${t.slice(0, 200)}`);
  const j = JSON.parse(t);
  const apptId = j?.id || j?.appointment?.id || null;
  if (apptId) {
    await supabase.from("turnover_requests").update({
      ghl_appointment_id: apptId,
      ghl_appointment_calendar_id: calendarId,
    }).eq("id", tr.id);
  }
  return { created: apptId };
}
