// ─── Shared post-confirm fan-out ──────────────────────────────────────
//
// Single source of truth for everything that has to fire after a
// booking is promoted to `confirmed`, regardless of whether the
// booking came from the customer funnel (finalize-booking) or the
// internal VA workspace (book-as-va).
//
// Both code paths must converge here so the downstream effects are
// identical:
//   • cleaner_payout_cents / platform_fee_cents stamped (revenue share)
//   • estimated_duration_hours stamped if missing
//   • Time slot reserved (idempotent — RPC already handles dup inserts)
//   • Confirmation email + payment receipt (Resend) — gated on
//     bookings.confirmation_email_sent so re-invokes stay quiet
//   • Customer confirmation SMS (Telnyx via sendSms)
//   • auto-dispatch-booking (assigns cleaners)
//   • create-google-calendar-event
//   • send-zapier-webhook (full GHL custom-field map + Lead Connector)
//   • sync-to-anything
//   • book-ghl-appointment (GHL calendar slot)
//   • send-post-booking-sms (account + referral link, idempotent)
//
// Every block is wrapped in try/catch so a single downstream failure
// can never break the booking response. Idempotent per booking.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

import { sendSms, formatServiceDate, formatTimeSlot } from "./sms.ts";
import { smsActionTail } from "./booking-policy.ts";
import {
  calculateCleanerPayoutCents,
  DEFAULT_PAY_PERCENTAGE,
  getEstimatedHours,
} from "./payout-utils.ts";
import { notifyAllCleanersOfNewOpportunity } from "./notify-cleaners-new-opportunity.ts";

const log = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[POST-CONFIRM] ${step}${tail}`);
};

export interface PostConfirmOptions {
  /**
   * Origin of this fan-out — used in dispatch metadata + SMS copy
   * suppression. 'customer' is the public funnel; 'admin' is the VA
   * internal workspace.
   */
  source?: "customer" | "admin";
  /**
   * Override the default checklist link shown in the confirmation
   * email. If omitted, the helper picks one based on serviceType.
   */
  checklistLink?: string;
  /**
   * Skip the confirmation/receipt emails. Used by callers that want
   * to send their own custom email (rare).
   */
  skipEmails?: boolean;
  /**
   * Skip the customer SMS. Used when the caller already sent one with
   * its own copy (e.g. invoice-aware VA SMS).
   */
  skipCustomerSms?: boolean;
}

/**
 * Map a service type to its public checklist URL. Falls back to the
 * checklist index for membership/other unknowns.
 */
export function checklistLinkForServiceType(serviceType: string | null | undefined): string {
  const base = "https://try.novaracleaning.com/checklist";
  switch ((serviceType || "").toLowerCase()) {
    case "standard":
      return `${base}/standard-clean`;
    case "deep":
      return `${base}/deep-clean`;
    case "combo":
      // Combo = initial Deep + follow-up Standard. Send the Deep
      // checklist since visit 1 is what they'll see first.
      return `${base}/deep-clean`;
    case "moveinout":
    case "move_in_out":
    case "move-in-out":
      return `${base}/move-in-out`;
    default:
      return base;
  }
}

/**
 * Stamp `cleaner_payout_cents` / `platform_fee_cents` /
 * `estimated_duration_hours` on a booking row if they're missing.
 * Idempotent — the conditional UPDATE only fires when the column is
 * NULL or 0.
 */
export async function ensurePayoutFieldsStamped(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
): Promise<void> {
  const updates: Record<string, unknown> = {};

  const revenueCents = Number(
    booking.final_charge_cents || booking.total_estimate_cents || 0,
  );
  if (
    revenueCents > 0 &&
    (!booking.cleaner_payout_cents || Number(booking.cleaner_payout_cents) === 0)
  ) {
    const cleanerPayoutCents = calculateCleanerPayoutCents(
      revenueCents,
      DEFAULT_PAY_PERCENTAGE,
      1,
    );
    updates.cleaner_payout_cents = cleanerPayoutCents;
    updates.platform_fee_cents = Math.max(0, revenueCents - cleanerPayoutCents);
    if (!booking.payout_status) updates.payout_status = "pending";
  }

  if (!booking.estimated_duration_hours && booking.home_size_id) {
    updates.estimated_duration_hours = getEstimatedHours(String(booking.home_size_id));
  }

  if (!booking.offer_type && booking.service_type) {
    updates.offer_type = booking.service_type;
  }

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("bookings")
    .update(updates)
    .eq("id", booking.id);
  if (error) {
    log("payout field stamp failed (non-blocking)", { error: error.message });
  } else {
    log("payout fields stamped", updates);
  }
}

/**
 * Reserve the booking's availability slot. Tolerant of the slot row
 * not existing yet (admin-channel bookings often skip the reserve
 * step) — falls through to upsert.
 */
export async function reserveBookingSlot(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
): Promise<void> {
  const date = booking.service_date as string | null;
  if (!date) return;

  // Map "9:00 AM - 10:00 AM" → 09:00 / 10:00 if start/end aren't
  // explicit columns. The funnel writes a granular slot, but VA
  // bookings have used 4-hour windows historically.
  let startTime = (booking as { service_start_time?: string }).service_start_time || null;
  let endTime = (booking as { service_end_time?: string }).service_end_time || null;
  const slot = (booking.time_slot as string | null | undefined) || "";
  if (!startTime || !endTime) {
    const parsed = parseTimeSlot(slot);
    startTime = startTime || parsed.start;
    endTime = endTime || parsed.end;
  }
  if (!startTime || !endTime) return;

  try {
    await supabase
      .from("availability_slots")
      .upsert(
        {
          service_date: date,
          time_slot: slot,
          start_time: startTime,
          end_time: endTime,
          max_capacity: 5,
          current_bookings: 0,
        },
        { onConflict: "service_date,start_time", ignoreDuplicates: true },
      );

    await supabase.rpc("reserve_time_slot", {
      _date: date,
      _start_time: startTime,
      _end_time: endTime,
    });
    log("slot reserved", { date, start: startTime, end: endTime });
  } catch (err) {
    log("slot reserve failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function parseTimeSlot(slot: string): { start: string | null; end: string | null } {
  // "9:00 AM - 10:00 AM" or "9-12" — best-effort parser.
  if (!slot) return { start: null, end: null };
  const m = slot.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return { start: null, end: null };
  const toClock = (h: string, mm: string | undefined, mer: string | undefined) => {
    let hour = parseInt(h, 10);
    if (mer) {
      const u = mer.toUpperCase();
      if (u === "PM" && hour < 12) hour += 12;
      if (u === "AM" && hour === 12) hour = 0;
    }
    return `${String(hour).padStart(2, "0")}:${(mm || "00").padStart(2, "0")}:00`;
  };
  return { start: toClock(m[1], m[2], m[3]), end: toClock(m[4], m[5], m[6]) };
}

/**
 * Send the customer-facing confirmation + payment receipt emails via
 * the send-booking-email Edge Function. Gated on
 * bookings.confirmation_email_sent so we never double-send.
 */
async function sendConfirmationEmails(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  opts: PostConfirmOptions,
): Promise<void> {
  if (booking.confirmation_email_sent) {
    log("confirmation email already sent — skipping");
    return;
  }
  if (opts.skipEmails) {
    log("skipEmails=true — bypassing");
    return;
  }

  const checklistLink =
    opts.checklistLink || checklistLinkForServiceType(booking.service_type as string);

  const totalCents = Number(booking.total_estimate_cents || 0);
  const finalCents = Number(booking.final_charge_cents || 0);
  const depositCents = Number(booking.deposit_cents || 0);
  const fullDiscount = Number(booking.full_payment_discount || 0);
  const balanceAfterDeposit =
    booking.payment_option === "full"
      ? Math.max(0, totalCents - fullDiscount)
      : Math.max(0, totalCents - depositCents);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  try {
    await fetch(`${supabaseUrl}/functions/v1/send-booking-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        type: "confirmation",
        email: booking.email,
        data: {
          firstName: booking.first_name,
          lastName: booking.last_name,
          bookingId: booking.id,
          bookingNumber: booking.booking_number
            ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
            : undefined,
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
          totalAmount: totalCents,
          depositAmount: depositCents,
          balanceAmount: balanceAfterDeposit,
          paymentOption: booking.payment_option,
          paymentMethod: booking.payment_method,
          useCredit: booking.uses_credit,
          addOns: booking.add_ons,
          frequency: booking.frequency,
          // New: link customers to the public service checklist so
          // they know exactly what's included before the visit.
          checklistLink,
          // Hosted invoice URL is set by both create-payment-intent
          // (remaining-balance flow) and book-as-va (deposit / full
          // invoice). Pass through so the email's "View Invoice" CTA
          // works on the VA path.
          hostedInvoiceUrl: booking.hosted_invoice_url,
          // Account / management deep links — populated by the email
          // function from BRAND.urls if absent.
          rescheduleLink: undefined,
          cancellationLink: undefined,
          referralLink: undefined,
        },
      }),
    });
    log("confirmation email queued");

    // Payment receipt — only for booking flows that actually charged
    // money (deposit > 0). VA invoice mode 'none' doesn't get a
    // receipt because nothing was paid yet.
    const wasPaid =
      Number(depositCents) > 0 ||
      Number(finalCents) > 0 ||
      Boolean(booking.payment_received_at);
    if (wasPaid) {
      await fetch(`${supabaseUrl}/functions/v1/send-booking-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          type: "payment_receipt",
          email: booking.email,
          data: {
            firstName: booking.first_name,
            lastName: booking.last_name,
            bookingId: booking.id,
            serviceDate: booking.service_date,
            timeSlot: booking.time_slot,
            serviceType: booking.service_type,
            totalAmount:
              booking.payment_option === "full"
                ? Math.max(0, totalCents - fullDiscount)
                : depositCents,
            balanceAmount:
              booking.payment_option === "deposit"
                ? Math.max(0, totalCents - depositCents)
                : 0,
            paymentOption: booking.payment_option,
            checklistLink,
          },
        }),
      });
      log("payment_receipt email queued");
    }

    await supabase
      .from("bookings")
      .update({
        confirmation_email_sent: true,
        confirmation_email_sent_at: new Date().toISOString(),
      })
      .eq("id", booking.id);
  } catch (err) {
    log("email send failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function sendCustomerSms(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  opts: PostConfirmOptions,
): Promise<void> {
  if (opts.skipCustomerSms) return;
  if (!booking.phone) return;

  try {
    const dateLabel = formatServiceDate(booking.service_date as string);
    const timeLabel = formatTimeSlot(booking.time_slot as string);
    const totalCents = Number(booking.total_estimate_cents || 0);
    const depositCents = Number(booking.deposit_cents || 0);
    const amountDue =
      booking.payment_option === "deposit"
        ? Math.max(0, totalCents - depositCents)
        : 0;
    const tail =
      amountDue > 0
        ? ` Remaining $${(amountDue / 100).toFixed(2)} is due after service.`
        : " Paid in full — see you soon!";
    const msg =
      `Novara Cleaning: Booking confirmed for ${dateLabel}` +
      (timeLabel ? ` (${timeLabel})` : "") +
      `.${tail} ${smsActionTail()}`;

    await sendSms(supabase, {
      toPhone: booking.phone as string,
      message: msg,
      type: "confirmation",
    });
    log("customer SMS sent");
  } catch (err) {
    log("customer SMS failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function fanoutDownstream(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  // All non-blocking — each invoke is fire-and-(mostly)-forget.
  const fns: Array<[string, Record<string, unknown>]> = [
    ["auto-dispatch-booking", { bookingId }],
    ["create-google-calendar-event", { bookingId }],
    ["send-zapier-webhook", { bookingId }],
    ["sync-to-anything", { bookingId }],
    ["book-ghl-appointment", { bookingId }],
    ["send-post-booking-sms", { bookingId }],
  ];
  for (const [name, body] of fns) {
    try {
      await supabase.functions.invoke(name, { body });
      log(`${name} invoked`);
    } catch (err) {
      log(`${name} failed (non-blocking)`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Run the complete post-confirm pipeline. Caller is responsible for
 * having already promoted `bookings.status` to `confirmed` and stamped
 * `confirmed_at`. This helper does NOT mutate the status — it only
 * fans out the side effects.
 *
 * Returns a summary of what was attempted (purely for logging).
 */
export async function runPostConfirmFanout(
  supabase: SupabaseClient,
  booking: Record<string, unknown>,
  opts: PostConfirmOptions = {},
): Promise<{ ok: true; bookingId: string; source: string }> {
  const bookingId = String(booking.id);
  log("Starting fan-out", { bookingId, source: opts.source || "customer" });

  await ensurePayoutFieldsStamped(supabase, booking);
  await reserveBookingSlot(supabase, booking);
  await sendConfirmationEmails(supabase, booking, opts);
  await sendCustomerSms(supabase, booking, opts);

  try {
    await notifyAllCleanersOfNewOpportunity(supabase, {
      id: bookingId,
      booking_number: booking.booking_number as string | number | null,
      service_date: booking.service_date as string | null,
      time_slot: booking.time_slot as string | null,
      service_type: booking.service_type as string | null,
      city: booking.city as string | null,
      state: booking.state as string | null,
      zip_code: booking.zip_code as string | null,
      address: booking.address as string | null,
    });
  } catch (err) {
    log("cleaner new-opportunity notify failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await fanoutDownstream(supabase, bookingId);

  return { ok: true, bookingId, source: opts.source || "customer" };
}
