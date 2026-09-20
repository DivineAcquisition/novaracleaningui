// Guardrails for abandoned-checkout nudges (SMS + email).
//
// "Finish your booking / save $30" must never fire once the customer
// already has a real booking or a completed job. Leftover public
// pending_payment rows (resume links, localStorage re-checkouts for a
// past date) are the Nikkia Franks failure mode: NVC-0096 completed
// Sep 9, then NVC-117 / NVC-118 unpaid Sep 4 carts kept texting.
//
// Pure evaluators live here so verify scripts can lock the policy
// without a database. Lookups / suppress writes take a supabase client.

import { phoneDigits10, toE164US } from "./phone-format.ts";

export const CHECKOUT_NUDGE_TZ = "America/New_York";

/** Cart / void statuses — these are NOT "a booking" for nudge suppression. */
export const CHECKOUT_NUDGE_VOID_STATUSES = [
  "pending_payment",
  "abandoned",
  "cancelled",
  "canceled",
] as const;

export type CheckoutNudgeSkipReason =
  | "existing_booking"
  | "completed_booking"
  | "past_service_date";

export const PAST_SERVICE_DATE_CODE = "PAST_SERVICE_DATE";
export const CHECKOUT_NUDGE_SUPPRESSED_CODE = "CHECKOUT_NUDGE_SUPPRESSED";

export const CHECKOUT_NUDGE_SKIP_COPY: Record<CheckoutNudgeSkipReason, string> = {
  existing_booking:
    "This checkout is no longer active — you already have a booking with us.",
  completed_booking:
    "This checkout is no longer active — your booking is already complete.",
  past_service_date:
    "That appointment date has already passed. Please start a new booking.",
};

export type CheckoutNudgeBooking = {
  id: string;
  status?: string | null;
  service_date?: string | null;
  payment_received_at?: string | null;
};

export type CheckoutNudgeVerdict = {
  send: boolean;
  skipReason: CheckoutNudgeSkipReason | null;
  match?: CheckoutNudgeBooking;
};

export function etYmd(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHECKOUT_NUDGE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isPastServiceDate(
  serviceDate: string | null | undefined,
  now = new Date(),
): boolean {
  const ymd = String(serviceDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  return ymd < etYmd(now);
}

export function isVoidCheckoutStatus(status: string | null | undefined): boolean {
  return CHECKOUT_NUDGE_VOID_STATUSES.includes(
    String(status || "").toLowerCase().trim() as (typeof CHECKOUT_NUDGE_VOID_STATUSES)[number],
  );
}

export function isCompletedStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase().trim();
  return s === "completed" || s === "pending_review";
}

/** True when this row is a real booking (booked, in progress, or done). */
export function isBookedOrDone(booking: CheckoutNudgeBooking): boolean {
  if (booking.payment_received_at) return true;
  return !isVoidCheckoutStatus(booking.status);
}

export function isPublicCheckoutPending(booking: Record<string, unknown>): boolean {
  const channel = String(booking.booking_channel || "").toLowerCase().trim();
  if (
    channel === "admin" || channel === "va" || channel === "internal" ||
    channel === "partner"
  ) {
    return false;
  }
  const source = String(booking.booker_source || "").toLowerCase().trim();
  if (source.startsWith("va_") || source === "va_admin" || source === "admin") {
    return false;
  }
  if (booking.hosted_invoice_url || booking.stripe_invoice_id) return false;
  return true;
}

/**
 * Should we send an abandoned-checkout nudge for this pending cart?
 *
 * Skip when:
 *   1. Another booking for this person is booked or completed
 *      ("there is a booking or the completion of one")
 *   2. The cart's service date is already in the past (ET)
 */
export function evaluateCheckoutNudgeGuard(opts: {
  pendingServiceDate?: string | null;
  otherBookings: CheckoutNudgeBooking[];
  now?: Date;
}): CheckoutNudgeVerdict {
  const booked = opts.otherBookings.filter(isBookedOrDone);
  if (booked.length) {
    const completed = booked.find((b) => isCompletedStatus(b.status));
    const match = completed || booked[0];
    return {
      send: false,
      skipReason: completed ? "completed_booking" : "existing_booking",
      match,
    };
  }
  if (isPastServiceDate(opts.pendingServiceDate, opts.now)) {
    return { send: false, skipReason: "past_service_date" };
  }
  return { send: true, skipReason: null };
}

function identityOrFilter(email?: string | null, phone?: string | null): string | null {
  const clauses: string[] = [];
  const em = String(email || "").trim().toLowerCase();
  if (em) clauses.push(`email.ilike.${em}`);
  const raw = String(phone || "").trim();
  const last10 = phoneDigits10(raw);
  const e164 = toE164US(raw);
  if (raw) clauses.push(`phone.eq.${raw}`);
  if (e164 && e164 !== raw) clauses.push(`phone.eq.${e164}`);
  if (last10.length === 10) {
    clauses.push(`phone.eq.${last10}`);
    clauses.push(`phone.eq.+1${last10}`);
    clauses.push(`phone.like.%${last10}`);
  }
  return clauses.length ? clauses.join(",") : null;
}

export function checkoutNudgeIdentityKey(
  email?: string | null,
  phone?: string | null,
): string {
  return `${String(email || "").trim().toLowerCase()}|${phoneDigits10(phone)}`;
}

export function extractCartServiceDate(bookingData: unknown): string | null {
  let bd = bookingData;
  if (typeof bd === "string") {
    try {
      bd = JSON.parse(bd);
    } catch {
      return null;
    }
  }
  if (!bd || typeof bd !== "object") return null;
  const rec = bd as Record<string, unknown>;
  const v = rec.serviceDate ?? rec.service_date;
  return typeof v === "string" && v.trim() ? v : null;
}

export async function loadBookedOrDoneBookings(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    email?: string | null;
    phone?: string | null;
    excludeBookingId?: string | null;
  },
): Promise<CheckoutNudgeBooking[]> {
  const orFilter = identityOrFilter(opts.email, opts.phone);
  if (!orFilter) return [];

  const voidList = `(${CHECKOUT_NUDGE_VOID_STATUSES.map((s) => `"${s}"`).join(",")})`;
  const select = "id, status, service_date, payment_received_at";

  // Two queries: non-void statuses (confirmed / completed / assigned / …)
  // AND anything that already took payment (covers pending_payment lag).
  let byStatus = supabase.from("bookings").select(select).or(orFilter)
    .not("status", "in", voidList).limit(25);
  let byPaid = supabase.from("bookings").select(select).or(orFilter)
    .not("payment_received_at", "is", null).limit(25);

  if (opts.excludeBookingId) {
    byStatus = byStatus.neq("id", opts.excludeBookingId);
    byPaid = byPaid.neq("id", opts.excludeBookingId);
  }

  const [statusRes, paidRes] = await Promise.all([byStatus, byPaid]);
  if (statusRes.error) {
    console.warn("[checkout-nudge-guard] load by status", statusRes.error.message);
  }
  if (paidRes.error) {
    console.warn("[checkout-nudge-guard] load by payment", paidRes.error.message);
  }

  const byId = new Map<string, CheckoutNudgeBooking>();
  for (const row of [
    ...((statusRes.data || []) as CheckoutNudgeBooking[]),
    ...((paidRes.data || []) as CheckoutNudgeBooking[]),
  ]) {
    if (row?.id) byId.set(row.id, row);
  }
  return [...byId.values()].filter(isBookedOrDone);
}

/** Flip one leftover public pending_payment row to abandoned. Invoice/VA rows stay. */
export async function abandonPublicPendingCheckout(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  bookingId: string,
): Promise<boolean> {
  if (!bookingId) return false;
  const { data } = await supabase
    .from("bookings")
    .select("id, status, booking_channel, booker_source, hosted_invoice_url, stripe_invoice_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (
    !data ||
    data.status !== "pending_payment" ||
    !isPublicCheckoutPending(data as Record<string, unknown>)
  ) {
    return false;
  }
  const { data: updated } = await supabase
    .from("bookings")
    .update({ status: "abandoned" })
    .eq("id", bookingId)
    .eq("status", "pending_payment")
    .select("id");
  return (updated?.length || 0) > 0;
}

/**
 * Stop leftover public checkout carts from nagging:
 *   • mark abandoned_carts converted for this email
 *   • flip matching unpaid public pending_payment rows to `abandoned`
 *     (invoice-backed VA deposits are left alone)
 */
export async function suppressLeftoverPublicCheckouts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    email?: string | null;
    phone?: string | null;
    keepBookingId?: string | null;
    reason: string;
  },
): Promise<{ carts: number; bookings: number }> {
  const now = new Date().toISOString();
  const em = String(opts.email || "").trim().toLowerCase();
  let carts = 0;
  let bookings = 0;

  if (em) {
    const { data } = await supabase
      .from("abandoned_carts")
      .update({ converted_at: now, updated_at: now })
      .ilike("email", em)
      .is("converted_at", null)
      .select("id");
    carts = data?.length || 0;
  }

  const orFilter = identityOrFilter(opts.email, opts.phone);
  if (orFilter) {
    let query = supabase
      .from("bookings")
      .select(
        "id, booking_channel, booker_source, hosted_invoice_url, stripe_invoice_id, status",
      )
      .eq("status", "pending_payment")
      .or(orFilter)
      .limit(50);
    if (opts.keepBookingId) query = query.neq("id", opts.keepBookingId);
    const { data: rows } = await query;
    const ids = ((rows || []) as Record<string, unknown>[])
      .filter(isPublicCheckoutPending)
      .map((r) => String(r.id))
      .filter(Boolean);
    if (ids.length) {
      const { data: updated } = await supabase
        .from("bookings")
        .update({ status: "abandoned" })
        .in("id", ids)
        .eq("status", "pending_payment")
        .select("id");
      bookings = updated?.length || 0;
    }
  }

  if (carts || bookings) {
    try {
      await supabase.from("events").insert({
        event_type: "checkout_nudge.suppressed",
        booking_id: opts.keepBookingId || idsOrNull(opts),
        source: "checkout-nudge-guard",
        summary: `Suppressed leftover checkout nudges (${opts.reason})`,
        data: {
          reason: opts.reason,
          email: em || null,
          carts,
          bookings,
        },
      });
    } catch {
      /* audit is best-effort */
    }
  }

  return { carts, bookings };
}

function idsOrNull(opts: { keepBookingId?: string | null }): string | null {
  return opts.keepBookingId || null;
}
