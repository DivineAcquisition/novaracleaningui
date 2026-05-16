// ─── Booking lifecycle policy + shared helpers ───────────────────────────
//
// One place that owns:
//   • cancel / reschedule fee calculation
//   • the canonical support phone number used in every SMS / email
//   • E.164 phone normalization (for matching inbound SMS replies to a
//     booking by `bookings.phone`)
//   • the GHL custom-field bag a lifecycle event should publish
//
// Keep this file dependency-free so cancel-booking, reschedule-booking,
// complete-booking, and the inbound SMS handler can all import it.

/** Support number rendered on the booking funnel — single source of truth. */
export const SUPPORT_PHONE_DISPLAY = "(844) 735-2070";
export const SUPPORT_PHONE_E164 = "+18447352070";

/** Short-notice fees (in cents) — applied when changing < 24 hrs before service. */
export const CANCEL_SHORT_NOTICE_FEE_CENTS = 5000;       // $50
export const RESCHEDULE_SHORT_NOTICE_FEE_CENTS = 2500;   // $25
export const SHORT_NOTICE_WINDOW_HOURS = 24;

export type CancelFeeBasis = "outside_window" | "short_notice" | "credit_used";
export type RescheduleFeeBasis = "outside_window" | "short_notice";

export interface CancelFeeDecision {
  feeCents: number;
  basis: CancelFeeBasis;
  hoursUntilService: number;
  /** Human-readable copy suitable for inserting into SMS / email. */
  copy: string;
}

export interface RescheduleFeeDecision {
  feeCents: number;
  basis: RescheduleFeeBasis;
  hoursUntilService: number;
  copy: string;
}

/** Hours between now and a YYYY-MM-DD service date. */
function hoursUntil(serviceDate?: string | null): number {
  if (!serviceDate) return 9999;
  // Anchor on noon local so timezone wobble doesn't flip the boundary.
  const t = Date.parse(`${serviceDate}T12:00:00`);
  if (isNaN(t)) return 9999;
  return Math.round((t - Date.now()) / (1000 * 60 * 60));
}

/**
 * Decide the cancellation fee for a booking. Membership-credit
 * bookings never carry a cash fee (the credit is simply forfeited or
 * restored separately).
 */
export function decideCancelFee(args: {
  serviceDate?: string | null;
  usesCredit?: boolean | null;
}): CancelFeeDecision {
  const hrs = hoursUntil(args.serviceDate);
  if (args.usesCredit) {
    return {
      feeCents: 0,
      basis: "credit_used",
      hoursUntilService: hrs,
      copy:
        "Your membership credit will be restored. No cash fee applies.",
    };
  }
  if (hrs < SHORT_NOTICE_WINDOW_HOURS && hrs > 0) {
    return {
      feeCents: CANCEL_SHORT_NOTICE_FEE_CENTS,
      basis: "short_notice",
      hoursUntilService: hrs,
      copy:
        `Heads up: cancelling within ${SHORT_NOTICE_WINDOW_HOURS} hrs of your appointment ` +
        `incurs a $${(CANCEL_SHORT_NOTICE_FEE_CENTS / 100).toFixed(0)} short-notice fee. ` +
        `The remainder of your deposit is refunded.`,
    };
  }
  return {
    feeCents: 0,
    basis: "outside_window",
    hoursUntilService: hrs,
    copy: "Full refund — no fee. We'll process it within 5–10 business days.",
  };
}

export function decideRescheduleFee(args: {
  serviceDate?: string | null;
}): RescheduleFeeDecision {
  const hrs = hoursUntil(args.serviceDate);
  if (hrs < SHORT_NOTICE_WINDOW_HOURS && hrs > 0) {
    return {
      feeCents: RESCHEDULE_SHORT_NOTICE_FEE_CENTS,
      basis: "short_notice",
      hoursUntilService: hrs,
      copy:
        `Heads up: rescheduling within ${SHORT_NOTICE_WINDOW_HOURS} hrs of your appointment ` +
        `adds a $${(RESCHEDULE_SHORT_NOTICE_FEE_CENTS / 100).toFixed(0)} short-notice fee to ` +
        `your invoice.`,
    };
  }
  return {
    feeCents: 0,
    basis: "outside_window",
    hoursUntilService: hrs,
    copy: "No fee — there's plenty of notice before your appointment.",
  };
}

/**
 * Normalize a freeform phone string to E.164 (US default). Returns ""
 * when there are no digits.
 */
export function toE164(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("+")) return String(raw);
  return `+${digits}`;
}

/**
 * Generate a tail snippet to append to every customer-facing
 * transactional SMS so they can reschedule / cancel via reply.
 * Keep this <160 chars so we stay in a single SMS segment when combined
 * with a short main message.
 */
export function smsActionTail(): string {
  return `Reply R to reschedule, C to cancel. Help? Call ${SUPPORT_PHONE_DISPLAY}. Reply STOP to opt out.`;
}
