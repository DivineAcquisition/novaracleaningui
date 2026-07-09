// ─── Source adapters: Supabase rows → Airtable mapper inputs ──────────────────
//
// Pure translation layer. Given a raw row from the Supabase source (the partner
// portal DB), produce the normalized input the mappers expect. Kept free of any
// DB/IO so it's trivially testable; the route + backfill do the querying and
// pass rows in.
//
// These adapters carry the SAME crucial operational data we push to GHL
// (ghl-field-map.ts): lead source, lifecycle, service zone, Stripe customer id,
// locked pay tier, computed pay pool / per-cleaner pay.

import { ENTRY_SOURCE, JOB_SERVICE_TYPE, PAYMENT_STATUS } from "../schema";
import { payPeriodMonday, payPeriodSunday, tierFromPct, TIER_PCT } from "../pay";
import type {
  ClientInput,
  JobInput,
  PayrollRunInput,
} from "../mappers/types";

// Loose row shapes — only the fields we read.
export interface CustomerRow {
  id?: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  analytics_source?: string | null;
  utm_source?: string | null;
  stripe_customer_id?: string | null;
}

export interface CleanerRow {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  pay_tier?: string | null;
  pay_percentage?: number | null;
}

export interface BookingRow {
  id: string;
  booking_number?: number | null;
  status?: string | null;
  service_type?: string | null;
  service_date?: string | null;
  completed_at?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  final_charge_cents?: number | null;
  total_estimate_cents?: number | null;
  cleaner_payout_cents?: number | null;
  num_cleaners_assigned?: number | null;
  booking_channel?: string | null;
  membership_plan?: string | null;
}

const fullName = (first?: string | null, last?: string | null): string =>
  `${first || ""} ${last || ""}`.trim();

/** YYYY-MM-DD in America/New_York (UTC slicing shifts late-evening dates a day forward). */
export function nyDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso; // already a plain date
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ─── Service Zone: map raw city/ZIP → the canonical Airtable choices ─────────
// Choices: Baltimore, Baltimore County, Howard County, Anne Arundel, PG County,
// Montgomery County, DC, Northern VA, Columbia, Other.

const ZONE_BY_CITY: Record<string, string> = {
  baltimore: "Baltimore",
  essex: "Baltimore County", dundalk: "Baltimore County", towson: "Baltimore County",
  parkville: "Baltimore County", catonsville: "Baltimore County", pikesville: "Baltimore County",
  rosedale: "Baltimore County", "middle river": "Baltimore County", "white marsh": "Baltimore County",
  "owings mills": "Baltimore County", randallstown: "Baltimore County", reisterstown: "Baltimore County",
  nottingham: "Baltimore County", "gwynn oak": "Baltimore County", "windsor mill": "Baltimore County",
  columbia: "Columbia",
  "ellicott city": "Howard County", elkridge: "Howard County", jessup: "Howard County",
  savage: "Howard County", clarksville: "Howard County", fulton: "Howard County",
  "glen burnie": "Anne Arundel", annapolis: "Anne Arundel", "severna park": "Anne Arundel",
  pasadena: "Anne Arundel", crofton: "Anne Arundel", edgewater: "Anne Arundel",
  arnold: "Anne Arundel", odenton: "Anne Arundel", millersville: "Anne Arundel",
  severn: "Anne Arundel", hanover: "Anne Arundel", linthicum: "Anne Arundel",
  crownsville: "Anne Arundel", davidsonville: "Anne Arundel", gambrills: "Anne Arundel",
  hyattsville: "PG County", bowie: "PG County", laurel: "PG County", "college park": "PG County",
  greenbelt: "PG County", beltsville: "PG County", lanham: "PG County", landover: "PG County",
  largo: "PG County", "upper marlboro": "PG County", "capitol heights": "PG County",
  suitland: "PG County", "district heights": "PG County", "temple hills": "PG County",
  "oxon hill": "PG County", "fort washington": "PG County", clinton: "PG County",
  riverdale: "PG County", bladensburg: "PG County", "mount rainier": "PG County",
  adelphi: "PG County", cheverly: "PG County", "pg county": "PG County",
  bethesda: "Montgomery County", "silver spring": "Montgomery County", rockville: "Montgomery County",
  gaithersburg: "Montgomery County", germantown: "Montgomery County", "takoma park": "Montgomery County",
  "chevy chase": "Montgomery County", potomac: "Montgomery County", kensington: "Montgomery County",
  wheaton: "Montgomery County", olney: "Montgomery County", burtonsville: "Montgomery County",
  "montgomery village": "Montgomery County", "montgomery county": "Montgomery County",
  washington: "DC", "washington dc": "DC", dc: "DC",
  arlington: "Northern VA", alexandria: "Northern VA", fairfax: "Northern VA",
  "falls church": "Northern VA", mclean: "Northern VA", vienna: "Northern VA",
  springfield: "Northern VA", annandale: "Northern VA", reston: "Northern VA", herndon: "Northern VA",
};

function zoneFromZip(zip: string): string | undefined {
  const n = Number(zip.slice(0, 5));
  if (!Number.isFinite(n) || zip.replace(/\D/g, "").length < 5) return undefined;
  if (n >= 20001 && n <= 20599) return "DC";
  if (n >= 20601 && n <= 20799) return "PG County";
  if (n >= 20810 && n <= 20999) return "Montgomery County";
  if ((n >= 21044 && n <= 21046) || n === 21029) return "Columbia";
  if ((n >= 21041 && n <= 21043) || n === 21075 || n === 21163) return "Howard County";
  if ([21012, 21032, 21035, 21037, 21054, 21060, 21061, 21076, 21077, 21090, 21108, 21113, 21114, 21122, 21140, 21144, 21146, 21401, 21403, 21409].includes(n)) return "Anne Arundel";
  if (n >= 21201 && n <= 21231) return "Baltimore";
  if (n >= 21001 && n <= 21299) return "Baltimore County";
  if (n >= 22001 && n <= 22999) return "Northern VA";
  return undefined;
}

/** Map a raw city / ZIP to one of the canonical Service Zone choices. */
export function serviceZoneFor(city?: string | null, zip?: string | null): string | undefined {
  const c = String(city || "").trim().toLowerCase();
  if (c && ZONE_BY_CITY[c]) return ZONE_BY_CITY[c];
  const z = String(zip || "").trim();
  const byZip = z ? zoneFromZip(z) : undefined;
  if (byZip) return byZip;
  return c || z ? "Other" : undefined;
}

/** Map source lead-source hints to a readable label (loosely mirrors GHL). */
function mapLeadSource(c: CustomerRow): string | undefined {
  const raw = (c.analytics_source || c.utm_source || "").toLowerCase();
  if (!raw) return undefined;
  if (raw.includes("facebook") || raw.includes("fb")) return "Facebook";
  if (raw.includes("insta")) return "Instagram";
  if (raw.includes("google")) return "Google";
  if (raw.includes("referr")) return "Referral";
  return c.analytics_source || c.utm_source || undefined;
}

export function customerToClientInput(c: CustomerRow, extra?: Partial<ClientInput>): ClientInput {
  return {
    email: c.email,
    name: fullName(c.first_name, c.last_name) || c.email,
    type: extra?.type ?? "Residential",
    phone: c.phone || undefined,
    serviceZone: serviceZoneFor(c.city, c.zip),
    leadSource: mapLeadSource(c),
    stripeCustomerId: c.stripe_customer_id || undefined,
    paymentMethodOnFile: c.stripe_customer_id ? "Yes" : "No",
    ...extra,
  };
}

/**
 * Build a ClientInput from a booking's own contact fields. Used as a fallback
 * so a Job always has a Client to link to even when the email isn't present in
 * the `customers` table (e.g. guest/imported bookings). Upserts on email, so it
 * updates the matching customer-derived client rather than duplicating.
 */
export function bookingToClientInput(b: BookingRow): ClientInput | null {
  if (!b.email) return null;
  const isCommercial = String(b.service_type || "").toLowerCase().includes("commercial");
  const completed = String(b.status || "").toLowerCase() === "completed";
  return {
    email: b.email,
    name: fullName(b.first_name, b.last_name) || b.email,
    type: isCommercial ? "Commercial" : "Residential",
    phone: b.phone || undefined,
    serviceZone: serviceZoneFor(b.city, b.zip_code),
    lifecycleStage:
      b.membership_plan && b.membership_plan !== "none"
        ? "Member"
        : completed
          ? "Active"
          : undefined,
  };
}

const SERVICE_TYPE_MAP: Record<string, string> = {
  standard: JOB_SERVICE_TYPE.standard,
  deep: JOB_SERVICE_TYPE.deep,
  moveinout: JOB_SERVICE_TYPE.moveInOut,
  "move-in-out": JOB_SERVICE_TYPE.moveInOut,
  movein: JOB_SERVICE_TYPE.moveInOut,
  recurring: JOB_SERVICE_TYPE.recurring,
  combo: JOB_SERVICE_TYPE.other,
};

export function mapServiceType(serviceType?: string | null, membershipPlan?: string | null): string {
  if (membershipPlan && membershipPlan !== "none") return JOB_SERVICE_TYPE.recurring;
  const key = String(serviceType || "").toLowerCase().replace(/\s+/g, "");
  return SERVICE_TYPE_MAP[key] || SERVICE_TYPE_MAP[String(serviceType || "").toLowerCase()] || JOB_SERVICE_TYPE.standard;
}

export function mapPaymentStatus(bookingStatus?: string | null): string {
  const s = String(bookingStatus || "").toLowerCase();
  if (s === "completed" || s === "paid") return PAYMENT_STATUS.paid;
  if (s === "refunded") return PAYMENT_STATUS.refunded;
  if (s === "cancelled" || s === "failed" || s === "payment_failed") return PAYMENT_STATUS.failed;
  return PAYMENT_STATUS.pending;
}

function mapEntrySource(channel?: string | null): string {
  const c = String(channel || "").toLowerCase();
  if (c.includes("partner") || c.includes("portal")) return ENTRY_SOURCE.portal;
  if (c.includes("admin") || c.includes("manual")) return ENTRY_SOURCE.admin;
  return ENTRY_SOURCE.webhook;
}

/**
 * Build a JobInput from a booking row + the cleaners assigned to it. The locked
 * tier % is the HIGHEST tier across assigned cleaners (mixed-tier rule); pay is
 * computed downstream in syncJob. Pass an authoritative payout (cents) to lock
 * the exact paid amount.
 */
export function bookingToJobInput(
  b: BookingRow,
  cleaners: CleanerRow[] = [],
  opts?: {
    entrySource?: string;
    payPerCleanerCents?: number;
    cleanerPayPoolCents?: number;
    paymentStatus?: string;
    numberOfCleaners?: number;
  },
): JobInput {
  const pcts = cleaners.map((c) =>
    c.pay_percentage != null ? Number(c.pay_percentage) : TIER_PCT[tierFromPct(null)],
  );
  const tierPct = pcts.length
    ? Math.max(...pcts.map((p) => Math.round(p) || TIER_PCT.foundation))
    : TIER_PCT.foundation;
  const customerPaidCents = b.final_charge_cents ?? b.total_estimate_cents ?? 0;
  const numberOfCleaners = Math.max(
    1,
    opts?.numberOfCleaners ?? 0,
    cleaners.length,
    b.num_cleaners_assigned ?? 0,
  );
  const cleanerName = cleaners.map((c) => fullName(c.first_name, c.last_name)).filter(Boolean).join(", ");
  // Completed date in local (Eastern) time — UTC slicing pushes late-night
  // completions onto the next day. Fall back to the scheduled service date.
  const dateCompleted = nyDate(b.completed_at) || nyDate(b.service_date);

  // The booking UUID is the only guaranteed-unique natural key — booking_number
  // is not reliably populated/unique in every environment, so keying on it can
  // collapse distinct jobs onto one record.
  return {
    jobId: b.id,
    dateCompleted,
    serviceType: mapServiceType(b.service_type, b.membership_plan),
    customerPaidCents,
    cleanerName: cleanerName || undefined,
    numberOfCleaners,
    tierPct,
    cleanerPayPoolCents: opts?.cleanerPayPoolCents,
    // Only an explicit, authoritative payroll figure overrides the computed
    // split — the booking's legacy cleaner_payout_cents is noisy/stale (and can
    // exceed the pool on cancelled rows), so we don't default to it here. The
    // Revenue Ops view shows the consistent pool ÷ cleaners split.
    payPerCleanerCents: opts?.payPerCleanerCents,
    paymentStatus: opts?.paymentStatus ?? mapPaymentStatus(b.status),
    entrySource: opts?.entrySource ?? mapEntrySource(b.booking_channel),
    clientEmail: b.email || undefined,
  };
}

// ─── Payroll run aggregation ──────────────────────────────────────────────────
//
// Source `payouts` are per-booking. A Payroll Run is the weekly (Mon–Sun)
// rollup per cleaner. groupPayoutsIntoRuns aggregates raw payout rows into
// PayrollRunInput records keyed by cleaner + pay-period Monday.

export interface PayoutRow {
  id: string;
  cleaner_id: string;
  booking_id?: string | null;
  cleaner_payout_cents: number;
  status?: string | null;
  stripe_transfer_id?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  /** Service date of the linked booking, used to bucket into a pay period. */
  service_date?: string | null;
}

const PAYOUT_STATUS_MAP: Record<string, string> = {
  paid: "Paid",
  completed: "Paid",
  processing: "Processing",
  pending: "Pending",
  failed: "Failed",
};

export function groupPayoutsIntoRuns(
  payouts: PayoutRow[],
  cleanerNameById: Record<string, string>,
): PayrollRunInput[] {
  const runs = new Map<string, PayrollRunInput & { _grossCents: number }>();
  for (const p of payouts) {
    const date = (p.service_date || p.processed_at || p.created_at || "").slice(0, 10);
    if (!date || !p.cleaner_id) continue;
    const monday = payPeriodMonday(date);
    const key = `${p.cleaner_id}_${monday}`;
    let run = runs.get(key);
    if (!run) {
      run = {
        runId: key,
        cleanerName: cleanerNameById[p.cleaner_id] || undefined,
        periodStart: monday,
        periodEnd: payPeriodSunday(monday),
        totalJobs: 0,
        _grossCents: 0,
        paymentMethod: "Stripe",
        status: "Pending",
        stripeTransferId: p.stripe_transfer_id || undefined,
      };
      runs.set(key, run);
    }
    run.totalJobs = (run.totalJobs || 0) + 1;
    run._grossCents += Number(p.cleaner_payout_cents) || 0;
    if (p.stripe_transfer_id && !run.stripeTransferId) run.stripeTransferId = p.stripe_transfer_id;
    // Run is "Paid" only when every payout in it is paid.
    const mapped = PAYOUT_STATUS_MAP[String(p.status || "").toLowerCase()] || "Pending";
    if (mapped !== "Paid") run.status = mapped === "Failed" ? "Failed" : run.status || "Pending";
  }

  return Array.from(runs.values()).map((r) => {
    const grossDollars = Math.round(r._grossCents) / 100;
    return {
      runId: r.runId,
      cleanerName: r.cleanerName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      totalJobs: r.totalJobs,
      grossPay: grossDollars,
      bonus: 0,
      deduction: 0,
      netPay: grossDollars,
      paymentMethod: r.paymentMethod,
      status: r.status,
      stripeTransferId: r.stripeTransferId,
    };
  });
}
