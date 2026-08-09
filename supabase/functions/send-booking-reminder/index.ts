import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-BOOKING-REMINDER] ${step}${detailsStr}`);
};

/** Idempotency kinds in booking_emails_sent — one row per booking per reminder. */
const KIND_10M = "pending_checkout_reminder_10m";
const KIND_24H = "pending_checkout_reminder_24h";

/**
 * Public-funnel abandoned-checkout reminders only.
 * Internal / VA bookings stay pending_payment until deposit and already get
 * pending/pay SMS — they must never receive "complete checkout & save $30".
 */
function isPublicCheckoutPending(booking: Record<string, unknown>): boolean {
  const channel = String(booking.booking_channel || "").toLowerCase().trim();
  if (channel === "admin" || channel === "va" || channel === "internal" ||
    channel === "partner") {
    return false;
  }
  const source = String(booking.booker_source || "").toLowerCase().trim();
  if (source.startsWith("va_") || source === "va_admin" || source === "admin") {
    return false;
  }
  // Deposit invoice / pay-page flows are not unfinished public checkouts.
  if (booking.hosted_invoice_url || booking.stripe_invoice_id) return false;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Reminder function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // Find bookings that are pending payment created within last 48 hours.
    // Select channel/source/invoice fields so we can exclude internal deposit holds.
    const { data: pendingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, created_at, first_name, last_name, email, phone, service_date, time_slot, service_type, home_size_id, total_estimate_cents, deposit_cents, payment_option, booking_channel, booker_source, hosted_invoice_url, stripe_invoice_id",
      )
      .eq("status", "pending_payment")
      .gt("created_at", fortyEightHoursAgo.toISOString())
      .order("created_at", { ascending: true })
      .limit(200);

    if (fetchError) {
      logStep("Error fetching pending bookings", fetchError);
      throw fetchError;
    }

    logStep("Found pending bookings", { count: pendingBookings?.length || 0 });

    if (!pendingBookings || pendingBookings.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          reminders_sent: 0,
          message: "No pending bookings",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    let remindersSent = 0;
    let skippedInternal = 0;
    let skippedAlreadySent = 0;
    let skippedOutsideWindow = 0;
    const errors: Array<Record<string, unknown>> = [];

    for (const booking of pendingBookings) {
      if (!isPublicCheckoutPending(booking as Record<string, unknown>)) {
        skippedInternal++;
        continue;
      }

      const createdAt = new Date(booking.created_at);
      const minutesSinceCreated =
        (now.getTime() - createdAt.getTime()) / (1000 * 60);
      const hoursSinceCreated = minutesSinceCreated / 60;

      let reminderType: "10_minute" | "24_hour" | null = null;

      // Cron is */30. Keep each band wide enough for one tick, but send
      // each kind at most once (claimed via booking_emails_sent below).
      // 10-minute nudge: first eligible after ~8 minutes, before 2 hours.
      if (minutesSinceCreated >= 8 && minutesSinceCreated < 120) {
        reminderType = "10_minute";
      }
      // Last-chance: after ~23 hours, still within the 48h cleanup window.
      else if (hoursSinceCreated >= 23 && hoursSinceCreated < 48) {
        reminderType = "24_hour";
      }

      if (!reminderType) {
        skippedOutsideWindow++;
        continue;
      }

      const kind = reminderType === "10_minute" ? KIND_10M : KIND_24H;

      // Atomic claim — unique (booking_id, kind) prevents every-30-min spam.
      const { error: claimError } = await supabase
        .from("booking_emails_sent")
        .insert({
          booking_id: booking.id,
          kind,
          recipient_email: booking.email,
        });

      if (claimError) {
        // Already claimed (or other insert failure) — do not send again.
        skippedAlreadySent++;
        logStep("Skipping — reminder already claimed or claim failed", {
          bookingId: booking.id,
          kind,
          error: claimError.message,
        });
        continue;
      }

      logStep("Sending reminder", { bookingId: booking.id, type: reminderType });

      try {
        const checkoutUrl = "https://try.novaracleaning.com/book/checkout";
        const reminderData = {
          firstName: booking.first_name,
          lastName: booking.last_name,
          bookingId: booking.id,
          serviceDate: booking.service_date,
          timeSlot: booking.time_slot,
          serviceType: booking.service_type,
          homeSize: booking.home_size_id,
          totalAmount: booking.total_estimate_cents,
          depositAmount: booking.deposit_cents,
          paymentOption: booking.payment_option,
          reminderType,
          checkoutUrl,
        };

        const response = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-reminder-email`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({
              email: booking.email,
              data: reminderData,
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Email send failed: ${errorText}`);
        }

        if (booking.phone) {
          const smsMessage = reminderType === "24_hour"
            ? `⚠️ Last chance ${booking.first_name}! Your booking expires soon. Complete now & save $30: ${checkoutUrl}`
            : `Hi ${booking.first_name}, you're almost done! Complete your Novara cleaning booking and save $30. Finish here: ${checkoutUrl}`;

          const smsOk = await sendSms(supabase, {
            toPhone: booking.phone,
            message: smsMessage,
            type: "reminder",
          });
          if (!smsOk) {
            logStep("SMS send failed", { bookingId: booking.id });
          }
        }

        remindersSent++;
        logStep("Reminder sent successfully", {
          bookingId: booking.id,
          email: booking.email,
          type: reminderType,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logStep("Error sending reminder — releasing claim for retry", {
          bookingId: booking.id,
          error: message,
        });
        // Allow a later cron tick to retry this kind.
        await supabase
          .from("booking_emails_sent")
          .delete()
          .eq("booking_id", booking.id)
          .eq("kind", kind);
        errors.push({
          bookingId: booking.id,
          email: booking.email,
          error: message,
        });
      }
    }

    logStep("Reminder processing complete", {
      remindersSent,
      skippedInternal,
      skippedAlreadySent,
      skippedOutsideWindow,
      errors: errors.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
        total_pending: pendingBookings.length,
        skipped_internal: skippedInternal,
        skipped_already_sent: skippedAlreadySent,
        skipped_outside_window: skippedOutsideWindow,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR in reminder function", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
