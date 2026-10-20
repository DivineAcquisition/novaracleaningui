// ─── Customer emails when a booking is confirmed ────────────────────────
//
// A booking confirmation sends the customer two emails of ours, once:
//
//   1. the booking confirmation, and
//   2. their personal cleaning checklist (email + text, one private page).
//
// Receipts and invoices come from Stripe, so we send neither. Everything
// goes through the compliance sender on the Novara Resend account.
//
// Confirmation can be reached from several places at the same moment: the
// Stripe webhook, the confirm-transition database trigger, the finalize
// fan-out, and the success page. The first caller to flip
// bookings.confirmation_email_sent from false to true owns the send;
// everyone else gets { claimed: false } and does nothing. That single
// atomic update is what keeps a customer from getting the same email from
// each path.

import {
  confirmationSmsBalanceTail,
  remainingDueAfterUpfrontCents,
} from "./booking-balance.ts";
import { smsActionTail } from "./booking-policy.ts";
import { formatServiceDate, formatTimeSlot, sendSms } from "./sms.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const log = (step: string, details?: unknown) =>
  console.log(`[BOOKING-COMMS] ${step}${details === undefined ? "" : " " + JSON.stringify(details)}`);

/**
 * True once the money owed up front has landed. A booking covered by a
 * membership credit, or owing nothing, has nothing to wait on.
 */
export function upfrontPaymentSettled(booking: Record<string, unknown>): boolean {
  if (booking.uses_credit === true) return true;
  if (booking.payment_received_at) return true;
  return Number(booking.total_estimate_cents || 0) <= 0;
}

export interface BookingCommsResult {
  /** This call owned the send. False means another path already did, or the booking is held. */
  claimed: boolean;
  /** Held back because the upfront payment has not cleared. Nothing is latched. */
  held: boolean;
  confirmationSent: boolean;
  checklist: "sent" | "skipped" | "failed";
}

function bookingNumber(booking: Record<string, unknown>): string | undefined {
  return booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : undefined;
}

export function confirmationEmailData(booking: Record<string, unknown>): Record<string, unknown> {
  return {
    firstName: booking.first_name,
    lastName: booking.last_name,
    bookingId: booking.id,
    bookingNumber: bookingNumber(booking),
    serviceDate: booking.service_date,
    timeSlot: booking.time_slot,
    arrivalWindow: booking.arrival_window || booking.time_slot,
    serviceType: booking.service_type,
    homeSize: booking.home_size_id,
    bedrooms: booking.bedrooms,
    bathrooms: booking.bathrooms,
    sqft: booking.sqft,
    address: booking.address,
    city: booking.city,
    state: booking.state,
    zipCode: booking.zip_code,
    totalAmount: Number(booking.total_estimate_cents || 0),
    depositAmount: Number(booking.deposit_cents || 0),
    balanceAmount: remainingDueAfterUpfrontCents(booking),
    paymentOption: booking.payment_option,
    paymentMethod: booking.payment_method,
    useCredit: booking.uses_credit,
    addOns: booking.add_ons,
    frequency: booking.frequency,
    // The checklist has its own email, so the confirmation does not repeat it.
    // The pay link only shows while something is still owed.
    hostedInvoiceUrl: booking.payment_received_at ? undefined : booking.hosted_invoice_url,
  };
}

async function callFunction(name: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status };
}

/**
 * Send the booking confirmation and the personal checklist, exactly once per
 * booking. Safe to call from every confirmation path.
 */
export async function sendBookingConfirmationComms(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  options: { sms?: boolean } = {},
): Promise<BookingCommsResult> {
  const bookingId = String(booking.id);
  const none: BookingCommsResult = { claimed: false, held: false, confirmationSent: false, checklist: "skipped" };

  if (!booking.email) return none;

  // Held, not dropped: the latch stays open so the deposit webhook releases it.
  if (!upfrontPaymentSettled(booking)) {
    log("upfront payment outstanding — holding confirmation + checklist", { bookingId });
    return { ...none, held: true };
  }

  const { data: won, error: claimError } = await supabase
    .from("bookings")
    .update({ confirmation_email_sent: true, confirmation_email_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .or("confirmation_email_sent.eq.false,confirmation_email_sent.is.null")
    .select("id");
  if (claimError) {
    log("claim failed", { bookingId, error: claimError.message });
    return none;
  }
  if (!won || won.length === 0) {
    log("already sent by another path — skipping", { bookingId });
    return none;
  }

  let confirmationSent = false;
  try {
    const outcome = await callFunction("send-booking-email", {
      type: "confirmation",
      email: booking.email,
      data: confirmationEmailData(booking),
    });
    confirmationSent = outcome.ok;
    // send-booking-email queues its own retry when it fails after receiving the call.
    if (!outcome.ok) log("confirmation email failed — retry queued by sender", { bookingId, status: outcome.status });
  } catch (err) {
    log("confirmation email unreachable — queueing retry", { bookingId, error: err instanceof Error ? err.message : String(err) });
    await supabase.from("email_retry_queue").insert({
      booking_id: bookingId,
      email_type: "confirmation",
      recipient_email: booking.email,
      email_data: confirmationEmailData(booking),
      status: "pending",
      retry_count: 0,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }).then(() => undefined, () => undefined);
  }

  if (options.sms !== false && booking.phone) {
    try {
      const dateLabel = formatServiceDate(booking.service_date as string);
      const timeLabel = formatTimeSlot(booking.time_slot as string);
      const tail = confirmationSmsBalanceTail(booking, "emdash");
      await sendSms(supabase, {
        toPhone: booking.phone as string,
        message:
          `Novara Cleaning: Booking confirmed for ${dateLabel}` +
          (timeLabel ? ` (${timeLabel})` : "") +
          `.${tail} ${smsActionTail()}`,
        type: "confirmation",
      });
    } catch (err) {
      log("confirmation SMS failed (non-blocking)", { bookingId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  let checklist: BookingCommsResult["checklist"] = "skipped";
  try {
    const outcome = await callFunction("send-cleaning-checklist", { bookingId });
    checklist = outcome.ok ? "sent" : "failed";
    if (!outcome.ok) log("checklist send failed", { bookingId, status: outcome.status });
  } catch (err) {
    checklist = "failed";
    log("checklist send unreachable", { bookingId, error: err instanceof Error ? err.message : String(err) });
  }

  return { claimed: true, held: false, confirmationSent, checklist };
}
