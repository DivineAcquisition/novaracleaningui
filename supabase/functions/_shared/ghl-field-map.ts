// ─── GHL Custom Field Map ────────────────────────────────────────────────
//
// One mapper that builds the full custom-field bag for a booking event.
// Keys use GHL's bare `fieldKey` (the ghl-client resolves both bare and
// "contact." prefixed forms to UUIDs at upload time). Fields that don't
// apply to the current event come back as empty strings — the
// ghl-client's `buildCustomFieldsArray` filters those out so we never
// blow away a populated value with a blank.
//
// Coverage as of May 2026: 60+ of the 80 location custom fields. The
// 20-ish we DON'T push are either analytics-only (LTV projections,
// churn risk) computed downstream, file uploads (before/after photos)
// that need the GHL files API, or read-only computed fields.

import { fmtMoney, ynBool } from "./ghl-client.ts";

export interface BookingRowLike {
  id?: string;
  booking_number?: number | null;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  service_type?: string | null;
  offer_type?: string | null;
  service_date?: string | null;
  time_slot?: string | null;
  estimated_duration_hours?: number | null;
  home_size_id?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  dwelling_type?: string | null;
  add_ons?: string[] | null;
  membership_plan?: string | null;
  uses_credit?: boolean | null;
  base_price_cents?: number | null;
  deposit_cents?: number | null;
  total_estimate_cents?: number | null;
  final_charge_cents?: number | null;
  tip_cents?: number | null;
  tax_cents?: number | null;
  platform_fee_cents?: number | null;
  cleaner_payout_cents?: number | null;
  cancel_fee_cents?: number | null;
  reschedule_fee_cents?: number | null;
  reschedule_count?: number | null;
  payment_option?: string | null;
  payment_method?: string | null;
  payment_intent_id?: string | null;
  customer_id?: string | null;
  hosted_invoice_url?: string | null;
  stripe_invoice_id?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  address?: string | null;
  access_notes?: string | null;
  team_notes?: string | null;
  dispatch_notes?: string | null;
  sdr_rep_name?: string | null;
  booker_source?: string | null;
  booking_channel?: string | null;
  status?: string | null;
  cancel_reason?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  landing_page?: string | null;
  referrer?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  num_cleaners_assigned?: number | null;
  before_photos?: string[] | null;
  after_photos?: string[] | null;
  service_start_time?: string | null;
  service_end_time?: string | null;
}

export interface MapperCleaner {
  name?: string;
  phone?: string;
  /**
   * Pay tier ('foundation' | 'proven' | 'elite') — preferred under the
   * revenue-share model. Pass-through to mapPayTier.
   */
  payTier?: string | null;
  /**
   * @deprecated Legacy hourly rate (dollars OR cents). Kept for
   * back-compat where a row hasn't been migrated to pay_tier yet.
   */
  payRate?: number;
}

export interface MapperInputs {
  booking: BookingRowLike;
  cleaners: MapperCleaner[];
  /** Last paid amount (cents) and ISO date — usually from the latest charge. */
  lastPayment?: { amountCents: number; date: string } | null;
  /** ISO date of the previous completed service for this customer. */
  lastServiceAt?: string | null;
  /** Total lifetime spend for this customer in cents. */
  lifetimeRevenueCents?: number | null;
  /** Number of completed bookings on this customer's record (used for LTV cadence). */
  completedBookingCount?: number | null;
  /** ISO date of the customer's first completed service — anchors the LTV cadence. */
  firstServiceAt?: string | null;
  /** Number of failed charges for this customer in the last 90 days. */
  failedPaymentCount?: number | null;
  /** Number of past cancelled bookings on this customer (for churn risk model). */
  cancelledBookingCount?: number | null;
  /** Stripe customer id + subscription id for the Glow path. */
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  /** Membership state (computed from Stripe). */
  isMemberPaused?: boolean | null;
  isMemberTrialing?: boolean | null;
  isMemberCanceled?: boolean | null;
  /** Last-4 / brand of the default card on file. */
  defaultPaymentMethod?: string | null;
  /** TRUE if the most recent Stripe charge on this customer failed. */
  hasFailedPaymentRecently?: boolean | null;
  /** Consecutive failed charges — 3+ trips the "Collections" status. */
  failedPaymentStreak?: number | null;
  /** STRIPE-DRIVEN lifetime aggregates — preferred over the bookings-table fallback. */
  stripeLifetimeRevenueCents?: number | null;
  stripePaidJobCount?: number | null;
  /** Sum of (base_price - total_estimate) across ALL of this customer's bookings, in cents. */
  allBookingsTotalDiscountCents?: number | null;
  /** Stripe Payment Link / invoice URL for the customer to pay their outstanding balance. */
  paymentLinkUrl?: string | null;
  /** Referral metadata. */
  referralCode?: string | null;
  referralLink?: string | null;
  referralRevenueCents?: number | null;
  referralCreditCents?: number | null;
  referralName?: string | null;
  /** Public origin used to build the manage-service link (e.g. https://try.novaracleaning.com). */
  publicOrigin?: string;
}

// ─── Enum maps — values MUST match the SINGLE_OPTIONS configured in GHL.
// Verified against the live customFields endpoint on 2026-05-17.
// "Combo" / "Recurring Maintenance" aren't in the GHL options list, so
// we collapse them to the closest configured value.
const SERVICE_TYPE_LABEL: Record<string, string> = {
  standard: "Standard Cleaning",
  deep: "Deep Cleaning",
  moveInOut: "Move In/Out Cleaning",
  combo: "Deep Cleaning",          // collapse combo → Deep (the headline visit)
  recurring: "Standard Cleaning",  // recurring = standard cadence
  office: "Office Cleaning",
};

const DWELLING_LABEL: Record<string, string> = {
  house: "House",
  single_family: "House",
  apartment: "Apartment",
  condo: "Condo",
  office_space: "Office Space",
  townhouse: "Townhouse",
  mansion: "Mansion",
  mobile_home: "House",
  other: "House",
};

const HOME_SIZE_SQFT_MIDPOINT: Record<string, number> = {
  "0_999": 750,
  "1000_1500": 1250,
  "1501_2000": 1750,
  "2001_2500": 2250,
  "2501_3000": 2750,
  "3001_3500": 3250,
  "3501_4000": 3750,
  "4001_4500": 4250,
  "4501_5000": 4750,
  "5000_plus": 5500,
};

// Home size labels match GHL options exactly (with " SQ-FT" suffix).
// GHL has no "0-999" option; we collapse the smallest tier into the
// next one up so the dropdown always lines up.
const HOME_SIZE_LABEL: Record<string, string> = {
  "0_999": "1000-1500 SQ-FT",
  "1000_1500": "1000-1500 SQ-FT",
  "1501_2000": "1501-2000 SQ-FT",
  "2001_2500": "2001-2500 SQ-FT",
  "2501_3000": "2501-3000 SQ-FT",
  "3001_3500": "3001-3500 SQ-FT",
  "3501_4000": "3501-4000 SQ-FT",
  "4001_4500": "4001-4500 SQ-FT",
  "4501_5000": "4501-5000 SQ-FT",
  "5000_plus": "5000+ SQ-FT",
};

// Novara Glow Plan — ONLY the 3 paid tiers. For non-members, send "" so
// the field stays blank (no "None" option in GHL).
const NOVARA_GLOW_PLAN_LABEL: Record<string, string> = {
  monthly: "Monthly",
  biweekly: "Bi-Weekly",
  weekly: "Weekly",
};

// Billing Frequency — Per Visit | Monthly | Prepaid Annual.
// Per Visit = one-time customer. Monthly = any Glow subscription.
// Prepaid Annual = future tier (annual plan); reserved for later.
function mapBillingFrequency(membershipPlan?: string | null): "Per Visit" | "Monthly" | "Prepaid Annual" {
  const p = (membershipPlan || "none").toLowerCase();
  if (p === "annual" || p === "prepaid_annual" || p === "yearly") return "Prepaid Annual";
  if (p && p !== "none") return "Monthly";
  return "Per Visit";
}

// Service Frequency — One-Time | Weekly | Bi-Weekly | Monthly.
function mapServiceFrequency(membershipPlan?: string | null): "One-Time" | "Weekly" | "Bi-Weekly" | "Monthly" {
  const p = (membershipPlan || "none").toLowerCase();
  if (p === "weekly") return "Weekly";
  if (p === "biweekly" || p === "bi-weekly") return "Bi-Weekly";
  if (p === "monthly") return "Monthly";
  return "One-Time";
}

// Call Type — matches GHL options.
function mapCallType(source?: string | null, bookingNumber?: number | null, isMember?: boolean): "New Booking" | "Reschedule" | "Rebooking / Repeat CX" | "Recurring / Membership" {
  if (isMember) return "Recurring / Membership";
  if (source === "reschedule" || source === "customer_portal_reschedule") return "Reschedule";
  if ((bookingNumber ?? 0) > 1) return "Rebooking / Repeat CX";
  return "New Booking";
}

// Lead Source — buckets UTM source into GHL's curated list.
function mapLeadSource(utmSource?: string | null, fbclid?: string | null, gclid?: string | null, bookerSource?: string | null, bookingChannel?: string | null): string {
  const s = (utmSource || "").toLowerCase();
  if (fbclid) {
    if (s.includes("instagram") || s === "ig") return "IG Ads";
    return "FB Ads";
  }
  if (gclid || s === "google" || s === "googleads") return "Google Ads";
  if (s === "instagram" || s === "ig") return "IG Ads";
  if (s === "facebook" || s === "fb") return "FB Ads";
  if (s === "seo" || s === "organic") return "SEO";
  if (s === "referral" || (bookerSource || "").toLowerCase().includes("referr")) return "Referral";
  if (s === "direct" || (bookerSource || "").toLowerCase() === "direct") return "Direct";
  const ch = (bookingChannel || "").toLowerCase();
  if (ch.includes("phone") || ch.includes("call")) return "Inbound Call";
  if (ch.includes("web") || ch === "website" || ch === "online") return "Website";
  return "Other";
}

// Customer Source — only the 6 GHL options. Maps from booker_source +
// UTM hints. Returns "" if no good fit so we don't pollute the field.
function mapCustomerSource(utmSource?: string | null, fbclid?: string | null, gclid?: string | null, referralCode?: string | null, bookerSource?: string | null): string {
  if (referralCode) return "Referred By Someone";
  const s = (utmSource || "").toLowerCase();
  const b = (bookerSource || "").toLowerCase();
  if (fbclid || s === "facebook" || s === "fb" || b.includes("facebook")) return "Facebook";
  if (s === "instagram" || s === "ig" || b.includes("instagram")) return "Instagram";
  if (gclid || s === "google" || b.includes("google")) return "Google";
  if (s.includes("ads") || s === "paid" || b.includes("ad")) return "Advertisment";
  if (b.includes("friend") || b.includes("family") || b === "fnf") return "Friend Or Family";
  return ""; // unknown — leave blank, GHL doesn't have an "Other"
}

// Assigned Cleaner Pay Tier — under the new revenue-share model the
// tier is stored directly on cleaners.pay_tier. We accept either the
// tier string (preferred) or the legacy hourly rate (back-compat for
// rows that haven't been migrated yet) and map to the GHL label using
// the new revenue-share copy.
function mapPayTier(payTierOrRate?: string | number | null): string {
  if (payTierOrRate == null || payTierOrRate === "") return "";
  const s = String(payTierOrRate).toLowerCase();
  if (s === "elite") return "Elite (50% revenue share)";
  if (s === "proven") return "Proven (45% revenue share)";
  if (s === "foundation") return "Foundation (40% revenue share)";
  // Numeric fallback — treat as legacy hourly rate during transition.
  const n = Number(payTierOrRate);
  if (Number.isFinite(n) && n > 0) {
    const dollars = n >= 100 ? n / 100 : n;
    if (dollars >= 22) return "Elite (50% revenue share)";
    if (dollars >= 20) return "Proven (45% revenue share)";
    return "Foundation (40% revenue share)";
  }
  return "";
}

// Membership Status — Not Started | Payment Issue | Paused | Canceled | Active | Trialing.
function mapMembershipStatus(args: {
  isMember: boolean;
  isPaused?: boolean;
  isTrialing?: boolean;
  hasFailedPayment?: boolean;
  isCanceled?: boolean;
}): "Not Started" | "Payment Issue" | "Paused" | "Canceled" | "Active" | "Trialing" {
  if (!args.isMember && !args.isCanceled && !args.isPaused && !args.isTrialing) return "Not Started";
  if (args.isCanceled) return "Canceled";
  if (args.isPaused) return "Paused";
  if (args.hasFailedPayment) return "Payment Issue";
  if (args.isTrialing) return "Trialing";
  return "Active";
}

// Payment Status — Current | Past Due | Failed | Collections.
function mapPaymentStatusV2(args: {
  status?: string | null;
  serviceDateIso?: string | null;
  outstandingCents: number;
  hasFailedPaymentRecently: boolean;
  failedPaymentStreak?: number | null;
}): "Current" | "Past Due" | "Failed" | "Collections" {
  // Collections: 3+ consecutive failed attempts → escalate
  if ((args.failedPaymentStreak ?? 0) >= 3) return "Collections";
  // Past-Due: service date is in the past and a balance is still owed
  if (args.serviceDateIso && args.outstandingCents > 0) {
    const dt = Date.parse(`${String(args.serviceDateIso).slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(dt) && dt < Date.now() - 24 * 60 * 60 * 1000) return "Past Due";
  }
  // Failed: last charge attempt failed (no past-due timeline yet)
  if (args.hasFailedPaymentRecently) return "Failed";
  return "Current";
}

function mapDepositType(payment_option?: string | null, deposit?: number | null, total?: number | null): string {
  // Matches GHL options: Pay After Service | Paid In Full | $39 Only |
  // $50 Only | 25% Down | 50% Down. Falls back to "50% Down" since
  // that's the standard funnel default.
  if (payment_option === "full") return "Paid In Full";
  if (!deposit) return "Pay After Service";
  if (deposit === 3900) return "$39 Only";
  if (deposit === 5000) return "$50 Only";
  if (total && Math.abs(deposit / total - 0.5) < 0.05) return "50% Down";
  if (total && Math.abs(deposit / total - 0.25) < 0.05) return "25% Down";
  return "50% Down";
}

function fmtIsoDate(d?: string | null): string {
  if (!d) return "";
  try {
    const dt = new Date(d.includes("T") ? d : `${d}T12:00:00`);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toISOString().slice(0, 10);
  } catch { return ""; }
}

/**
 * Parse a stored time_slot string ("9:00 AM - 10:00 AM", "8-12",
 * "9:00 AM", etc.) into a start and end time string the GHL TEXT
 * fields `service_start_time` / `service_end_time` can hold. Returns
 * "" for parts the slot doesn't carry so empty values are filtered.
 */
function deriveServiceTimes(slot?: string | null): { start: string; end: string } {
  if (!slot) return { start: "", end: "" };
  const trimmed = String(slot).trim();
  // "9:00 AM - 10:00 AM" — the SchedulePicker canonical format.
  const ampmMatch = trimmed.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (ampmMatch) return { start: ampmMatch[1].toUpperCase(), end: ampmMatch[2].toUpperCase() };
  // "8-12" / "12-16" / "16-20" — legacy 4-hour blocks (24h).
  const blockMatch = trimmed.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (blockMatch) {
    const fmt = (h: number) => {
      const period = h >= 12 ? "PM" : "AM";
      const hour = h % 12 === 0 ? 12 : h % 12;
      return `${hour}:00 ${period}`;
    };
    return { start: fmt(parseInt(blockMatch[1], 10)), end: fmt(parseInt(blockMatch[2], 10)) };
  }
  // "9-11am" — legacy compact format.
  const compactMatch = trimmed.toLowerCase().match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*(am|pm)$/);
  if (compactMatch) {
    const period = compactMatch[3].toUpperCase();
    return { start: `${compactMatch[1]}:00 ${period}`, end: `${compactMatch[2]}:00 ${period}` };
  }
  // Fallback: put the whole slot in start, leave end blank.
  return { start: trimmed, end: "" };
}

/**
 * Simple LTV projection: anchored on either lifetime revenue +
 * months since first service (one-time customers) or monthly
 * subscription total (active members).
 */
function projectLtv(args: {
  isMember: boolean;
  baseCents?: number | null;
  totalCents?: number | null;
  monthlyCents?: number | null;
  lifetimeCents?: number | null;
  firstServiceAt?: string | null;
  completedCount?: number | null;
}): { m3: number | null; m6: number | null; m12: number | null } {
  // Members: monthly × N
  if (args.isMember && args.monthlyCents) {
    return {
      m3: args.monthlyCents * 3,
      m6: args.monthlyCents * 6,
      m12: args.monthlyCents * 12,
    };
  }
  // One-time customer with history: extrapolate from past cadence
  if ((args.lifetimeCents ?? 0) > 0 && args.firstServiceAt && (args.completedCount ?? 0) > 0) {
    const first = new Date(`${String(args.firstServiceAt).slice(0, 10)}T12:00:00`).getTime();
    if (!Number.isNaN(first)) {
      const monthsSpan = Math.max(1, (Date.now() - first) / (1000 * 60 * 60 * 24 * 30.4));
      const cadenceCents = (args.lifetimeCents || 0) / monthsSpan;
      return {
        m3: Math.round(cadenceCents * 3),
        m6: Math.round(cadenceCents * 6),
        m12: Math.round(cadenceCents * 12),
      };
    }
  }
  // Brand-new customer: extrapolate current booking total at quarterly cadence.
  const t = args.totalCents || args.baseCents || 0;
  if (t > 0) return { m3: t, m6: t * 2, m12: t * 4 };
  return { m3: null, m6: null, m12: null };
}

/**
 * Heuristic churn-risk label. SINGLE_OPTIONS — values must match the
 * options configured in GHL. Common pre-configured set:
 * "Low" | "Medium" | "High" | "Unknown".
 */
function churnRisk(args: {
  cancelledCount?: number | null;
  failedPaymentCount?: number | null;
  completedCount?: number | null;
  isMember: boolean;
}): "Low" | "Medium" | "High" | "Unknown" {
  const cancels = args.cancelledCount ?? 0;
  const fails = args.failedPaymentCount ?? 0;
  const completed = args.completedCount ?? 0;
  if (cancels >= 2 || fails >= 2) return "High";
  if (cancels === 1 || fails === 1) return "Medium";
  if (completed >= 1 || args.isMember) return "Low";
  return "Unknown";
}

function fmtServiceDateTime(date?: string | null, slot?: string | null): string {
  if (!date) return "";
  if (!slot) return date;
  return `${date} ${slot}`;
}

/**
 * Build the full custom-field bag for a booking event. Pass it directly
 * into `syncBookingLifecycle({ customFieldsByKey: ... })` or
 * `upsertContact({ customFieldsByKey: ... })`.
 */
export function buildGhlCustomFields(input: MapperInputs): Record<string, string | number | boolean | null | undefined> {
  const b = input.booking;
  const origin = (input.publicOrigin || "https://try.novaracleaning.com").replace(/\/$/, "");

  const totalCents = b.final_charge_cents || b.total_estimate_cents || 0;
  const remainingCents = Math.max(0, totalCents - (b.deposit_cents || 0));
  // Account-wide outstanding for the Payment Status check (per-booking
  // remaining + cancellation/reschedule fees).
  const outstandingCents = remainingCents + (b.cancel_fee_cents || 0) + (b.reschedule_fee_cents || 0);
  const _isCredit = !!b.uses_credit; // reserved for credit-only branch
  const isMember = !!(b.membership_plan && b.membership_plan !== "none");

  // Prefer Stripe-driven aggregates when present; fall back to the
  // bookings-table-sum that send-zapier-webhook always computes.
  const lifetimeCents = input.stripeLifetimeRevenueCents ?? input.lifetimeRevenueCents ?? 0;
  const paidJobCount = input.stripePaidJobCount ?? input.completedBookingCount ?? 0;
  const avgJobValueCents = paidJobCount > 0
    ? Math.round(lifetimeCents / paidJobCount)
    : (b.final_charge_cents || b.total_estimate_cents || 0);

  // 1) / 2) / 3) Contractor fields are right-padded with empty strings
  // when fewer than 3 cleaners are assigned, so GHL doesn't keep stale
  // names from a previous assignment.
  const cleaner = (idx: number): MapperCleaner | undefined => input.cleaners[idx];
  const cleanerName = (idx: number) => cleaner(idx)?.name || "";
  const cleanerPhone = (idx: number) => cleaner(idx)?.phone || "";
  // Pay tier: use the highest tier across assigned cleaners (lead
  // determines the team's posted tier on the contact record). Prefers
  // the explicit pay_tier string; falls back to the legacy hourly rate
  // for un-migrated rows.
  const TIER_RANK: Record<string, number> = { foundation: 1, proven: 2, elite: 3 };
  const topPayTier = input.cleaners.reduce<string | null>((best, c) => {
    const t = String(c.payTier || "").toLowerCase();
    if (!t) return best;
    if (!best) return t;
    return (TIER_RANK[t] || 0) > (TIER_RANK[best] || 0) ? t : best;
  }, null);
  const topPayRate = input.cleaners.reduce(
    (max, c) => (c.payRate && c.payRate > max ? c.payRate : max),
    0,
  );

  // Derived service window for the TEXT fields
  const { start: derivedStart, end: derivedEnd } = deriveServiceTimes(b.time_slot);
  const serviceStart = b.service_start_time || derivedStart || "";
  const serviceEnd = b.service_end_time || derivedEnd || "";

  // LTV projections
  const ltv = projectLtv({
    isMember,
    baseCents: b.base_price_cents,
    totalCents: b.final_charge_cents || b.total_estimate_cents,
    monthlyCents: isMember ? b.base_price_cents : null,
    lifetimeCents: input.lifetimeRevenueCents,
    firstServiceAt: input.firstServiceAt,
    completedCount: input.completedBookingCount,
  });

  // Churn risk
  const risk = churnRisk({
    cancelledCount: input.cancelledBookingCount,
    failedPaymentCount: input.failedPaymentCount,
    completedCount: input.completedBookingCount,
    isMember,
  });

  const map: Record<string, string | number | boolean | null | undefined> = {
    // ─── AGP Tracking Attribution ───────────────────────────────
    utm_source: b.utm_source || "",
    utm_medium: b.utm_medium || "",
    utm_campaign: b.utm_campaign || "",
    utm_content: b.utm_content || "",
    landing_page_source: b.landing_page || "",
    attribution: b.referrer || b.landing_page || "",
    fb_lead_id: b.fbclid || "",

    // ─── Lead Source / Customer Source ──────────────────────────
    // Both fields use closed-vocabulary SINGLE_OPTIONS in GHL.
    // mapLeadSource buckets UTM / clid / channel hints into 9 options.
    // mapCustomerSource picks from the 6 acquisition options
    // (Facebook, Instagram, Advertisment, Google, Referred By Someone,
    // Friend Or Family); blank when no good fit.
    lead_source: mapLeadSource(b.utm_source, b.fbclid, b.gclid, b.booker_source, b.booking_channel),
    customer_source: mapCustomerSource(b.utm_source, b.fbclid, b.gclid, input.referralCode, b.booker_source),
    market: b.city || b.zip_code || "",
    referral_code: input.referralCode || "",
    referral_link: input.referralLink || "",
    referral_name: input.referralName || "",
    referral_revenue_generated: fmtMoney(input.referralRevenueCents),
    referral_credit_issued: fmtMoney(input.referralCreditCents),
    revenue_lost_at_churn: b.status === "cancelled" && (b.cancel_fee_cents !== undefined || (b.final_charge_cents || b.total_estimate_cents))
      ? fmtMoney(Math.max(0, (b.final_charge_cents || b.total_estimate_cents || 0) - (b.cancel_fee_cents || 0)))
      : "",
    // LTV projections — see projectLtv() above. Empty when we have no
    // way to estimate (no history + zero current value).
    project_ltv_in_3_months: fmtMoney(ltv.m3),
    project_ltv_in_6_months: fmtMoney(ltv.m6),
    project_ltv_in_12_months: fmtMoney(ltv.m12),
    // Churn risk SINGLE_OPTIONS (Low / Medium / High / Unknown)
    churn_risk_level: risk,

    // ─── Internal Sales ─────────────────────────────────────────
    csr_name: b.sdr_rep_name || "",
    // Call Type SINGLE_OPTIONS: New Booking | Reschedule |
    // Rebooking / Repeat CX | Recurring / Membership.
    call_type: mapCallType(b.booking_channel, b.booking_number, isMember),
    pay_over_call_: ynBool(
      (b.payment_method || "").toLowerCase().includes("phone")
      || (b.payment_method || "").toLowerCase().includes("verbal"),
    ),
    quoted_price_pretaxfees: fmtMoney(b.base_price_cents),

    // ─── Service & Scheduling ───────────────────────────────────
    cleaning_type: SERVICE_TYPE_LABEL[b.service_type || ""] || "Standard Cleaning",
    service_frequency: mapServiceFrequency(b.membership_plan),
    home_size_range: HOME_SIZE_LABEL[b.home_size_id || ""] || "",
    estimated_sqft: HOME_SIZE_SQFT_MIDPOINT[b.home_size_id || ""] ?? "",
    estimated_duration_hrs: b.estimated_duration_hours ?? "",
    bedrooms: b.bedrooms ?? "",
    bathrooms: b.bathrooms ?? "",
    dwelling_type: DWELLING_LABEL[b.dwelling_type || ""] || b.dwelling_type || "",
    use_client_supplies: "", // no source field today
    service_time__date: fmtServiceDateTime(b.service_date, b.time_slot),
    next_service_date__time: b.status === "completed" ? "" : fmtServiceDateTime(b.service_date, b.time_slot),
    last_service_date__time: input.lastServiceAt
      ? fmtServiceDateTime(input.lastServiceAt.slice(0, 10), null)
      : (b.status === "completed" ? fmtServiceDateTime(b.service_date, b.time_slot) : ""),
    preferred_start_date: fmtIsoDate(b.service_date),
    service_start_time: serviceStart,
    service_end_time: serviceEnd,

    // ─── Property notes ────────────────────────────────────────
    entry__gate_notes: b.access_notes || "",
    job_notes_internal: b.team_notes || b.dispatch_notes || "",

    // ─── Billing & Payments ────────────────────────────────────
    // Payment Status SINGLE_OPTIONS: Current | Past Due | Failed |
    // Collections. Derived from outstanding balance + service date +
    // Stripe failed-payment streak (computed in send-zapier-webhook).
    payment_status: mapPaymentStatusV2({
      status: b.status,
      serviceDateIso: b.service_date,
      outstandingCents,
      hasFailedPaymentRecently: !!input.hasFailedPaymentRecently,
      failedPaymentStreak: input.failedPaymentStreak,
    }),
    deposit_paid: ynBool(
      b.payment_option === "full"
      || (b.payment_option === "deposit" && b.status !== "pending_payment"),
    ),
    deposit_amount_: fmtMoney(b.deposit_cents),
    deposit_type: mapDepositType(b.payment_option, b.deposit_cents, totalCents),
    final_cost_: fmtMoney(b.final_charge_cents || b.total_estimate_cents),
    remaining_balance: fmtMoney(outstandingCents),
    // Discount $: base price - discounted total. Always positive.
    discounted_amount_: fmtMoney(
      Math.max(0, (b.base_price_cents || 0) - (b.total_estimate_cents || 0)),
    ),
    // Discount %: ((base - total) / base) * 100, rounded. TEXT field
    // in GHL so we send "50%" not "50".
    discount_: (() => {
      const base = b.base_price_cents || 0;
      const total = b.total_estimate_cents || 0;
      if (base <= 0 || total >= base) return "";
      const pct = Math.round(((base - total) / base) * 100);
      return `${pct}%`;
    })(),
    // Total Discount Given — NUMERICAL. Running SUM across ALL of
    // this customer's bookings (caller passes the aggregate). Falls
    // back to the current-booking-only discount when no aggregate
    // is passed so the field is never blank.
    total_discount_given: input.allBookingsTotalDiscountCents != null
      ? Math.round(input.allBookingsTotalDiscountCents / 100)
      : Math.max(0, Math.round((((b.base_price_cents || 0) - (b.total_estimate_cents || 0)) / 100))),
    size_adjustment_: "",
    // Platform fee per clean — Novara's cut before paying cleaners.
    platform_fee_per_clean: fmtMoney(b.platform_fee_cents),
    // Average job value — lifetime / paid-job-count weighted average.
    // Always computed (current booking total is the fallback) so the
    // field is never blank for a brand-new customer.
    average_job_value: fmtMoney(avgJobValueCents),
    // Lifetime revenue — running SUM of every successful Stripe
    // charge attributed to this customer. Stripe is the source of
    // truth; bookings-table sum is the fallback.
    lifetime_revenue: fmtMoney(lifetimeCents),
    monthly_subscription_total_: isMember ? fmtMoney(b.base_price_cents) : "",
    // Estimated annual value — members = monthly × 12; one-time =
    // booking total × 3 visits/year as a conservative projection.
    estimated_annual_value: isMember
      ? fmtMoney((b.base_price_cents || 0) * 12)
      : fmtMoney((b.final_charge_cents || b.total_estimate_cents || 0) * 3),
    last_payment_date: input.lastPayment ? fmtIsoDate(input.lastPayment.date) : "",
    last_payment_amount: fmtMoney(input.lastPayment?.amountCents),
    last_invoice_url: b.hosted_invoice_url || "",
    // Payment Link — Stripe Payment Link / hosted invoice URL the
    // customer can click to pay outstanding balance. send-zapier-
    // webhook generates one via stripe.paymentLinks.create and
    // passes it in; we fall back to the hosted invoice URL when
    // already available.
    payment_link: input.paymentLinkUrl || b.hosted_invoice_url || "",
    default_payment_method: input.defaultPaymentMethod || "",
    failed_payment_count: input.failedPaymentCount ?? "",
    // past_due is a CHECKBOX — only send when actually true.
    past_due: (b.status === "pending_payment" && (input.failedPaymentCount ?? 0) > 0) ? "true" : undefined,

    // ─── Stripe IDs ────────────────────────────────────────────
    stripe_customer_id: input.stripeCustomerId || b.customer_id || "",
    stripe_subscription_id: input.stripeSubscriptionId || "",

    // ─── Membership ────────────────────────────────────────────
    // Membership Status SINGLE_OPTIONS: Not Started | Payment Issue
    // | Paused | Canceled | Active | Trialing.
    membership_status: mapMembershipStatus({
      isMember,
      isPaused: !!input.isMemberPaused,
      isTrialing: !!input.isMemberTrialing,
      hasFailedPayment: !!input.hasFailedPaymentRecently,
      isCanceled: !!input.isMemberCanceled,
    }),
    // Novara Glow Plan SINGLE_OPTIONS: Monthly | Bi-Weekly | Weekly
    // (no "None" option — blank for non-members).
    novara_glow_plan: NOVARA_GLOW_PLAN_LABEL[b.membership_plan || ""] || "",
    // Billing Frequency SINGLE_OPTIONS: Per Visit | Monthly |
    // Prepaid Annual.
    billing_frequency: mapBillingFrequency(b.membership_plan),

    // ─── Operations / Dispatch ─────────────────────────────────
    team_size_assigned: b.num_cleaners_assigned ?? input.cleaners.length ?? "",
    // Pay Tier SINGLE_OPTIONS: Foundation ($18/hr) | Proven
    // ($20/hr) | Elite ($22/hr). Uses the team's highest tier.
    assigned_cleaner_pay_tier: mapPayTier(topPayTier ?? topPayRate),
    "1_contractor": cleanerName(0),
    "1_contractor_number": cleanerPhone(0),
    "2_contractor": cleanerName(1),
    "2_contractor_number": cleanerPhone(1),
    "3_contractor": cleanerName(2),
    "3_contractor_number": cleanerPhone(2),

    // ─── Customer journey ──────────────────────────────────────
    manage_service_link: `${origin}/account`,
    cancellation_reason: b.cancel_reason || "",
  };

  return map;
}
