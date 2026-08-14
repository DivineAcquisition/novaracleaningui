// ─── send-photo-cadence ─────────────────────────────────────────────────────
//
// Time-based before/after photo prompts for the assigned contractor. Runs every
// ~5 minutes and, for each of today's active bookings with a cleaner:
//
//   • BEFORE-photos link  →  ~10 minutes before the scheduled arrival/start.
//   • AFTER-photos link   →  ~10 minutes before the expected completion
//                            (actual check-in time when known, otherwise the
//                            scheduled start, plus the estimated duration).
//
// Operator directive (2026-07): cleaners were only getting the before link when
// they happened to check in and the after link when they marked complete — if
// they skipped those in-app steps, no link ever arrived. This sweep pushes each
// link proactively on a clock so it lands ~10 minutes ahead of the moment it's
// needed, regardless of whether the cleaner touches the app.
//
// Idempotent via bookings.before_photo_link_sent_at / after_photo_link_sent_at
// (atomic NULL→now claim), so it never double-texts and it composes with
// job-check-in / cleaner-mark-complete (whichever fires first wins).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONTRACTOR = "https://contractor.novaracleaning.com";

// Best-effort SMS: GoHighLevel primary (send-ghl-sms), Telnyx fallback
// (send-sms-notification). Mirrors _shared/sms.ts but kept inline so this
// cron function has no cross-file dependency to bundle. Never throws.
// deno-lint-ignore no-explicit-any
async function sendSms(supabase: any, toPhone: string | null | undefined, message: string): Promise<boolean> {
  const phone = (toPhone || "").toString().trim();
  if (!phone || !message.trim()) return false;
  try {
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: { phone, message, type: "reminder" },
    });
    const ghlError = error || (data && (data as { error?: string }).error);
    if (!ghlError) return true;
  } catch (_e) { /* fall through to Telnyx */ }
  try {
    const { error } = await supabase.functions.invoke("send-sms-notification", {
      body: { toPhone: phone, message, type: "reminder" },
    });
    return !error;
  } catch (_e) {
    return false;
  }
}

// Parse a stored arrival-window / time-slot into a 24h "HH:MM:SS" start clock.
// Handles the canonical ids ("8-12"), named windows, and freeform ranges.
// Inlined from _shared/sms.ts (start only — that's all this sweep needs).
function parseSlotStartClock(slot?: string | null): string | null {
  if (!slot) return null;
  const raw = String(slot).trim();
  const canonical: Record<string, string> = { "8-12": "08:00:00", "12-16": "12:00:00", "16-20": "16:00:00" };
  if (canonical[raw]) return canonical[raw];
  const named: Record<string, string> = {
    morning: "08:00:00", midday: "12:00:00", afternoon: "12:00:00", evening: "16:00:00",
  };
  if (named[raw.toLowerCase()]) return named[raw.toLowerCase()];
  const m = raw.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  if (Number.isNaN(hour)) return null;
  const mer = m[3]?.toUpperCase();
  if (mer === "PM" && hour < 12) hour += 12;
  if (mer === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}:00`;
}

// Fire a link at most this many minutes BEFORE the target moment, and keep
// firing (as a catch-up) up to this many minutes AFTER it. With a 5-minute cron
// the first tick to enter [target-10, ...] sends, so links land ~5-10 min out.
const LEAD_MIN = 10;
const BEFORE_GRACE_MIN = 30; // still send the before link if we're a bit late
const AFTER_GRACE_MIN = 90; // completion is an estimate — allow a wide catch-up
const DEFAULT_DURATION_HOURS = 2;

const ELIGIBLE_STATUSES = ["confirmed", "assigned", "in_progress", "pending_review"];

const logStep = (step: string, details?: Record<string, unknown>) => {
  const suffix = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-PHOTO-CADENCE] ${step}${suffix}`);
};

// Wall-clock minutes-since-midnight + YYYY-MM-DD in Novara's tz (ET).
function nowInEastern(): { ymd: string; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minutes = hour * 60 + parseInt(get("minute"), 10);
  return { ymd, minutes };
}

// Minutes-since-ET-midnight + ET ymd for an absolute timestamp (e.g. check-in).
function easternMinutesOf(iso: string | null): { ymd: string; minutes: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + parseInt(get("minute"), 10),
  };
}

function clockToMinutes(clock: string | null): number | null {
  if (!clock) return null;
  const m = clock.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

async function ensureToken(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  bookingId: string,
  existing: string | null,
): Promise<string> {
  if (existing) return existing;
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  await supabase.from("bookings").update({ photo_upload_token: token }).eq("id", bookingId);
  return token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const force = body?.force === true; // ignore the time band (manual run)
    const et = nowInEastern();
    const targetDate = typeof body?.serviceDate === "string" && body.serviceDate
      ? String(body.serviceDate)
      : et.ymd;

    logStep("Sweeping photo cadence", { targetDate, etMinutes: et.minutes, force });

    const { data: bookings, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, first_name, last_name, service_date, time_slot, arrival_window, status, cleaner_id, estimated_duration_hours, photo_upload_token, before_photo_link_sent_at, after_photo_link_sent_at, job_id",
      )
      .in("status", ELIGIBLE_STATUSES)
      .eq("service_date", targetDate)
      .not("cleaner_id", "is", null)
      .or("before_photo_link_sent_at.is.null,after_photo_link_sent_at.is.null")
      .limit(400);

    if (error) throw error;

    const results = { attempted: 0, before_sent: 0, after_sent: 0, skipped_window: 0, skipped_no_phone: 0, failed: 0 };

    // Pull check-in times (actual start) for accurate completion estimates.
    const jobIds = (bookings || []).map((b: { job_id?: string | null }) => b.job_id).filter(Boolean);
    const checkInByJob = new Map<string, string>();
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, check_in_time")
        .in("id", jobIds);
      for (const j of jobs || []) {
        if (j.check_in_time) checkInByJob.set(j.id, j.check_in_time);
      }
    }

    for (const booking of bookings || []) {
      results.attempted++;

      const slot = booking.time_slot || booking.arrival_window;
      const startMin = clockToMinutes(parseSlotStartClock(slot));
      if (startMin == null) { results.skipped_window++; continue; }

      const durationHours = Number(booking.estimated_duration_hours) > 0
        ? Number(booking.estimated_duration_hours)
        : DEFAULT_DURATION_HOURS;
      const durationMin = Math.round(durationHours * 60);

      // Completion basis: actual check-in (if it happened today) else scheduled.
      const checkIn = booking.job_id ? checkInByJob.get(booking.job_id) || null : null;
      const checkInEt = easternMinutesOf(checkIn);
      const actualStartMin = checkInEt && checkInEt.ymd === et.ymd ? checkInEt.minutes : startMin;
      const completionMin = actualStartMin + durationMin;

      const cleanerName = booking.first_name?.trim() || "your customer";

      let cleaner: { first_name?: string | null; phone?: string | null; sms_notifications_enabled?: boolean | null } | null = null;
      const loadCleaner = async () => {
        if (cleaner) return cleaner;
        const { data } = await supabase
          .from("cleaners")
          .select("first_name, phone, sms_notifications_enabled")
          .eq("id", booking.cleaner_id)
          .maybeSingle();
        cleaner = data;
        return cleaner;
      };

      // ── BEFORE-photos link (≈10 min before scheduled start) ──
      const beforeDelta = startMin - et.minutes; // minutes until start
      const beforeDue = force || (beforeDelta <= LEAD_MIN && beforeDelta >= -BEFORE_GRACE_MIN);
      if (!booking.before_photo_link_sent_at && beforeDue) {
        const c = await loadCleaner();
        if (!c?.phone || c.sms_notifications_enabled === false) {
          results.skipped_no_phone++;
        } else {
          // Atomic claim so we send exactly once.
          const { data: claimed } = await supabase
            .from("bookings")
            .update({ before_photo_link_sent_at: new Date().toISOString() })
            .eq("id", booking.id)
            .is("before_photo_link_sent_at", null)
            .select("id");
          if (Array.isArray(claimed) && claimed.length > 0) {
            const token = await ensureToken(supabase, booking.id, booking.photo_upload_token);
            booking.photo_upload_token = token;
            const link = `${CONTRACTOR}/cleaner/job-photos/${token}?phase=before`;
            const msg =
              `Novara: your clean for ${cleanerName} starts soon. ` +
              `Before you begin, upload your BEFORE photos & videos here:\n${link}`;
            const ok = await sendSms(supabase, c.phone, msg);
            if (ok) { results.before_sent++; logStep("BEFORE link sent", { bookingId: booking.id }); }
            else { results.failed++; logStep("BEFORE link SMS failed", { bookingId: booking.id }); }
          }
        }
      } else if (!booking.before_photo_link_sent_at) {
        results.skipped_window++;
      }

      // ── AFTER-photos link (≈10 min before expected completion) ──
      const afterDelta = completionMin - et.minutes; // minutes until completion
      const afterDue = force || (afterDelta <= LEAD_MIN && afterDelta >= -AFTER_GRACE_MIN);
      if (!booking.after_photo_link_sent_at && booking.status !== "completed" && afterDue) {
        const c = await loadCleaner();
        if (!c?.phone || c.sms_notifications_enabled === false) {
          results.skipped_no_phone++;
        } else {
          const { data: claimed } = await supabase
            .from("bookings")
            .update({ after_photo_link_sent_at: new Date().toISOString() })
            .eq("id", booking.id)
            .is("after_photo_link_sent_at", null)
            .select("id");
          if (Array.isArray(claimed) && claimed.length > 0) {
            const token = await ensureToken(supabase, booking.id, booking.photo_upload_token);
            const link = `${CONTRACTOR}/cleaner/job-photos/${token}?phase=after`;
            const msg =
              `Novara: your clean for ${cleanerName} should be wrapping up. ` +
              `Please upload your AFTER photos & videos here so we can finalize and release your payout:\n${link}`;
            const ok = await sendSms(supabase, c.phone, msg);
            if (ok) { results.after_sent++; logStep("AFTER link sent", { bookingId: booking.id }); }
            else { results.failed++; logStep("AFTER link SMS failed", { bookingId: booking.id }); }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, targetDate, results, timestamp: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
