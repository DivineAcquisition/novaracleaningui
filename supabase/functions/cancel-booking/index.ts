import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import {
  decideCancelFee,
  SUPPORT_PHONE_DISPLAY,
} from "../_shared/booking-policy.ts";
import { syncBookingLifecycle } from "../_shared/ghl-client.ts";
import { mirrorToLeadConnector } from "../_shared/leadconnector-mirror.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  console.log(`[CANCEL-BOOKING] ${step}`, details ? JSON.stringify(details) : "");
};

interface CancelRequest {
  bookingId: string;
  cancelReason: string;
  /**
   * Refund intent:
   *   • undefined / 'auto'  → server decides (default; uses 24-hr rule)
   *   • 'full'              → force full refund
   *   • 'partial'           → force partial (legacy 50% behaviour)
   *   • 'none'              → no refund (used for credit-only bookings)
   */
  refundType?: "auto" | "full" | "partial" | "none";
  /** Origin tag — "customer_portal" | "sms_reply" | "admin" | "phone". */
  source?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeKey, {
    // deno-lint-ignore no-explicit-any
    apiVersion: "2025-08-27.basil" as any,
  });

  try {
    const { bookingId, cancelReason, refundType = "auto", source = "customer_portal" }: CancelRequest = await req.json();
    logStep("Processing cancellation", { bookingId, cancelReason, refundType, source });

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error(`Booking not found: ${bookingError?.message}`);
    }
    if (booking.status === "completed") {
      throw new Error("Cannot cancel completed bookings");
    }
    if (booking.status === "cancelled") {
      throw new Error("Booking is already cancelled");
    }

    // ─── Fee calculation (server is the source of truth) ────────────
    const feeDecision = decideCancelFee({
      serviceDate: booking.service_date,
      usesCredit: booking.uses_credit,
    });
    logStep("Fee decided", feeDecision);

    // ─── Stripe refund ──────────────────────────────────────────────
    let refundCents = 0;
    let refundId: string | null = null;
    if (
      booking.payment_intent_id &&
      refundType !== "none" &&
      !booking.uses_credit
    ) {
      try {
        const pi = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
        if (pi.status === "succeeded") {
          const paidCents = booking.final_charge_cents || booking.deposit_cents || 0;
          if (paidCents > 0) {
            let intendedRefund = paidCents - feeDecision.feeCents;
            if (refundType === "full") intendedRefund = paidCents;
            if (refundType === "partial") intendedRefund = Math.floor(paidCents * 0.5);
            refundCents = Math.max(0, intendedRefund);

            if (refundCents > 0) {
              const refund = await stripe.refunds.create({
                payment_intent: booking.payment_intent_id,
                amount: refundCents,
                metadata: {
                  booking_id: bookingId,
                  cancel_reason: cancelReason,
                  fee_basis: feeDecision.basis,
                  source,
                },
              });
              refundId = refund.id;
              logStep("Refund processed", { refundId, refundCents });
            } else {
              logStep("No refund — fee consumed full deposit");
            }
          }
        }
      } catch (stripeErr) {
        logStep("Refund failed (non-critical)", { error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr) });
      }
    }

    // ─── Booking row update ─────────────────────────────────────────
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancel_reason: cancelReason,
        cancelled_at: new Date().toISOString(),
        cancel_fee_cents: feeDecision.feeCents,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId);
    if (updateError) throw updateError;
    logStep("Booking marked cancelled");

    // ─── Membership credit restoration ──────────────────────────────
    // The customer portal promises "credit will be restored" for
    // credit-funded bookings — this previously did nothing. Now we
    // bump credits_remaining back up and decrement credits_used.
    if (booking.uses_credit && booking.email) {
      try {
        const { data: credit } = await supabase
          .from("membership_credits")
          .select("id, credits_remaining, credits_used")
          .eq("email", booking.email)
          .maybeSingle();
        if (credit?.id) {
          await supabase
            .from("membership_credits")
            .update({
              credits_remaining: (credit.credits_remaining || 0) + 1,
              credits_used: Math.max(0, (credit.credits_used || 1) - 1),
              updated_at: new Date().toISOString(),
            })
            .eq("id", credit.id);
          logStep("Membership credit restored");
        }
      } catch (creditErr) {
        logStep("Credit restore failed (non-critical)", { error: creditErr instanceof Error ? creditErr.message : String(creditErr) });
      }
    }

    // ─── Availability release ───────────────────────────────────────
    if (booking.service_date && booking.time_slot) {
      try {
        const { data: slot } = await supabase
          .from("availability")
          .select("capacity")
          .eq("service_date", booking.service_date)
          .eq("time_window", booking.time_slot)
          .maybeSingle();
        if (slot) {
          await supabase
            .from("availability")
            .update({ capacity: (slot.capacity || 0) + 1 })
            .eq("service_date", booking.service_date)
            .eq("time_window", booking.time_slot);
        }
      } catch (availErr) {
        logStep("availability release failed (non-critical)", availErr);
      }
      try {
        const startTime = booking.time_slot.split(" - ")[0] || booking.time_slot;
        await supabase.rpc("release_time_slot", {
          _date: booking.service_date,
          _start_time: startTime,
        });
      } catch (rpcErr) {
        logStep("release_time_slot RPC failed (non-critical)", rpcErr);
      }
    }

    // ─── Cleaner stats ──────────────────────────────────────────────
    if (booking.cleaner_id) {
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("total_bookings")
        .eq("id", booking.cleaner_id)
        .maybeSingle();
      if (cleaner) {
        await supabase
          .from("cleaners")
          .update({ total_bookings: Math.max(0, (cleaner.total_bookings || 1) - 1) })
          .eq("id", booking.cleaner_id);
      }
    }

    // ─── Google Calendar ───────────────────────────────────────────
    if (booking.google_calendar_event_id) {
      try {
        await supabase.functions.invoke("update-google-calendar-event", {
          body: { bookingId, action: "cancel" },
        });
      } catch (calError) {
        logStep("calendar delete failed (non-critical)", calError);
      }
    }

    // ─── GHL Calendar ──────────────────────────────────────────────
    // Mirror the cancellation into the GHL Cleaning Calendar so the
    // contact's GHL appointment block flips to 'cancelled' too.
    if (booking.ghl_appointment_id) {
      try {
        await supabase.functions.invoke("book-ghl-appointment", {
          body: { bookingId, action: "cancel" },
        });
      } catch (ghlApptErr) {
        logStep("GHL appointment cancel failed (non-critical)", ghlApptErr);
      }
    }

    // ─── Email ─────────────────────────────────────────────────────
    try {
      await supabase.functions.invoke("send-booking-email", {
        body: {
          email: booking.email,
          type: "cancellation",
          bookingData: {
            ...booking,
            cancel_reason: cancelReason,
            cancel_fee_cents: feeDecision.feeCents,
            refund_amount: refundCents > 0 ? `$${(refundCents / 100).toFixed(2)}` : "None",
          },
        },
      });
    } catch (emailError) {
      logStep("email failed (non-critical)", emailError);
    }

    // ─── GHL: update the existing opportunity to lost ────────────────
    // ONLY send cancellation-specific custom fields here. The
    // financial / scheduling / lifetime fields are owned by the
    // centralized buildGhlCustomFields path (fired below via
    // send-zapier-webhook). Writing them from here would clobber
    // values that other bookings on the same email might have set
    // (GHL contacts are keyed by email — many bookings, one contact).
    try {
      await syncBookingLifecycle({
        contact: {
          email: booking.email,
          phone: booking.phone,
          firstName: booking.first_name,
          lastName: booking.last_name,
          address1: booking.address,
          city: booking.city,
          state: booking.state,
          postalCode: booking.zip_code,
          source: "Novara Cancellation",
          tags: [
            "cancelled",
            `cancel-${feeDecision.basis}`,
            booking.zip_code ? `zip-${booking.zip_code}` : "",
          ].filter(Boolean) as string[],
          customFieldsByKey: {
            // Cancellation-specific only — these reflect the *event*,
            // not the booking financials.
            cancellation_reason: cancelReason,
            payment_status: refundCents > 0 ? "Refunded" : "Cancelled",
          },
        },
        opportunity: {
          name: `NOV-${String(booking.booking_number).padStart(5, "0")} — ${booking.first_name} ${booking.last_name} (CANCELLED)`,
          status: "lost",
          monetaryValue: Math.round(((booking.final_charge_cents || booking.total_estimate_cents || 0) - refundCents) / 100),
          source: "Novara Cancellation",
          customFieldsByKey: {
            cancellation_reason: cancelReason,
          },
        },
      });
      logStep("GHL lifecycle sync (cancel) ok");
    } catch (ghlErr) {
      logStep("GHL lifecycle sync failed (non-critical)", { error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr) });
    }

    // ─── LeadConnector mirror ──────────────────────────────────────
    try {
      await mirrorToLeadConnector({
        event: "booking.cancelled",
        payload: {
          booking_id: booking.id,
          booking_number: booking.booking_number,
          first_name: booking.first_name,
          last_name: booking.last_name,
          email: booking.email,
          phone: booking.phone,
          cancel_reason: cancelReason,
          cancel_fee_cents: feeDecision.feeCents,
          cancel_fee_basis: feeDecision.basis,
          hours_until_service: feeDecision.hoursUntilService,
          refund_cents: refundCents,
          refund_id: refundId,
          source,
        },
      });
    } catch (mirrorErr) {
      logStep("LeadConnector mirror failed (non-critical)", mirrorErr);
    }

    // ─── Zapier webhook (legacy) ───────────────────────────────────
    try {
      await supabase.functions.invoke("send-zapier-webhook", {
        body: { bookingId },
      });
    } catch (webhookError) {
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    // ─── Customer SMS ──────────────────────────────────────────────
    try {
      if (booking.phone) {
        const refundLine = refundCents > 0
          ? ` A refund of $${(refundCents / 100).toFixed(2)} is on its way.`
          : booking.uses_credit
            ? " Your membership credit has been restored."
            : "";
        const feeLine = feeDecision.feeCents > 0
          ? ` A $${(feeDecision.feeCents / 100).toFixed(0)} short-notice fee was applied.`
          : "";
        await sendSms(supabase, {
          toPhone: booking.phone,
          message:
            `Novara Cleaning: Your cleaning` +
            (booking.service_date ? ` on ${formatServiceDate(booking.service_date)}` : "") +
            (booking.time_slot ? ` (${formatTimeSlot(booking.time_slot)})` : "") +
            ` has been cancelled.${feeLine}${refundLine} Need to rebook? Call ${SUPPORT_PHONE_DISPLAY}. Reply STOP to opt out.`,
          type: "confirmation",
        });
      }
    } catch (smsErr) {
      logStep("customer SMS failed (non-blocking)", { error: smsErr instanceof Error ? smsErr.message : String(smsErr) });
    }

    // ─── Cleaner SMS ───────────────────────────────────────────────
    try {
      if (booking.cleaner_id) {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("phone, first_name")
          .eq("id", booking.cleaner_id)
          .maybeSingle();
        if (cleaner?.phone) {
          await sendSms(supabase, {
            toPhone: cleaner.phone,
            message:
              `Novara Cleaning: A job you were assigned to` +
              (booking.service_date ? ` on ${formatServiceDate(booking.service_date)}` : "") +
              ` has been cancelled by the customer. No action needed.`,
            type: "job_offer",
          });
        }
      }
    } catch (smsErr) {
      logStep("cleaner SMS failed (non-blocking)", { error: smsErr instanceof Error ? smsErr.message : String(smsErr) });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Booking cancelled successfully",
        cancelFeeCents: feeDecision.feeCents,
        feeBasis: feeDecision.basis,
        refundAmount: refundCents > 0 ? `$${(refundCents / 100).toFixed(2)}` : "None",
        refundCents,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
