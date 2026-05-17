// ─── google-calendar-health ──────────────────────────────────────────────
// Single-purpose diagnostic. Verifies the Google Calendar service-
// account credentials are correctly configured and that the calendar
// is reachable. Returns:
//
//   { ok: true,  calendar_id, calendar_summary, upcoming_events_count }
//   { ok: false, step, error }
//
// Steps tested in order — if any fails we return the first failure:
//   1. Env vars present
//   2. JWT mints + token exchange returns a Bearer token
//   3. GET /calendars/{id} returns 200 (proves the SA was granted
//      access to the target calendar)
//   4. GET /calendars/{id}/events?timeMin=now&maxResults=5 returns 200
//
// Surface this from an admin "Google Calendar status" panel — green
// dot if {ok:true}, red with the step+error otherwise.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PEM → ArrayBuffer. Handles both real-newline and escaped-newline
// stored secrets, and both common header strings.
function pemToArrayBuffer(rawPem: string): ArrayBuffer {
  const pem = rawPem.replace(/\\n/g, "\n");
  const headerCandidates = ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----"];
  const footerCandidates = ["-----END PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----"];
  let header = "";
  let footer = "";
  for (let i = 0; i < headerCandidates.length; i++) {
    if (pem.includes(headerCandidates[i]) && pem.includes(footerCandidates[i])) {
      header = headerCandidates[i];
      footer = footerCandidates[i];
      break;
    }
  }
  if (!header) throw new Error("PEM markers not found — expected BEGIN/END PRIVATE KEY block");
  const start = pem.indexOf(header) + header.length;
  const end = pem.indexOf(footer);
  const body = pem.substring(start, end).replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(email: string, privateKeyPem: string, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

async function exchangeToken(jwt: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${json.error_description || json.error || res.status}`);
  return json.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const result: Record<string, unknown> = { ok: false };

  // 1) env vars
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!calendarId || !email || !privateKey) {
    result.step = "env_vars";
    result.error = "Missing one or more of GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY";
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  result.calendar_id = calendarId;
  result.service_account_email = email;

  // 2) JWT → token
  let token: string;
  try {
    const jwt = await signJwt(email, privateKey, "https://www.googleapis.com/auth/calendar");
    token = await exchangeToken(jwt);
  } catch (e) {
    result.step = "token_exchange";
    result.error = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 3) GET /calendars/{id}
  try {
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const calJson = await calRes.json();
    if (!calRes.ok) {
      result.step = "calendar_metadata";
      result.http_status = calRes.status;
      result.error = calJson.error?.message || `HTTP ${calRes.status}`;
      // Pull out the most actionable hint based on Google's error reason.
      const reason = calJson.error?.details?.[0]?.reason
        || calJson.error?.errors?.[0]?.reason
        || "";
      if (reason === "SERVICE_DISABLED" || /has not been used in project|is disabled/i.test(String(result.error))) {
        const activation = calJson.error?.details?.[0]?.metadata?.activationUrl
          || "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com";
        result.hint = `Google Calendar API is DISABLED in your Cloud project. Click the activation URL → press ENABLE → wait 1–2 min → re-run this health check.`;
        result.fix_url = activation;
      } else if (calRes.status === 404 || calRes.status === 403 || reason === "notFound" || reason === "forbidden") {
        result.hint = `The service account ${email} probably hasn't been granted access to calendar ${calendarId}. In Google Calendar → Settings → "Settings for my calendars" → ${calendarId} → "Share with specific people or groups" → add ${email} with "Make changes to events" permission.`;
      }
      return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    result.calendar_summary = calJson.summary;
    result.calendar_timezone = calJson.timeZone;
  } catch (e) {
    result.step = "calendar_metadata";
    result.error = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 4) List a few upcoming events
  try {
    const evRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
        `timeMin=${new Date().toISOString()}&maxResults=5&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const evJson = await evRes.json();
    if (!evRes.ok) {
      result.step = "events_list";
      result.http_status = evRes.status;
      result.error = evJson.error?.message || `HTTP ${evRes.status}`;
      return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const events = (evJson.items || []).map((e: any) => ({
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      html_link: e.htmlLink,
    }));
    result.upcoming_events_count = events.length;
    result.upcoming_events = events;
  } catch (e) {
    result.step = "events_list";
    result.error = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  result.ok = true;
  result.checked_at = new Date().toISOString();
  return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
