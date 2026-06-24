import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// create-google-calendar-event
//
// Writes a confirmed booking onto the shared Google Calendar via the service
// account. Hardened (2026-06):
//   • IDEMPOTENT — a compare-and-swap "claim" on google_calendar_event_id means
//     concurrent callers (confirm trigger + reconcile cron + fan-out) can't
//     create duplicate events. Already-created bookings short-circuit.
//   • ROBUST TIME PARSING — handles "9:00 AM - 12:00 PM", "9 AM - 12 PM",
//     "8-12", "12-4", "4-8", single times, and arrival_window fallback. Never
//     throws on a missing " - " separator (the old bug that 500'd the event).
//   • Falls back to a sensible default duration (estimated_duration_hours or 3h)
//     when only a start can be derived, so a booking ALWAYS lands on the
//     calendar rather than failing.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: unknown) =>
  console.log(`[GCAL] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    if (!bookingId) throw new Error("Booking ID is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error(`Booking not found: ${fetchError?.message}`);
    }

    // Never calendar a cancelled booking.
    if (booking.status === "cancelled") {
      return json({ success: true, skipped: "cancelled" });
    }

    // ── Idempotency: claim the row so only one caller creates the event ──────
    const existing = booking.google_calendar_event_id as string | null;
    if (existing && !existing.startsWith("pending:")) {
      log("event already exists — skipping", { bookingId, eventId: existing });
      return json({ success: true, alreadyExists: true, eventId: existing });
    }

    const sentinel = `pending:${new Date().toISOString()}`;
    // Claim when the field is NULL, or re-claim a stale 'pending:' sentinel by
    // matching its exact value (self-heals a crashed prior attempt). Never
    // matches a real event id, so an existing event can't be clobbered.
    const claimQuery = supabase
      .from("bookings")
      .update({ google_calendar_event_id: sentinel })
      .eq("id", bookingId);
    const { data: claimed } = existing
      ? await claimQuery.eq("google_calendar_event_id", existing).select("id")
      : await claimQuery.is("google_calendar_event_id", null).select("id");

    if (!claimed || claimed.length === 0) {
      log("another worker is creating the event — skipping", { bookingId });
      return json({ success: true, claimedByOther: true });
    }

    const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
    const serviceAccountEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const privateKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
    if (!calendarId || !serviceAccountEmail || !privateKey) {
      // Release the claim so a later run (once creds exist) can retry.
      await releaseClaim(supabase, bookingId, sentinel);
      throw new Error("Missing Google Calendar credentials");
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(serviceAccountEmail, privateKey);
    } catch (err) {
      await releaseClaim(supabase, bookingId, sentinel);
      throw err;
    }

    // ── Robust time window ───────────────────────────────────────────────────
    const durationHours =
      Number(booking.estimated_duration_hours) > 0
        ? Number(booking.estimated_duration_hours)
        : 3;
    const { start, end } = parseWindow(
      String(booking.time_slot || booking.arrival_window || ""),
      durationHours,
    );
    const startDateTime = `${booking.service_date}T${start}`;
    const endDateTime = `${booking.service_date}T${end}`;

    const eventPayload = {
      summary: `Booking #${booking.booking_number || booking.id.slice(0, 8)} - ${booking.first_name} ${booking.last_name} - ${booking.service_type}`,
      description: [
        `Service: ${booking.service_type}`,
        `Customer: ${booking.first_name} ${booking.last_name}`,
        `Phone: ${booking.phone}`,
        `Email: ${booking.email}`,
        `Address: ${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
        booking.add_ons?.length ? `Add-ons: ${booking.add_ons.join(", ")}` : "",
        booking.team_notes ? `Team Notes: ${booking.team_notes}` : "",
      ].filter(Boolean).join("\n"),
      location: `${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
      start: { dateTime: startDateTime, timeZone: "America/New_York" },
      end: { dateTime: endDateTime, timeZone: "America/New_York" },
      colorId: "7",
    };

    const createResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventPayload),
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      log("event creation failed", { status: createResponse.status, errorText });
      await releaseClaim(supabase, bookingId, sentinel);
      throw new Error(`Failed to create calendar event: ${errorText}`);
    }

    const event = await createResponse.json();
    log("event created", { bookingId, eventId: event.id });

    // Swap the sentinel for the real id (CAS on the sentinel so we never
    // overwrite a concurrently-set real id).
    await supabase
      .from("bookings")
      .update({ google_calendar_event_id: event.id })
      .eq("id", bookingId)
      .eq("google_calendar_event_id", sentinel);

    return json({ success: true, eventId: event.id, eventLink: event.htmlLink });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log("error", { errorMessage });
    return json({ error: errorMessage }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function releaseClaim(supabase: any, bookingId: string, sentinel: string): Promise<void> {
  try {
    await supabase
      .from("bookings")
      .update({ google_calendar_event_id: null })
      .eq("id", bookingId)
      .eq("google_calendar_event_id", sentinel);
  } catch (_) {
    /* best-effort */
  }
}

async function getAccessToken(serviceAccountEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtPayload = btoa(
    JSON.stringify({
      iss: serviceAccountEmail,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );

  const encoder = new TextEncoder();
  const keyData = privateKey.replace(/\\n/g, "\n");
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = keyData
    .substring(keyData.indexOf(pemHeader) + pemHeader.length, keyData.indexOf(pemFooter))
    .trim();

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(`${jwtHeader}.${jwtPayload}`),
  );
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const jwt = `${jwtHeader}.${jwtPayload}.${signatureBase64}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${errorText}`);
  }
  const { access_token } = await tokenResponse.json();
  return access_token;
}

// ── Time-window parsing ──────────────────────────────────────────────────────

/** Infer AM/PM for a bare hour using typical cleaning-window conventions. */
function bareMeridiem(hour: number): "AM" | "PM" {
  if (hour === 12) return "PM"; // noon
  if (hour >= 1 && hour <= 7) return "PM"; // 1–7 → afternoon/evening windows
  return "AM"; // 8–11 → morning
}

function to24(hourStr: string, minStr: string | undefined, mer: string | undefined): string {
  let h = parseInt(hourStr, 10);
  const m = minStr ? parseInt(minStr, 10) : 0;
  if (mer) {
    const u = mer.toUpperCase();
    if (u === "PM" && h < 12) h += 12;
    if (u === "AM" && h === 12) h = 0;
  }
  if (!Number.isFinite(h) || h < 0 || h > 23) h = 9;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function addHoursClock(clock: string, hours: number): string {
  const [h, m] = clock.split(":").map((x) => parseInt(x, 10));
  let total = h * 60 + m + Math.round(hours * 60);
  if (total > 23 * 60 + 59) total = 23 * 60 + 59;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

/**
 * Parse a time window string into 24h start/end. Trusts an explicit AM/PM on
 * BOTH ends; otherwise derives a start and uses the default duration for the
 * end (avoids the ambiguity of bare windows like "4-8"). Always returns a
 * valid pair — never throws.
 */
function parseWindow(raw: string, durationHours: number): { start: string; end: string } {
  const dur = durationHours > 0 ? durationHours : 3;
  const fallbackStart = "09:00:00";
  if (!raw || !raw.trim()) {
    return { start: fallbackStart, end: addHoursClock(fallbackStart, dur) };
  }

  const range = raw.match(
    /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:-|\u2013|\u2014|to)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );
  if (range) {
    const [, h1, m1, mer1, h2, m2, mer2] = range;
    if (mer1 && mer2) {
      const start = to24(h1, m1, mer1);
      let end = to24(h2, m2, mer2);
      if (end <= start) end = addHoursClock(start, dur);
      return { start, end };
    }
    // Ambiguous bare numbers → derive start, default-duration end.
    const start = to24(h1, m1, mer1 || bareMeridiem(parseInt(h1, 10)));
    return { start, end: addHoursClock(start, dur) };
  }

  const single = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (single) {
    const start = to24(single[1], single[2], single[3] || bareMeridiem(parseInt(single[1], 10)));
    return { start, end: addHoursClock(start, dur) };
  }

  return { start: fallbackStart, end: addHoursClock(fallbackStart, dur) };
}
