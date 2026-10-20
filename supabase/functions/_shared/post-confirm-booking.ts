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
//   • Confirmation email + personal checklist (Resend) — one claim on
//     bookings.confirmation_email_sent, shared with every other confirm
//     path, and held until the upfront payment has settled. Stripe sends
//     the receipt, so this path does not.
//   • Customer confirmation SMS (one text, sent with that same claim)
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

import { sendBookingConfirmationComms } from "./booking-customer-comms.ts";
import {
  calculateCleanerPayoutCents,
  DEFAULT_PAY_PERCENTAGE,
  getEstimatedHours,
} from "./payout-utils.ts";
import { publicChecklistUrl } from "./public-checklist-url.ts";
import { suppressLeftoverPublicCheckouts } from "./checkout-nudge-guard.ts";

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
   * Kept for callers that used to override the checklist link inside the
   * confirmation. The checklist is now its own email, so this is ignored.
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
 * Map a service type (and commercial scope) to its public checklist URL.
 */
export function checklistLinkForServiceType(
  serviceType: string | null | undefined,
  scopeLevel?: string | null,
): string {
  return publicChecklistUrl(serviceType, scopeLevel);
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

export { upfrontPaymentSettled } from "./booking-customer-comms.ts";

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
 * Confirmation email, the personal checklist, and one confirmation text.
 * The shared helper is the only sender, so this fan-out and the confirm
 * trigger cannot both deliver.
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
  try {
    const result = await sendBookingConfirmationComms(supabase, booking, {
      sms: opts.skipCustomerSms !== true,
    });
    log("customer comms", result);
  } catch (err) {
    log("email send failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function fanoutDownstream(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> {
  // All non-blocking and mutually independent — invoke them in
  // PARALLEL so the customer's confirmation response isn't held up by
  // 6 edge functions running one after another (previously 12-30s of
  // serial latency). Each is wrapped so one failure can't reject the
  // batch.
  // Same-day bookings need urgent sourcing + an admin heads-up immediately.
  let isSameDay = false;
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("is_same_day, same_day_sourcing_deadline_at, booking_number, first_name, email")
      .eq("id", bookingId)
      .maybeSingle();
    isSameDay = Boolean(b?.is_same_day);
    if (isSameDay) {
      await supabase.from("events").insert({
        event_type: "same_day.sourcing_active",
        booking_id: bookingId,
        source: "post-confirm-booking",
        summary: `URGENT same-day sourcing — booking ${b?.booking_number || bookingId}`,
        data: {
          booking_id: bookingId,
          deadline: b?.same_day_sourcing_deadline_at,
          customer: b?.first_name,
          email: b?.email,
        },
      });
    }
  } catch (err) {
    log("same-day flag lookup failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fns: Array<[string, Record<string, unknown>]> = [
    ["auto-dispatch-booking", { bookingId, urgent: isSameDay }],
    ["create-google-calendar-event", { bookingId }],
    ["send-zapier-webhook", { bookingId }],
    ["sync-to-anything", { bookingId }],
    ["book-ghl-appointment", { bookingId }],
    ["send-post-booking-sms", { bookingId }],
  ];
  await Promise.allSettled(
    fns.map(async ([name, body]) => {
      try {
        await supabase.functions.invoke(name, { body });
        log(`${name} invoked`);
      } catch (err) {
        log(`${name} failed (non-blocking)`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
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

  try {
    await suppressLeftoverPublicCheckouts(supabase, {
      email: booking.email as string | undefined,
      phone: booking.phone as string | undefined,
      keepBookingId: bookingId,
      reason: "booking_confirmed",
    });
  } catch (err) {
    log("checkout-nudge suppress failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await ensurePayoutFieldsStamped(supabase, booking);
  await reserveBookingSlot(supabase, booking);
  await sendConfirmationEmails(supabase, booking, opts);

  await fanoutDownstream(supabase, bookingId);

  return { ok: true, bookingId, source: opts.source || "customer" };
}
