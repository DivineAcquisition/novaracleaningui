// ─── send-day-of-reminders ──────────────────────────────────────────────────
//
// "Day-of, ~30 minutes before arrival" reminder. Runs every 15 minutes and,
// for each confirmed booking happening TODAY, texts both:
//   • the customer  ("your cleaner is arriving in about 30 minutes")
//   • the assigned contractor ("you're due at <customer> in about 30 minutes")
//
// when the current Eastern time is inside the [start-40min, start-5min] window
// relative to the booking's arrival-window start. Idempotent via
// bookings.day_of_reminder_sent_at so the 15-min cron never double-texts.
//
// Pairs with send-appointment-reminders (the day-BEFORE customer reminder).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatTimeSlot, parseTimeSlotToClock } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const suffix = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-DAY-OF-REMINDERS] ${step}${suffix}`);
};

const ELIGIBLE_STATUSES = ["confirmed", "assigned", "in_progress"];

// How many minutes before the window start the reminder may fire. With a
// 15-minute cron cadence this [-40, -5] band gives every booking exactly one
// chance to be texted ~30 minutes out without ever double-sending.
const LEAD_MIN = 40;
const LEAD_MAX = 5;

// Current wall-clock minutes-since-midnight + YYYY-MM-DD in Novara's tz (ET).
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
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const minutes = hour * 60 + parseInt(get("minute"), 10);
  return { ymd, minutes };
}

// Convert a "HH:MM:SS" clock to minutes-since-midnight.
function clockToMinutes(clock: string | null): number | null {
  if (!clock) return null;
  const m = clock.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const force = body?.force === true; // ignore the time-of-day band (manual run)
    const et = nowInEastern();
    const targetDate = typeof body?.serviceDate === "string" && body.serviceDate
      ? String(body.serviceDate)
      : et.ymd;

    logStep("Sweeping for day-of reminders", { targetDate, etMinutes: et.minutes, force });

    const { data: bookings, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, phone, first_name, last_name, address, city, service_type, service_date, time_slot, arrival_window, status, cleaner_id, day_of_reminder_sent_at",
      )
      .in("status", ELIGIBLE_STATUSES)
      .eq("service_date", targetDate)
      .is("day_of_reminder_sent_at", null)
      .limit(300);

    if (fetchError) throw fetchError;

    const results = { attempted: 0, sent: 0, skipped_window: 0, skipped_no_phone: 0, failed: 0 };

    for (const booking of bookings || []) {
      results.attempted++;

      const slot = booking.time_slot || booking.arrival_window;
      const startMin = clockToMinutes(parseTimeSlotToClock(slot).start);

      // Without a parseable start time we can't know "30 min before". Skip
      // rather than guess (these still get the day-before reminder).
      if (startMin == null) { results.skipped_window++; continue; }

      const delta = startMin - et.minutes; // minutes until window start
      if (!force && (delta > LEAD_MIN || delta < -LEAD_MAX)) { results.skipped_window++; continue; }

      const whenLabel = formatTimeSlot(slot) || slot || "soon";
      const customerName = `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "your customer";

      // ── Customer text ──
      let anySent = false;
      if (booking.phone) {
        const greeting = booking.first_name?.trim() ? `Hi ${booking.first_name.trim()},` : "Hi,";
        const msg =
          `${greeting} quick reminder from Novara Cleaning — your cleaning team is on the way and ` +
          `should arrive within your ${whenLabel} window (about 30 minutes). ` +
          `Reply here if you need anything before they arrive. See you soon!`;
        const ok = await sendSms(supabase, { toPhone: booking.phone, message: msg, type: "reminder" });
        anySent = anySent || ok;
        if (!ok) logStep("Customer SMS failed", { bookingId: booking.id });
      } else {
        results.skipped_no_phone++;
      }

      // ── Contractor text ──
      if (booking.cleaner_id) {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("first_name, phone")
          .eq("id", booking.cleaner_id)
          .maybeSingle();
        if (cleaner?.phone) {
          const msg =
            `Novara reminder: your clean for ${customerName} starts in about 30 minutes ` +
            `(${whenLabel}). ${booking.address || ""}${booking.city ? `, ${booking.city}` : ""}. ` +
            `Please head over and check in on arrival.`;
          const ok = await sendSms(supabase, { toPhone: cleaner.phone, message: msg.slice(0, 480), type: "reminder" });
          anySent = anySent || ok;
          if (!ok) logStep("Cleaner SMS failed", { bookingId: booking.id });
        }
      }

      if (!anySent) { results.failed++; continue; }

      const { error: stampError } = await supabase
        .from("bookings")
        .update({ day_of_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
        .is("day_of_reminder_sent_at", null);

      if (stampError) {
        results.failed++;
        logStep("Failed to stamp day-of reminder", { bookingId: booking.id, error: stampError.message });
        continue;
      }

      results.sent++;
      logStep("Day-of reminder sent", { bookingId: booking.id, bookingNumber: booking.booking_number });
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
