// ─── google-calendar-provision ───────────────────────────────────────────
// Creates a brand-new Google Calendar owned by the service account, so
// we sidestep Google Workspace external-sharing restrictions that
// block adding a service account to a user-owned calendar.
//
// Body:
//   {
//     "summary": "Novara Bookings",                  // optional
//     "timezone": "America/New_York",                // optional
//     "share_with": ["owner@example.com"]            // optional — emails to grant viewer access on the new cal
//   }
//
// Response on success:
//   {
//     "ok": true,
//     "new_calendar_id": "<id>",                     // <-- paste this as the GOOGLE_CALENDAR_ID secret
//     "new_calendar_summary": "Novara Bookings",
//     "shared_with": [{ "email": "...", "role": "reader" }],
//     "next_steps": ["...", "..."]
//   }
//
// One-shot — run it once, copy the returned new_calendar_id into the
// Supabase secret GOOGLE_CALENDAR_ID, re-check health, done.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pemToArrayBuffer(rawPem: string): ArrayBuffer {
  const pem = rawPem.replace(/\\n/g, "\n");
  const headers = ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----"];
  const footers = ["-----END PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----"];
  let h = "", f = "";
  for (let i = 0; i < headers.length; i++) {
    if (pem.includes(headers[i]) && pem.includes(footers[i])) { h = headers[i]; f = footers[i]; break; }
  }
  if (!h) throw new Error("PEM markers not found");
  const body = pem.substring(pem.indexOf(h) + h.length, pem.indexOf(f)).replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getToken(email: string, pem: string, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${j.error_description || j.error || res.status}`);
  return j.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!email || !privateKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const summary = body.summary || "Novara Bookings";
  const timezone = body.timezone || "America/New_York";
  const shareWith: string[] = Array.isArray(body.share_with) ? body.share_with : [];

  let token: string;
  try {
    token = await getToken(email, privateKey, "https://www.googleapis.com/auth/calendar");
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, step: "token_exchange", error: e instanceof Error ? e.message : String(e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 1) Create the calendar
  const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary, timeZone: timezone, description: "Novara Cleaning — auto-managed by the booking system. Do not edit events here; use the customer/admin portal." }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      step: "create_calendar",
      http_status: createRes.status,
      error: createJson.error?.message || `HTTP ${createRes.status}`,
      response: createJson,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const newCalendarId = createJson.id;

  // 2) (Optional) Share back with the operator's email(s) so they can
  //    see events in their own Google Calendar UI. Use 'reader' so the
  //    operator can't accidentally edit events the bot manages.
  const shared: { email: string; role: string; ok: boolean; error?: string }[] = [];
  for (const recip of shareWith) {
    if (!recip || typeof recip !== "string") continue;
    try {
      const aclRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(newCalendarId)}/acl`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "reader",
            scope: { type: "user", value: recip },
          }),
        },
      );
      const aclJson = await aclRes.json();
      if (aclRes.ok) {
        shared.push({ email: recip, role: "reader", ok: true });
      } else {
        shared.push({ email: recip, role: "reader", ok: false, error: aclJson.error?.message || `HTTP ${aclRes.status}` });
      }
    } catch (e) {
      shared.push({ email: recip, role: "reader", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    new_calendar_id: newCalendarId,
    new_calendar_summary: summary,
    new_calendar_timezone: timezone,
    shared_with: shared,
    next_steps: [
      `1. In Supabase Dashboard → Project Settings → Edge Functions → Secrets, update GOOGLE_CALENDAR_ID to:  ${newCalendarId}`,
      `2. Wait ~5 seconds for the secret to propagate to the running functions.`,
      `3. Re-run the health check: curl https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/google-calendar-health`,
      `4. You should see ok: true with calendar_summary: "${summary}".`,
      shared.length > 0
        ? `5. The new calendar is also shared as READ-only with: ${shared.filter((s) => s.ok).map((s) => s.email).join(", ")}. To see it in your Google Calendar UI: calendar.google.com → left sidebar "Other calendars" → "+" → "Subscribe to calendar" → paste the new calendar id.`
        : `5. Optional — to also see the calendar in your own Google Calendar UI, re-run this function with body { "share_with": ["your-email@..."] }.`,
    ],
  }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
