// finalize-booking
//
// Two things confirm a NovaraCleaning booking:
//   1. Payment cleared (stripe-webhook → payment_intent.succeeded)
//   2. The customer answered the home-detail questionnaire on
//      /book/details (address, city, state, bedrooms, bathrooms,
//      dwelling_type)
//
// Either step can happen first — the customer might complete payment
// and bounce out of the funnel before answering the property questions,
// or in rare cases an admin pre-fills the questionnaire before charging
// the deposit. Whoever reaches the second milestone calls this function
// to actually CONFIRM the booking and fire the downstream actions:
//
//   • Mark `bookings.status = 'confirmed'`
//   • Send confirmation email + payment receipt (Resend)
//   • Send confirmation SMS (Telnyx, via sendSms)
//   • Trigger auto-dispatch
//   • Create the Google Calendar event
//   • Sync to GHL / LeadConnector / Anything
//
// The function is idempotent — it bails out early if the booking is
// already confirmed (or still missing one of the gates). This lets
// stripe-webhook AND PropertyDetails both safely invoke it without
// double-charging the customer or double-sending emails.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import { smsActionTail } from "../_shared/booking-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[FINALIZE-BOOKING] ${step}${tail}`);
};

interface FinalizeRequest {
  bookingId: string;
  /** Optional trigger label for observability (e.g. "stripe_webhook", "property_details_save"). */
  trigger?: string;
}

// Mirror of the gating rules in stripe-webhook + PropertyDetails — if
// any of these are missing on the row, the booking is "details-pending"
// and we cannot finalize.
const REQUIRED_DETAIL_FIELDS: ReadonlyArray<keyof Record<string, unknown>> = [
  "address",
  "city",
  "state",
  "bedrooms",
  "bathrooms",
  "dwelling_type",
];

function hasAllDetails(booking: Record<string, unknown>): boolean {
  return REQUIRED_DETAIL_FIELDS.every((f) => {
    const v = booking[f];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  });
}

function paymentCleared(booking: Record<string, unknown>): boolean {
  // Payment-cleared signal:
  //   • uses_credit  → booking is paid via membership credit (no card charge)
  //   • payment_intent_id present AND row was previously moved out of
  //     pending_payment (stripe-webhook sets payment_received_at when
  //     payment_intent.succeeded fires)
  if (booking.uses_credit === true) return true;
  if (booking.payment_received_at) return true;
  // Defensive fallback for legacy rows that were already confirmed.
  if (booking.status === "confirmed" || booking.status === "completed") return true;
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, trigger = "unknown" }: FinalizeRequest = await req.json();
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Finalize requested", { bookingId, trigger });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchErr || !booking) {
      logStep("Booking not found", { bookingId, error: fetchErr });
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    // Idempotency: already confirmed → nothing to do.
    if (booking.status === "confirmed" || booking.status === "completed") {
      logStep("Booking already confirmed — no-op", {
        bookingId,
        status: booking.status,
      });
      return new Response(
        JSON.stringify({ success: true, status: booking.status, alreadyConfirmed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (booking.status === "cancelled") {
      logStep("Booking cancelled — skip finalize", { bookingId });
      return new Response(
        JSON.stringify({ success: false, status: "cancelled", reason: "cancelled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Gate 1: payment must be cleared.
    if (!paymentCleared(booking)) {
      logStep("Waiting on payment — cannot finalize yet", {
        bookingId,
        status: booking.status,
      });
      return new Response(
        JSON.stringify({
          success: false,
          status: booking.status,
          reason: "payment_pending",
          message: "Payment has not cleared yet. Booking will finalize automatically once Stripe confirms.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Gate 2: home-detail questionnaire must be filled.
    if (!hasAllDetails(booking)) {
      logStep("Home details missing — cannot finalize yet", {
        bookingId,
        status: booking.status,
        missing: REQUIRED_DETAIL_FIELDS.filter((f) => !booking[f]),
      });
      // Make sure the row at least reads as pending_details so the
      // /account dashboard surfaces the "Complete Details" CTA.
      if (booking.status === "pending_payment") {
        await supabase
          .from("bookings")
          .update({ status: "pending_details" })
          .eq("id", bookingId)
          .eq("status", "pending_payment");
      }
      return new Response(
        JSON.stringify({
          success: false,
          status: "pending_details",
          reason: "details_missing",
          message: "Home details are required to finalize the booking.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Both gates passed — promote the booking to confirmed.
    const { error: updateErr } = await supabase
      .from("bookings")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .in("status", ["pending_payment", "pending_details", "booked"]);

    if (updateErr) {
      // If the update_at column doesn't exist (older schema), retry
      // without the confirmed_at column. Status is what matters.
      logStep("Confirm update failed, retrying without confirmed_at", { error: updateErr });
      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", bookingId)
        .in("status", ["pending_payment", "pending_details", "booked"]);
    }

    logStep("Booking promoted to confirmed", { bookingId });

    const confirmedBooking = {
      ...booking,
      status: "confirmed" as const,
    };

    // ─── Confirmation email + receipt (skip if already sent) ─────────
    if (!confirmedBooking.confirmation_email_sent) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({
            type: "confirmation",
            email: confirmedBooking.email,
            data: {
              firstName: confirmedBooking.first_name,
              lastName: confirmedBooking.last_name,
              bookingId: confirmedBooking.id,
              serviceDate: confirmedBooking.service_date,
              timeSlot: confirmedBooking.time_slot,
              serviceType: confirmedBooking.service_type,
              homeSize: confirmedBooking.home_size_id,
              address: confirmedBooking.address,
              city: confirmedBooking.city,
              state: confirmedBooking.state,
              zipCode: confirmedBooking.zip_code,
              totalAmount: confirmedBooking.total_estimate_cents,
              depositAmount: confirmedBooking.deposit_cents,
              balanceAmount:
                confirmedBooking.total_estimate_cents -
                (confirmedBooking.payment_option === "full"
                  ? confirmedBooking.total_estimate_cents -
                    (confirmedBooking.full_payment_discount || 0)
                  : confirmedBooking.deposit_cents),
              paymentOption: confirmedBooking.payment_option,
              useCredit: confirmedBooking.uses_credit,
              addOns: confirmedBooking.add_ons,
            },
          }),
        });

        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({
            type: "payment_receipt",
            email: confirmedBooking.email,
            data: {
              firstName: confirmedBooking.first_name,
              lastName: confirmedBooking.last_name,
              bookingId: confirmedBooking.id,
              serviceDate: confirmedBooking.service_date,
              timeSlot: confirmedBooking.time_slot,
              serviceType: confirmedBooking.service_type,
              totalAmount:
                confirmedBooking.payment_option === "full"
                  ? confirmedBooking.total_estimate_cents -
                    (confirmedBooking.full_payment_discount || 0)
                  : confirmedBooking.deposit_cents,
              balanceAmount:
                confirmedBooking.payment_option === "deposit"
                  ? confirmedBooking.total_estimate_cents - confirmedBooking.deposit_cents
                  : 0,
              paymentOption: confirmedBooking.payment_option,
            },
          }),
        });

        await supabase
          .from("bookings")
          .update({
            confirmation_email_sent: true,
            confirmation_email_sent_at: new Date().toISOString(),
          })
          .eq("id", bookingId);

        logStep("Confirmation + receipt emails sent");
      } catch (emailErr) {
        logStep("Email send failed (non-blocking)", {
          error: emailErr instanceof Error ? emailErr.message : String(emailErr),
        });
      }

      // ─── Customer confirmation SMS (Telnyx) ────────────────────────
      try {
        if (confirmedBooking.phone) {
          const dateLabel = formatServiceDate(confirmedBooking.service_date);
          const timeLabel = formatTimeSlot(confirmedBooking.time_slot);
          const amountDue =
            confirmedBooking.payment_option === "deposit"
              ? Math.max(
                  0,
                  confirmedBooking.total_estimate_cents - (confirmedBooking.deposit_cents || 0),
                )
              : 0;
          const tail =
            amountDue > 0
              ? ` Remaining $${(amountDue / 100).toFixed(2)} is due after service.`
              : " Paid in full — see you soon!";
          const smsMsg =
            `Novara Cleaning: Booking confirmed for ${dateLabel}` +
            (timeLabel ? ` (${timeLabel})` : "") +
            `.${tail} ${smsActionTail()}`;
          await sendSms(supabase, {
            toPhone: confirmedBooking.phone,
            message: smsMsg,
            type: "confirmation",
          });
          logStep("Customer confirmation SMS sent");
        }
      } catch (smsErr) {
        logStep("Customer SMS failed (non-blocking)", {
          error: smsErr instanceof Error ? smsErr.message : String(smsErr),
        });
      }
    } else {
      logStep("Confirmation email already sent — skipping");
    }

    // ─── Auto-dispatch (assigns cleaners) ──────────────────────────────
    try {
      await supabase.functions.invoke("auto-dispatch-booking", {
        body: { bookingId },
      });
      logStep("Auto-dispatch triggered");
    } catch (dispatchErr) {
      logStep("Auto-dispatch failed (non-blocking)", {
        error: dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr),
      });
    }

    // ─── Google Calendar event ─────────────────────────────────────────
    try {
      await supabase.functions.invoke("create-google-calendar-event", {
        body: { bookingId },
      });
      logStep("Google Calendar event creation triggered");
    } catch (calErr) {
      logStep("Calendar create failed (non-blocking)", {
        error: calErr instanceof Error ? calErr.message : String(calErr),
      });
    }

    // ─── GHL / Zapier / Anything sync (re-fire so the contact has the
    //     freshly-saved address + property fields) ─────────────────────
    try {
      await supabase.functions.invoke("send-zapier-webhook", {
        body: { bookingId },
      });
      logStep("send-zapier-webhook triggered");
    } catch (zErr) {
      logStep("send-zapier-webhook failed (non-blocking)", {
        error: zErr instanceof Error ? zErr.message : String(zErr),
      });
    }

    try {
      await supabase.functions.invoke("sync-to-anything", {
        body: { bookingId },
      });
      logStep("sync-to-anything triggered");
    } catch (aErr) {
      logStep("sync-to-anything failed (non-blocking)", {
        error: aErr instanceof Error ? aErr.message : String(aErr),
      });
    }

    // Book the appointment into the GHL Cleaning Calendar so the
    // contact's calendar shows the visit slot. Non-blocking — the
    // booking is already saved + confirmed; if this fails the row
    // carries a ghl_appointment_sync_error and a cron reconciler can
    // retry later.
    try {
      await supabase.functions.invoke("book-ghl-appointment", {
        body: { bookingId },
      });
      logStep("book-ghl-appointment triggered");
    } catch (aErr) {
      logStep("book-ghl-appointment failed (non-blocking)", {
        error: aErr instanceof Error ? aErr.message : String(aErr),
      });
    }

    return new Response(
      JSON.stringify({ success: true, status: "confirmed", bookingId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("Unhandled error", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
