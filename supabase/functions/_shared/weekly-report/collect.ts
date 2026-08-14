// Pull every weekly-report figure from existing tables. Each source is wrapped
// so a missing table, empty period, or failed query becomes "data unavailable"
// rather than a zero or a guess.

import {
  avgMetric,
  missingMetric,
  okMetric,
  wowPct,
  type CityRow,
  type ComparedMetric,
  type Metric,
  type SourceStatus,
  type SpendRow,
  type WeeklySnapshot,
} from "./types.ts";
import { addDays, periodBounds } from "./period.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

type Window = { start: string; end: string; startIso: string; endIso: string };

function win(start: string, end: string, tz: string): Window {
  const b = periodBounds(start, end, tz);
  return { start, end, startIso: b.startIso, endIso: b.endIso };
}

async function tryQuery<T>(
  label: string,
  fn: () => Promise<{ data: T | null; error: { message?: string } | null }>,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    const { data, error } = await fn();
    if (error) return { ok: false, reason: `${label}: ${error.message || "query failed"}` };
    if (data == null) return { ok: false, reason: `${label}: no rows returned` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: `${label}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

type BookingRow = {
  id: string;
  created_at: string;
  status: string | null;
  city: string | null;
  zone_code: string | null;
  zip_code: string | null;
  email: string | null;
  customer_id: string | null;
  total_estimate_cents: number | null;
  final_charge_cents: number | null;
  payment_received_at: string | null;
  completed_at: string | null;
  service_date: string | null;
  utm_source: string | null;
  booking_channel: string | null;
  referral_code: string | null;
  gclid: string | null;
  fbclid: string | null;
  is_same_day: boolean | null;
  service_type: string | null;
  business_account_id: string | null;
  membership_plan: string | null;
  rating: number | null;
  is_recurring: boolean | null;
  frequency: string | null;
};

const VOID = new Set(["abandoned", "pending_payment"]);

async function loadBookings(sb: SB, w: Window): Promise<{ ok: true; rows: BookingRow[] } | { ok: false; reason: string }> {
  const byId = new Map<string, BookingRow>();
  const merge = (rows: BookingRow[] | null) => {
    for (const row of rows || []) byId.set(row.id, row);
  };
  const select =
    "id, created_at, status, city, zone_code, zip_code, email, customer_id, total_estimate_cents, final_charge_cents, payment_received_at, completed_at, service_date, utm_source, booking_channel, referral_code, gclid, fbclid, is_same_day, service_type, business_account_id, membership_plan, rating, is_recurring, frequency";

  const created = await tryQuery("bookings.created", () =>
    sb.from("bookings").select(select).gte("created_at", w.startIso).lt("created_at", w.endIso).limit(5000),
  );
  if (!created.ok) return created;
  merge(created.data as BookingRow[]);

  const completed = await tryQuery("bookings.completed", () =>
    sb.from("bookings").select(select).gte("completed_at", w.startIso).lt("completed_at", w.endIso).limit(5000),
  );
  if (completed.ok) merge(completed.data as BookingRow[]);

  const paid = await tryQuery("bookings.paid", () =>
    sb.from("bookings").select(select).gte("payment_received_at", w.startIso).lt("payment_received_at", w.endIso).limit(5000),
  );
  if (paid.ok) merge(paid.data as BookingRow[]);

  return { ok: true, rows: Array.from(byId.values()) };
}

function inRange(iso: string | null | undefined, w: Window): boolean {
  if (!iso) return false;
  return iso >= w.startIso && iso < w.endIso;
}

function classifySource(b: BookingRow): string {
  if (b.referral_code) return "referral";
  const utm = (b.utm_source || "").toLowerCase();
  if (utm.includes("lsa") || utm.includes("local") || b.gclid) {
    if (utm.includes("lsa") || utm.includes("local services")) return "lsa";
    if (b.gclid || utm.includes("google")) return "google";
  }
  if (b.fbclid || utm.includes("facebook") || utm.includes("fb") || utm.includes("meta") || utm.includes("ig")) {
    return "facebook";
  }
  if (utm.includes("lsa")) return "lsa";
  if ((b.booking_channel || "").toLowerCase().includes("referral")) return "referral";
  if (utm) return utm.slice(0, 24);
  return "organic";
}

async function countTable(
  sb: SB,
  table: string,
  filter: (q: ReturnType<SB["from"]>) => ReturnType<SB["from"]>,
): Promise<Metric> {
  const res = await tryQuery(table, async () => {
    let q = sb.from(table).select("id", { count: "exact", head: true });
    q = filter(q);
    const { count, error } = await q;
    if (error) return { data: null, error };
    return { data: count ?? 0, error: null };
  });
  if (!res.ok) return missingMetric(table, res.reason);
  return okMetric(Number(res.data) || 0, table);
}

async function sumVerified(
  sb: SB,
  w: Window,
  column: string,
): Promise<Metric> {
  const res = await tryQuery("va_verified_metrics", () =>
    sb.from("va_verified_metrics")
      .select(column)
      .gte("work_date", w.start)
      .lte("work_date", w.end)
      .limit(2000),
  );
  if (!res.ok) return missingMetric("va_verified_metrics", res.reason);
  const rows = (res.data as Array<Record<string, number | null>>) || [];
  if (!rows.length) return missingMetric("va_verified_metrics", "no verified VA metrics for this week");
  const nums = rows.map((r) => r[column]).filter((n) => n != null && Number.isFinite(Number(n))) as number[];
  if (!nums.length) return missingMetric("va_verified_metrics", `${column} was null for every VA-day this week`);
  return okMetric(nums.reduce((a, b) => a + Number(b), 0), "va_verified_metrics");
}

async function medianVerified(
  sb: SB,
  w: Window,
  column: string,
): Promise<Metric> {
  const res = await tryQuery("va_verified_metrics", () =>
    sb.from("va_verified_metrics")
      .select(column)
      .gte("work_date", w.start)
      .lte("work_date", w.end)
      .not(column, "is", null)
      .limit(2000),
  );
  if (!res.ok) return missingMetric("va_verified_metrics", res.reason);
  const nums = ((res.data as Array<Record<string, number>>) || [])
    .map((r) => Number(r[column]))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!nums.length) return missingMetric("va_verified_metrics", `no ${column} values this week`);
  const mid = Math.floor(nums.length / 2);
  const med = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return okMetric(med, "va_verified_metrics (median of daily medians)", "seconds");
}

async function snapshotForWindow(sb: SB, w: Window): Promise<{
  metrics: Record<string, Metric>;
  cities: CityRow[];
  ad_spend: SpendRow[];
  sources: SourceStatus[];
}> {
  const sources: SourceStatus[] = [];
  const mark = (id: string, label: string, available: boolean, reason?: string) => {
    sources.push({ id, label, available, reason });
  };

  const bookingsRes = await loadBookings(sb, w);
  mark("bookings", "Bookings", bookingsRes.ok, bookingsRes.ok ? undefined : bookingsRes.reason);
  const rows = bookingsRes.ok ? bookingsRes.rows : [];

  const created = rows.filter((b) => inRange(b.created_at, w) && !VOID.has(String(b.status || "")));
  const completed = rows.filter((b) => inRange(b.completed_at, w) && String(b.status) === "completed");
  const collected = rows.filter((b) => inRange(b.payment_received_at, w));

  const bookedCents = created.reduce((s, b) => s + (Number(b.total_estimate_cents) || 0), 0);
  const collectedCents = collected.reduce(
    (s, b) => s + (Number(b.final_charge_cents) || Number(b.total_estimate_cents) || 0),
    0,
  );

  const quotes = await countTable(sb, "va_quotes", (q) =>
    q.gte("created_at", w.startIso).lt("created_at", w.endIso),
  );
  mark("va_quotes", "Quotes", quotes.available, quotes.unavailable_reason);

  const leads = await countTable(sb, "leads", (q) =>
    q.gte("created_at", w.startIso).lt("created_at", w.endIso),
  );
  mark("leads", "Leads", leads.available, leads.unavailable_reason);

  const inboundVerified = await sumVerified(sb, w, "inbound_leads");
  const respondedVerified = await sumVerified(sb, w, "leads_responded");
  const medianResponse = await medianVerified(sb, w, "median_response_seconds");
  const quotesVerified = await sumVerified(sb, w, "quotes_sent");
  const commercialTouched = await sumVerified(sb, w, "commercial_accounts_touched");
  const walkthroughs = await sumVerified(sb, w, "walkthroughs_booked");
  const callsPlaced = await sumVerified(sb, w, "calls_placed");
  const screens = await sumVerified(sb, w, "phone_screens_completed");
  const hires = await sumVerified(sb, w, "cleaners_activated");
  mark("va_verified_metrics", "VA verified metrics", inboundVerified.available || callsPlaced.available, inboundVerified.unavailable_reason);

  const eod = await tryQuery("va_eod_submissions", () =>
    sb.from("va_eod_submissions")
      .select("id, status, submitted_late, work_date")
      .gte("work_date", w.start)
      .lte("work_date", w.end)
      .limit(2000),
  );
  mark("va_eod_submissions", "VA EOD submissions", eod.ok, eod.ok ? undefined : eod.reason);
  let eodSubmitted = missingMetric("va_eod_submissions", "data unavailable this week");
  let eodOnTime = missingMetric("va_eod_submissions", "data unavailable this week");
  if (eod.ok) {
    const list = (eod.data as Array<{ status: string; submitted_late: boolean | null }>) || [];
    const submitted = list.filter((r) => r.status === "submitted" || r.status === "locked" || r.status === "reviewed");
    eodSubmitted = okMetric(submitted.length, "va_eod_submissions");
    const onTime = submitted.filter((r) => r.submitted_late !== true).length;
    eodOnTime = submitted.length
      ? okMetric((onTime / submitted.length) * 100, "va_eod_submissions", "pct")
      : missingMetric("va_eod_submissions", "no EOD submissions this week to compute on-time %", "pct");
  }

  const members = await tryQuery("membership_credits", () =>
    sb.from("membership_credits").select("id, status, monthly_price_cents, created_at, updated_at").limit(5000),
  );
  mark("membership_credits", "Memberships", members.ok, members.ok ? undefined : members.reason);
  let activeMembers = missingMetric("membership_credits", "data unavailable this week");
  let newEnroll = missingMetric("membership_credits", "data unavailable this week");
  let mrr = missingMetric("membership_credits", "data unavailable this week", "cents");
  if (members.ok) {
    const list = (members.data as Array<{ status: string; monthly_price_cents: number | null; created_at: string }>) || [];
    const active = list.filter((m) => String(m.status).toLowerCase() === "active");
    activeMembers = okMetric(active.length, "membership_credits");
    newEnroll = okMetric(list.filter((m) => inRange(m.created_at, w)).length, "membership_credits");
    mrr = okMetric(active.reduce((s, m) => s + (Number(m.monthly_price_cents) || 0), 0), "membership_credits", "cents");
  }

  const recurring = await tryQuery("customer_recurring_schedules", () =>
    sb.from("customer_recurring_schedules")
      .select("id, active, created_at, updated_at")
      .limit(5000),
  );
  mark("customer_recurring_schedules", "Recurring schedules", recurring.ok, recurring.ok ? undefined : recurring.reason);
  let activeRecurring = missingMetric("customer_recurring_schedules", "data unavailable this week");
  if (recurring.ok) {
    const list = (recurring.data as Array<{ active: boolean }>) || [];
    activeRecurring = okMetric(list.filter((r) => r.active).length, "customer_recurring_schedules");
  }

  const refs = await tryQuery("referrals", () =>
    sb.from("referrals")
      .select("id, status, credit_cents, created_at, redeemed_at, used_at, referred_booking_id")
      .gte("created_at", w.startIso)
      .lt("created_at", w.endIso)
      .limit(5000),
  );
  mark("referrals", "Referrals", refs.ok, refs.ok ? undefined : refs.reason);
  let refsSent = missingMetric("referrals", "data unavailable this week");
  let refsBooked = missingMetric("referrals", "data unavailable this week");
  let refsCredits = missingMetric("referrals", "data unavailable this week", "cents");
  if (refs.ok) {
    const list = (refs.data as Array<{
      created_at: string;
      redeemed_at: string | null;
      used_at: string | null;
      referred_booking_id: string | null;
      credit_cents: number | null;
      status: string;
    }>) || [];
    refsSent = okMetric(list.filter((r) => inRange(r.created_at, w)).length, "referrals");
    refsBooked = okMetric(
      list.filter((r) => r.referred_booking_id && (inRange(r.redeemed_at, w) || inRange(r.used_at, w) || inRange(r.created_at, w))).length,
      "referrals",
    );
    refsCredits = okMetric(
      list.filter((r) => inRange(r.redeemed_at, w) || inRange(r.used_at, w)).reduce((s, r) => s + (Number(r.credit_cents) || 0), 0),
      "referrals",
      "cents",
    );
  }

  const creditCost = await tryQuery("customer_credits", () =>
    sb.from("customer_credits")
      .select("amount_cents, source, created_at, status")
      .gte("created_at", w.startIso)
      .lt("created_at", w.endIso)
      .limit(5000),
  );
  mark("customer_credits", "Customer credits", creditCost.ok, creditCost.ok ? undefined : creditCost.reason);
  let referralCreditCost = missingMetric("customer_credits", "data unavailable this week", "cents");
  if (creditCost.ok) {
    const list = (creditCost.data as Array<{ amount_cents: number | null; source: string | null }>) || [];
    const ref = list.filter((c) => String(c.source || "").toLowerCase().includes("referr"));
    referralCreditCost = okMetric(ref.reduce((s, c) => s + Math.abs(Number(c.amount_cents) || 0), 0), "customer_credits", "cents");
  }

  const qc = await countTable(sb, "qc_issues", (q) =>
    q.gte("created_at", w.startIso).lt("created_at", w.endIso),
  );
  const qcOpen = await countTable(sb, "qc_issues", (q) =>
    q.gte("created_at", w.startIso).lt("created_at", w.endIso).in("status", ["open", "in_progress", "pending"]),
  );
  mark("qc_issues", "QC issues", qc.available, qc.unavailable_reason);

  const reviews = await tryQuery("reviews", () =>
    sb.from("reviews").select("rating, created_at").gte("created_at", w.startIso).lt("created_at", w.endIso).limit(5000),
  );
  mark("reviews", "Reviews", reviews.ok, reviews.ok ? undefined : reviews.reason);
  let ratingHigh = missingMetric("reviews + bookings.rating", "data unavailable this week");
  let ratingLow = missingMetric("reviews + bookings.rating", "data unavailable this week");
  const ratingPool: number[] = [];
  if (reviews.ok) {
    for (const r of (reviews.data as Array<{ rating: number | null }>) || []) {
      if (r.rating != null) ratingPool.push(Number(r.rating));
    }
  }
  for (const b of completed) {
    if (b.rating != null) ratingPool.push(Number(b.rating));
  }
  if (ratingPool.length) {
    ratingHigh = okMetric(ratingPool.filter((n) => n >= 4).length, "reviews + bookings.rating");
    ratingLow = okMetric(ratingPool.filter((n) => n > 0 && n <= 3).length, "reviews + bookings.rating");
  } else if (reviews.ok) {
    ratingHigh = okMetric(0, "reviews + bookings.rating");
    ratingLow = okMetric(0, "reviews + bookings.rating");
  }

  const acct = await countTable(sb, "cleaner_accountability_actions", (q) =>
    q.gte("created_at", w.startIso).lt("created_at", w.endIso),
  );
  mark("cleaner_accountability_actions", "Accountability actions", acct.available, acct.unavailable_reason);

  const scores = await tryQuery("cleaners", () =>
    sb.from("cleaners").select("novara_score, status").eq("status", "active").limit(5000),
  );
  mark("cleaners.novara_score", "Novara Score (current snapshot)", scores.ok, scores.ok ? undefined : scores.reason);
  let novara = missingMetric("cleaners", "data unavailable this week", "score");
  if (scores.ok) {
    const nums = ((scores.data as Array<{ novara_score: number | null }>) || [])
      .map((c) => c.novara_score)
      .filter((n) => n != null && Number.isFinite(Number(n))) as number[];
    novara = nums.length
      ? okMetric(nums.reduce((a, b) => a + Number(b), 0) / nums.length, "cleaners.novara_score (current active avg)", "score")
      : missingMetric("cleaners", "no active cleaners with a Novara Score", "score");
  }

  const spendRes = await tryQuery("pl_ad_spend", () =>
    sb.from("pl_ad_spend").select("platform, spend_cents, leads_calls, booked_jobs, date").gte("date", w.start).lte("date", w.end).limit(2000),
  );
  mark("pl_ad_spend", "Ad spend logs", spendRes.ok, spendRes.ok ? undefined : spendRes.reason);
  const ad_spend: SpendRow[] = [];
  let spendTotal = missingMetric("pl_ad_spend", "data unavailable this week", "cents");
  if (spendRes.ok) {
    const byPlat = new Map<string, SpendRow>();
    let total = 0;
    for (const row of (spendRes.data as Array<{
      platform: string | null;
      spend_cents: number | null;
      leads_calls: number | null;
      booked_jobs: number | null;
    }>) || []) {
      const platform = (row.platform || "unknown").toLowerCase();
      const cur = byPlat.get(platform) || {
        platform,
        spend_cents: 0,
        leads: 0,
        booked_jobs: 0,
        cac_cents: null,
        source: "pl_ad_spend",
      };
      cur.spend_cents += Number(row.spend_cents) || 0;
      cur.leads = (cur.leads || 0) + (Number(row.leads_calls) || 0);
      cur.booked_jobs = (cur.booked_jobs || 0) + (Number(row.booked_jobs) || 0);
      byPlat.set(platform, cur);
      total += Number(row.spend_cents) || 0;
    }
    for (const row of byPlat.values()) {
      row.cac_cents = row.booked_jobs ? Math.round(row.spend_cents / row.booked_jobs) : null;
      ad_spend.push(row);
    }
    spendTotal = okMetric(total, "pl_ad_spend", "cents");
  }

  const sameDay = created.filter((b) => b.is_same_day || String(b.service_type || "").toLowerCase().includes("focused"));
  const commercialCreated = created.filter((b) => b.business_account_id);
  const conversion = quotes.available && quotes.value != null && quotes.value > 0
    ? okMetric((created.length / quotes.value) * 100, "va_quotes → bookings", "pct")
    : quotes.available && quotes.value === 0
      ? missingMetric("va_quotes → bookings", "no quotes sent this week, conversion not computed", "pct")
      : missingMetric("va_quotes", quotes.unavailable_reason || "quotes unavailable", "pct");

  const emails = created.map((b) => (b.email || "").trim().toLowerCase()).filter(Boolean);
  let newCustomers = missingMetric("bookings", "data unavailable this week");
  let repeatRate = missingMetric("bookings", "data unavailable this week", "pct");
  if (bookingsRes.ok) {
    const unique = Array.from(new Set(emails));
    if (!unique.length) {
      newCustomers = okMetric(0, "bookings");
      repeatRate = missingMetric("bookings", "no booked customers this week", "pct");
    } else {
      const prior = await tryQuery("bookings (prior customers)", () =>
        sb.from("bookings")
          .select("email")
          .in("email", unique)
          .lt("created_at", w.startIso)
          .not("status", "in", '("abandoned","pending_payment")')
          .limit(5000),
      );
      if (!prior.ok) {
        newCustomers = missingMetric("bookings", prior.reason);
        repeatRate = missingMetric("bookings", prior.reason, "pct");
      } else {
        const hadPrior = new Set(
          ((prior.data as Array<{ email: string | null }>) || [])
            .map((r) => (r.email || "").trim().toLowerCase())
            .filter(Boolean),
        );
        const newbie = unique.filter((e) => !hadPrior.has(e)).length;
        newCustomers = okMetric(newbie, "bookings (first booking in-period)");
        repeatRate = okMetric(((unique.length - newbie) / unique.length) * 100, "bookings", "pct");
      }
    }
  }

  const bySource: Record<string, number> = {};
  for (const b of created) {
    const src = classifySource(b);
    bySource[src] = (bySource[src] || 0) + 1;
  }

  const citiesMap = new Map<string, CityRow>();
  for (const b of completed.length ? completed : created) {
    const city = (b.city || "Unknown").trim() || "Unknown";
    const cur = citiesMap.get(city) || { city, jobs: 0, revenue_cents: 0, source: "bookings" };
    cur.jobs += 1;
    cur.revenue_cents += Number(b.final_charge_cents) || Number(b.total_estimate_cents) || 0;
    citiesMap.set(city, cur);
  }
  const cities = Array.from(citiesMap.values()).sort((a, b) => b.jobs - a.jobs || b.revenue_cents - a.revenue_cents).slice(0, 12);

  const sla = missingMetric(
    "SLA layer",
    "no dedicated lead-SLA compliance % is stored; median response below is from verified VA metrics when present",
    "pct",
  );

  const reactivations = missingMetric(
    "lifecycle campaigns",
    "we cannot yet tell a reactivation from a normal rebooking",
  );

  const churn = missingMetric(
    "membership_credits",
    "cancellations/pauses are not timestamped as a dedicated event; only active count is stored",
    "pct",
  );

  const metrics: Record<string, Metric> = {
    leads_received: inboundVerified.available ? inboundVerified : leads,
    median_response_seconds: medianResponse,
    sla_compliance_pct: sla,
    quotes_sent: quotes.available ? quotes : quotesVerified,
    bookings_made: bookingsRes.ok ? okMetric(created.length, "bookings") : missingMetric("bookings", bookingsRes.reason),
    revenue_booked_cents: bookingsRes.ok ? okMetric(bookedCents, "bookings.total_estimate_cents", "cents") : missingMetric("bookings", bookingsRes.reason, "cents"),
    revenue_collected_cents: bookingsRes.ok ? okMetric(collectedCents, "bookings.payment_received_at / final_charge_cents", "cents") : missingMetric("bookings", bookingsRes.reason, "cents"),
    conversion_pct: conversion,
    commercial_outreach: commercialTouched,
    walkthroughs_booked: walkthroughs,
    same_day_volume: bookingsRes.ok ? okMetric(sameDay.length, "bookings.is_same_day / focused") : missingMetric("bookings", bookingsRes.reason),
    commercial_bookings: bookingsRes.ok ? okMetric(commercialCreated.length, "bookings.business_account_id") : missingMetric("bookings", bookingsRes.reason),
    jobs_completed: bookingsRes.ok ? okMetric(completed.length, "bookings.status=completed") : missingMetric("bookings", bookingsRes.reason),
    active_members: activeMembers,
    new_enrollments: newEnroll,
    churn_pct: churn,
    mrr_cents: mrr,
    active_recurring_schedules: activeRecurring,
    reactivations,
    repeat_booking_pct: repeatRate,
    reviews_4_5: ratingHigh,
    reviews_1_3: ratingLow,
    qc_cases: qc,
    qc_open: qcOpen,
    new_customers: newCustomers,
    new_from_lsa: okMetric(bySource.lsa || 0, "bookings.utm/gclid"),
    new_from_facebook: okMetric(bySource.facebook || 0, "bookings.utm/fbclid"),
    new_from_referral: okMetric(bySource.referral || 0, "bookings.referral_code"),
    new_from_organic: okMetric(bySource.organic || 0, "bookings (no paid/referral attribution)"),
    referrals_sent: refsSent,
    referrals_booked: refsBooked,
    referral_credits_cents: refsCredits,
    referral_credit_cost_cents: referralCreditCost,
    ad_spend_cents: spendTotal,
    va_calls: callsPlaced,
    va_leads_responded: respondedVerified,
    va_screens: screens,
    va_hires: hires,
    va_eod_submitted: eodSubmitted,
    va_eod_ontime_pct: eodOnTime,
    accountability_actions: acct,
    novara_score_avg: novara,
  };

  return { metrics, cities, ad_spend, sources };
}

const METRIC_META: Array<{ key: string; label: string; section: ComparedMetric["section"]; unit: Metric["unit"] }> = [
  { key: "leads_received", label: "Leads received", section: "sales", unit: "count" },
  { key: "median_response_seconds", label: "Median response (sec)", section: "sales", unit: "seconds" },
  { key: "sla_compliance_pct", label: "SLA compliance %", section: "sales", unit: "pct" },
  { key: "quotes_sent", label: "Quotes sent", section: "sales", unit: "count" },
  { key: "bookings_made", label: "Bookings made", section: "sales", unit: "count" },
  { key: "revenue_booked_cents", label: "Revenue booked", section: "sales", unit: "cents" },
  { key: "revenue_collected_cents", label: "Revenue collected", section: "sales", unit: "cents" },
  { key: "conversion_pct", label: "Quote → booking %", section: "sales", unit: "pct" },
  { key: "commercial_outreach", label: "Commercial accounts touched", section: "sales", unit: "count" },
  { key: "walkthroughs_booked", label: "Walkthroughs booked", section: "sales", unit: "count" },
  { key: "commercial_bookings", label: "Commercial bookings", section: "sales", unit: "count" },
  { key: "same_day_volume", label: "Same-day / focused volume", section: "sales", unit: "count" },
  { key: "jobs_completed", label: "Jobs completed", section: "sales", unit: "count" },
  { key: "active_members", label: "Active members", section: "retention", unit: "count" },
  { key: "new_enrollments", label: "New enrollments", section: "retention", unit: "count" },
  { key: "churn_pct", label: "Churn rate", section: "retention", unit: "pct" },
  { key: "mrr_cents", label: "MRR", section: "retention", unit: "cents" },
  { key: "active_recurring_schedules", label: "Active recurring schedules", section: "retention", unit: "count" },
  { key: "reactivations", label: "Reactivations", section: "retention", unit: "count" },
  { key: "repeat_booking_pct", label: "Repeat-booking rate", section: "retention", unit: "pct" },
  { key: "reviews_4_5", label: "Reviews 4–5★", section: "retention", unit: "count" },
  { key: "reviews_1_3", label: "Reviews 1–3★", section: "retention", unit: "count" },
  { key: "qc_cases", label: "QC cases opened", section: "retention", unit: "count" },
  { key: "qc_open", label: "QC still open", section: "retention", unit: "count" },
  { key: "new_customers", label: "New customers", section: "growth", unit: "count" },
  { key: "new_from_lsa", label: "Attributed LSA bookings", section: "growth", unit: "count" },
  { key: "new_from_facebook", label: "Attributed Facebook bookings", section: "growth", unit: "count" },
  { key: "new_from_referral", label: "Attributed referral bookings", section: "growth", unit: "count" },
  { key: "new_from_organic", label: "Organic / unattributed bookings", section: "growth", unit: "count" },
  { key: "referrals_sent", label: "Referrals sent", section: "growth", unit: "count" },
  { key: "referrals_booked", label: "Referrals booked", section: "growth", unit: "count" },
  { key: "referral_credits_cents", label: "Referral credits vested", section: "growth", unit: "cents" },
  { key: "referral_credit_cost_cents", label: "Referral credit cost", section: "growth", unit: "cents" },
  { key: "ad_spend_cents", label: "Ad spend", section: "growth", unit: "cents" },
  { key: "va_calls", label: "VA calls placed", section: "growth", unit: "count" },
  { key: "va_leads_responded", label: "VA leads responded", section: "growth", unit: "count" },
  { key: "va_screens", label: "Phone screens completed", section: "growth", unit: "count" },
  { key: "va_hires", label: "Cleaners activated", section: "growth", unit: "count" },
  { key: "va_eod_submitted", label: "EOD reports submitted", section: "ops", unit: "count" },
  { key: "va_eod_ontime_pct", label: "EOD on-time %", section: "ops", unit: "pct" },
  { key: "accountability_actions", label: "Accountability actions", section: "ops", unit: "count" },
  { key: "novara_score_avg", label: "Novara Score (active avg)", section: "ops", unit: "score" },
];

export async function collectWeeklySnapshot(
  sb: SB,
  periodStart: string,
  periodEnd: string,
  timezone: string,
): Promise<WeeklySnapshot> {
  const currentW = win(periodStart, periodEnd, timezone);
  const priorStart = addDays(periodStart, -7);
  const priorEnd = addDays(periodEnd, -7);
  const priorW = win(priorStart, priorEnd, timezone);

  const trailingStarts = [1, 2, 3, 4].map((n) => addDays(periodStart, -7 * n));
  const trailingWindows = trailingStarts.map((s) => win(s, addDays(s, 6), timezone));

  const [current, prior, ...trailing] = await Promise.all([
    snapshotForWindow(sb, currentW),
    snapshotForWindow(sb, priorW),
    ...trailingWindows.map((w) => snapshotForWindow(sb, w)),
  ]);

  const compared: ComparedMetric[] = METRIC_META.map((meta) => {
    const cur = current.metrics[meta.key] || missingMetric(meta.key, "not collected", meta.unit);
    const prv = prior.metrics[meta.key] || missingMetric(meta.key, "not collected", meta.unit);
    const trail = avgMetric(
      trailing.map((t) => t.metrics[meta.key] || missingMetric(meta.key, "not collected", meta.unit)),
      meta.key,
      meta.unit,
    );
    return {
      key: meta.key,
      label: meta.label,
      section: meta.section,
      unit: meta.unit,
      current: cur,
      prior: prv,
      trailing4: trail,
      wow_pct: wowPct(cur, prv),
      vs_trailing4_pct: wowPct(cur, trail),
    };
  });

  return {
    period_start: periodStart,
    period_end: periodEnd,
    timezone,
    sources: current.sources,
    metrics: compared,
    cities: current.cities,
    ad_spend: current.ad_spend,
    rating_high: current.metrics.reviews_4_5,
    rating_low: current.metrics.reviews_1_3,
  };
}

export function metricMap(snapshot: WeeklySnapshot): Record<string, ComparedMetric> {
  return Object.fromEntries(snapshot.metrics.map((m) => [m.key, m]));
}
