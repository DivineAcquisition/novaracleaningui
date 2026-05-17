// ─── google-calendar-health ──────────────────────────────────────────────
// Diagnostic. Verifies Google Calendar service-account credentials are
// correctly configured and that the calendar is reachable. Also lists
// EVERY calendar the service account currently has access to so we can
// see if the calendar share is missing.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  const claim = { iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
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

  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!calendarId || !email || !privateKey) {
    result.step = "env_vars";
    result.error = "Missing GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY";
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  result.calendar_id = calendarId;
  result.service_account_email = email;

  let token: string;
  try {
    const jwt = await signJwt(email, privateKey, "https://www.googleapis.com/auth/calendar");
    token = await exchangeToken(jwt);
  } catch (e) {
    result.step = "token_exchange";
    result.error = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ALWAYS list calendars the SA can see — invaluable for diagnosing
  // "is the calendar even shared?" without leaving the dashboard.
  try {
    const listRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const listJson = await listRes.json();
    if (listRes.ok) {
      result.calendars_visible_to_service_account = (listJson.items || []).map((c: any) => ({
        id: c.id,
        summary: c.summary,
        access_role: c.accessRole,
      }));
    }
  } catch (_) { /* ignore — diagnostic only */ }

  // Calendar metadata
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
      const reason = calJson.error?.details?.[0]?.reason || calJson.error?.errors?.[0]?.reason || "";
      if (reason === "SERVICE_DISABLED" || /has not been used in project|is disabled/i.test(String(result.error))) {
        const activation = calJson.error?.details?.[0]?.metadata?.activationUrl
          || "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com";
        result.hint = `Google Calendar API is DISABLED in your Cloud project. Click the activation URL → press ENABLE → wait 1–2 min → re-run.`;
        result.fix_url = activation;
      } else if (calRes.status === 404 || calRes.status === 403 || reason === "notFound" || reason === "forbidden") {
        const visibleCount = Array.isArray(result.calendars_visible_to_service_account)
          ? (result.calendars_visible_to_service_account as unknown[]).length
          : 0;
        result.hint = visibleCount === 0
          ? `The service account ${email} can see ZERO calendars right now. You need to share the Novara calendar with it.\n` +
            `1. Open https://calendar.google.com\n` +
            `2. Hover the Novara calendar in the left sidebar → 3 dots → "Settings and sharing"\n` +
            `3. Under "Share with specific people or groups" click "Add people and groups"\n` +
            `4. Paste: ${email}\n` +
            `5. Permission: "Make changes to events" (NOT "See all event details")\n` +
            `6. Click Send. Re-run this health check ~30 sec later.`
          : `The service account CAN see ${visibleCount} other calendar(s) (listed in 'calendars_visible_to_service_account' above), but NOT ${calendarId}. Either the calendar ID is wrong, OR this specific calendar isn't shared with the service account. Either share it the same way, or update GOOGLE_CALENDAR_ID to one from the visible list.`;
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

  // Events list
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
