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
  payTier?: string;
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
  /** Number of failed charges for this customer in the last 90 days. */
  failedPaymentCount?: number | null;
  /** Stripe customer id + subscription id for the Glow path. */
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  /** Last-4 / brand of the default card on file. */
  defaultPaymentMethod?: string | null;
  /** Referral metadata. */
  referralCode?: string | null;
  referralLink?: string | null;
  referralRevenueCents?: number | null;
  referralCreditCents?: number | null;
  referralName?: string | null;
  /** Public origin used to build the manage-service link (e.g. https://try.novaracleaning.com). */
  publicOrigin?: string;
}

// ─── Enum maps (must match the SINGLE_OPTIONS values configured in GHL) ──
const SERVICE_TYPE_LABEL: Record<string, string> = {
  standard: "Standard Cleaning",
  deep: "Deep Cleaning",
  moveInOut: "Move In/Out Cleaning",
  combo: "Combo (Deep + Standard)",
  recurring: "Recurring Maintenance",
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

const HOME_SIZE_LABEL: Record<string, string> = {
  "0_999": "0–999",
  "1000_1500": "1,000–1,500",
  "1501_2000": "1,501–2,000",
  "2001_2500": "2,001–2,500",
  "2501_3000": "2,501–3,000",
  "3001_3500": "3,001–3,500",
  "3501_4000": "3,501–4,000",
  "4001_4500": "4,001–4,500",
  "4501_5000": "4,501–5,000",
  "5000_plus": "5,000+",
};

const MEMBERSHIP_PLAN_LABEL: Record<string, string> = {
  none: "None",
  monthly: "Monthly (1 clean/month)",
  biweekly: "Bi-Weekly (2 cleans/month)",
  weekly: "Weekly (4 cleans/month)",
};

const BILLING_FREQUENCY_LABEL: Record<string, string> = {
  none: "One-Time",
  monthly: "Monthly",
  biweekly: "Bi-Weekly",
  weekly: "Weekly",
};

const SERVICE_FREQUENCY_LABEL: Record<string, string> = {
  none: "One-Time",
  monthly: "Monthly",
  biweekly: "Bi-Weekly",
  weekly: "Weekly",
};

function mapPaymentStatus(status?: string | null, paymentOption?: string | null, depositCents?: number | null): string {
  if (status === "completed") return "Paid in Full";
  if (status === "cancelled") return "Refunded";
  if (status === "pending_payment") return "Unpaid";
  if (paymentOption === "full") return "Paid in Full";
  if ((depositCents ?? 0) > 0) return "Deposit Paid";
  return "Unpaid";
}

function mapDepositType(payment_option?: string | null, deposit?: number | null, total?: number | null): string {
  if (payment_option === "full") return "Paid In Full";
  if (!deposit) return "Pay After Service";
  if (deposit === 3900) return "$39 Only";
  if (deposit === 5000) return "$50 Only";
  if (total && Math.abs(deposit / total - 0.5) < 0.05) return "50% Down";
  if (total && Math.abs(deposit / total - 0.25) < 0.05) return "25% Down";
  return "Custom";
}

function mapCallType(booking_channel?: string | null): string {
  const ch = (booking_channel || "").toLowerCase();
  if (ch.includes("phone")) return "Inbound Call";
  if (ch.includes("sales") || ch.includes("admin")) return "Sales Intake";
  return "Online Booking";
}

function fmtIsoDate(d?: string | null): string {
  if (!d) return "";
  try {
    const dt = new Date(d.includes("T") ? d : `${d}T12:00:00`);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toISOString().slice(0, 10);
  } catch { return ""; }
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
  const isCredit = !!b.uses_credit;
  const isMember = !!(b.membership_plan && b.membership_plan !== "none");

  // 1) / 2) / 3) Contractor fields are right-padded with empty strings
  // when fewer than 3 cleaners are assigned, so GHL doesn't keep stale
  // names from a previous assignment.
  const cleaner = (idx: number): MapperCleaner | undefined => input.cleaners[idx];
  const cleanerName = (idx: number) => cleaner(idx)?.name || "";
  const cleanerPhone = (idx: number) => cleaner(idx)?.phone || "";

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
    lead_source: b.utm_source || b.booker_source || (b.booking_channel === "Website" ? "Website" : ""),
    customer_source: b.booker_source || (b.booking_number === 1 ? "New Lead" : "Returning Client"),
    market: b.city || b.zip_code || "",
    referral_code: input.referralCode || "",
    referral_link: input.referralLink || "",
    referral_name: input.referralName || "",
    referral_revenue_generated: fmtMoney(input.referralRevenueCents),
    referral_credit_issued: fmtMoney(input.referralCreditCents),

    // ─── Internal Sales ─────────────────────────────────────────
    csr_name: b.sdr_rep_name || "",
    call_type: mapCallType(b.booking_channel),
    pay_over_call_: ynBool(
      (b.payment_method || "").toLowerCase().includes("phone")
      || (b.payment_method || "").toLowerCase().includes("verbal"),
    ),
    quoted_price_pretaxfees: fmtMoney(b.base_price_cents),

    // ─── Service & Scheduling ───────────────────────────────────
    cleaning_type: SERVICE_TYPE_LABEL[b.service_type || ""] || b.service_type || "",
    service_frequency: SERVICE_FREQUENCY_LABEL[b.membership_plan || "none"] || "One-Time",
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
    service_start_time: b.service_start_time || "",
    service_end_time: b.service_end_time || "",

    // ─── Property notes ────────────────────────────────────────
    entry__gate_notes: b.access_notes || "",
    job_notes_internal: b.team_notes || b.dispatch_notes || "",

    // ─── Billing & Payments ────────────────────────────────────
    payment_status: mapPaymentStatus(b.status, b.payment_option, b.deposit_cents),
    deposit_paid: ynBool(
      b.payment_option === "full"
      || (b.payment_option === "deposit" && b.status !== "pending_payment"),
    ),
    deposit_amount_: fmtMoney(b.deposit_cents),
    deposit_type: mapDepositType(b.payment_option, b.deposit_cents, totalCents),
    final_cost_: fmtMoney(b.final_charge_cents || b.total_estimate_cents),
    remaining_balance: fmtMoney(remainingCents + (b.cancel_fee_cents || 0) + (b.reschedule_fee_cents || 0)),
    // Note: GHL location uses `remaining_balance` as the single source
    // of truth — `outstanding_balance` is not configured there, so we
    // don't bother sending it.
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
    // Numerical (no $). For now equals discounted_amount_ — when an
    // aggregate "across all bookings" view becomes useful we can sum
    // it server-side and pass into MapperInputs.
    total_discount_given: Math.max(0, Math.round((((b.base_price_cents || 0) - (b.total_estimate_cents || 0)) / 100))),
    size_adjustment_: "",
    // Platform fee per clean — what Novara takes off the top before
    // paying cleaners. Stored in cents on the booking row.
    platform_fee_per_clean: fmtMoney(b.platform_fee_cents),
    // Avg job value: lifetime / completed-count. Falls back to the
    // current booking total when no completed history yet so the field
    // is never blank on a brand new customer.
    average_job_value: input.lifetimeRevenueCents && b.booking_number
      ? fmtMoney(Math.round(input.lifetimeRevenueCents / Math.max(1, b.booking_number)))
      : fmtMoney(b.final_charge_cents || b.total_estimate_cents),
    lifetime_revenue: fmtMoney(input.lifetimeRevenueCents ?? (b.final_charge_cents || b.total_estimate_cents || null)),
    monthly_subscription_total_: isMember ? fmtMoney(b.base_price_cents) : "",
    // Estimated annual value: for active members = monthly * 12; for
    // one-time customers = current total * estimated annual visits
    // (3 default = quarterly cadence). Empty until we know enough.
    estimated_annual_value: isMember
      ? fmtMoney((b.base_price_cents || 0) * 12)
      : fmtMoney((b.final_charge_cents || b.total_estimate_cents || 0) * 3),
    last_payment_date: input.lastPayment ? fmtIsoDate(input.lastPayment.date) : "",
    last_payment_amount: fmtMoney(input.lastPayment?.amountCents),
    last_invoice_url: b.hosted_invoice_url || "",
    payment_link: b.hosted_invoice_url || (b.id ? `${origin}/book/checkout?booking_id=${b.id}` : ""),
    default_payment_method: input.defaultPaymentMethod || "",
    failed_payment_count: input.failedPaymentCount ?? "",
    // past_due is a CHECKBOX in GHL — only send when actually true so
    // we don't store a literal "false" string in the checked-options
    // array. Empty/undefined values are filtered out by buildCustomFieldsArray.
    past_due: (b.status === "pending_payment" && (input.failedPaymentCount ?? 0) > 0) ? "true" : undefined,

    // ─── Stripe IDs ────────────────────────────────────────────
    stripe_customer_id: input.stripeCustomerId || b.customer_id || "",
    stripe_subscription_id: input.stripeSubscriptionId || "",

    // ─── Membership ────────────────────────────────────────────
    membership_status: isMember ? "Active" : "None",
    novara_glow_plan: MEMBERSHIP_PLAN_LABEL[b.membership_plan || "none"] || "None",
    billing_frequency: BILLING_FREQUENCY_LABEL[b.membership_plan || "none"] || "One-Time",

    // ─── Operations / Dispatch ─────────────────────────────────
    team_size_assigned: b.num_cleaners_assigned ?? input.cleaners.length ?? "",
    assigned_cleaner_pay_tier: input.cleaners[0]?.payTier || "",
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
