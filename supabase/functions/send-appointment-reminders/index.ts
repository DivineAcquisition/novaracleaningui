// ─── send-appointment-reminders ─────────────────────────────────────────────
//
// Day-before appointment reminder for confirmed bookings. Sweeps for
// bookings whose service is TOMORROW and texts the customer a friendly
// "your cleaning is coming up" reminder. Idempotent via
// bookings.appointment_reminder_sent_at so the daily cron never double-texts.
//
// SMS goes through the shared sendSms helper (GHL primary, Telnyx fallback).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const suffix = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-APPOINTMENT-REMINDERS] ${step}${suffix}`);
};

// Active booking states that should receive a pre-service reminder.
const ELIGIBLE_STATUSES = ["confirmed", "assigned", "in_progress"];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Allow an explicit target date for manual runs; default to tomorrow.
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const targetDate = typeof body?.serviceDate === "string" && body.serviceDate
      ? String(body.serviceDate)
      : ymd(tomorrow);

    logStep("Sweeping for appointment reminders", { targetDate });

    const { data: bookings, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, phone, first_name, service_type, service_date, time_slot, status, appointment_reminder_sent_at",
      )
      .in("status", ELIGIBLE_STATUSES)
      .eq("service_date", targetDate)
      .is("appointment_reminder_sent_at", null)
      .not("phone", "is", null)
      .limit(200);

    if (fetchError) throw fetchError;

    logStep("Candidates found", { count: bookings?.length ?? 0 });

    const results = { attempted: 0, sent: 0, skipped: 0, failed: 0 };

    for (const booking of bookings || []) {
      results.attempted++;

      if (booking.appointment_reminder_sent_at) {
        results.skipped++;
        continue;
      }

      const greeting = booking.first_name?.trim()
        ? `Hi ${booking.first_name.trim()},`
        : "Hi,";
      const dateLabel = formatServiceDate(booking.service_date) || "your scheduled date";
      const slotLabel = formatTimeSlot(booking.time_slot);
      const when = slotLabel ? `${dateLabel} during ${slotLabel}` : dateLabel;

      const message =
        `${greeting} friendly reminder from Novara Cleaning — your cleaning is ` +
        `scheduled for ${when}. Our 2-person team will arrive within that window. ` +
        `Reply here if anything's changed (gate codes, parking, pets) or to reschedule. See you then!`;

      const sent = await sendSms(supabase, {
        toPhone: booking.phone,
        message,
        type: "reminder",
      });

      if (!sent) {
        results.failed++;
        logStep("SMS failed", { bookingId: booking.id });
        continue;
      }

      const { error: stampError } = await supabase
        .from("bookings")
        .update({ appointment_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
        .is("appointment_reminder_sent_at", null);

      if (stampError) {
        results.failed++;
        logStep("Failed to stamp reminder sent", { bookingId: booking.id, error: stampError.message });
        continue;
      }

      results.sent++;
      logStep("Appointment reminder sent", { bookingId: booking.id, bookingNumber: booking.booking_number });
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
