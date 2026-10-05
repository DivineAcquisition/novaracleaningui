// supabase/functions/weekly-report-generate/index.ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// supabase/functions/_shared/app-secrets.ts
var cache = /* @__PURE__ */ new Map();
async function resolveSecret(supabase, name) {
  if (cache.has(name)) return cache.get(name) ?? "";
  let value = "";
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string") {
      value = data.value.trim();
    }
  } catch (err) {
    console.warn(`[app-secrets] DB read failed for ${name}`, err);
  }
  if (!value) {
    value = (Deno.env.get(name) || "").trim();
  }
  cache.set(name, value);
  return value;
}

// supabase/functions/_shared/weekly-report/types.ts
var DEFAULT_SETTINGS = {
  enabled: true,
  timezone: "America/New_York",
  run_weekday: 1,
  run_hour: 8,
  recipients: ["contact@novaracleaning.com", "dispatch@novaracleaning.com"],
  retention_weeks: null,
  max_insights: 8,
  drive_root_folder_id: "1ZyfiAEaqb63DDE3gYfzUsk688i35j4fK",
  drive_folder_name: "NVC WeekLt Report & Forcast"
};
function parseSettings(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  const recipients = Array.isArray(v.recipients) ? v.recipients.map((x) => String(x).trim()).filter(Boolean) : DEFAULT_SETTINGS.recipients;
  return {
    enabled: v.enabled !== false,
    timezone: String(v.timezone || DEFAULT_SETTINGS.timezone),
    run_weekday: clampInt(v.run_weekday, 0, 6, DEFAULT_SETTINGS.run_weekday),
    run_hour: clampInt(v.run_hour, 0, 23, DEFAULT_SETTINGS.run_hour),
    recipients: recipients.length ? recipients : DEFAULT_SETTINGS.recipients,
    retention_weeks: v.retention_weeks == null || v.retention_weeks === "" ? null : clampInt(v.retention_weeks, 1, 520, 52),
    max_insights: clampInt(v.max_insights, 3, 12, DEFAULT_SETTINGS.max_insights),
    drive_root_folder_id: String(v.drive_root_folder_id || DEFAULT_SETTINGS.drive_root_folder_id),
    drive_folder_name: String(v.drive_folder_name || DEFAULT_SETTINGS.drive_folder_name)
  };
}
function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function okMetric(value, source, unit = "count") {
  return { available: true, value, source, unit };
}
function missingMetric(source, reason, unit = "count") {
  return { available: false, value: null, source, unit, unavailable_reason: reason };
}
function wowPct(current, prior) {
  if (!current.available || !prior.available || current.value == null || prior.value == null) return null;
  if (prior.value === 0) return current.value === 0 ? 0 : null;
  return (current.value - prior.value) / Math.abs(prior.value) * 100;
}
function avgMetric(items, source, unit) {
  const nums = items.filter((m) => m.available && m.value != null).map((m) => m.value);
  if (!nums.length) {
    return missingMetric(source, "not enough prior weeks with this source to average", unit);
  }
  return okMetric(nums.reduce((a, b) => a + b, 0) / nums.length, `${source} (trailing ${nums.length}-week avg)`, unit);
}

// supabase/functions/_shared/weekly-report/period.ts
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(iso, days) {
  const d = /* @__PURE__ */ new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}
function tzOffsetMs(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}
function zonedMidnightUtc(dateYmd, timeZone) {
  const noonUtc = /* @__PURE__ */ new Date(`${dateYmd}T12:00:00.000Z`);
  const offset = tzOffsetMs(noonUtc, timeZone);
  return new Date(Date.parse(`${dateYmd}T00:00:00.000Z`) - offset);
}
function periodBounds(startYmd, endYmd, timeZone) {
  const start = zonedMidnightUtc(startYmd, timeZone);
  const end = zonedMidnightUtc(addDays(endYmd, 1), timeZone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
function mondayOnOrBefore(dateYmd) {
  const d = /* @__PURE__ */ new Date(`${dateYmd}T12:00:00.000Z`);
  const dow = d.getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(dateYmd, -back);
}
function priorCompletedWeek(now, timeZone) {
  const local = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const today = `${local.year}-${local.month}-${local.day}`;
  const thisMonday = mondayOnOrBefore(today);
  const start = addDays(thisMonday, -7);
  return { start, end: addDays(start, 6) };
}
function zonedNowParts(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit"
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[parts.weekday] ?? 1,
    hour: Number(parts.hour),
    ymd: `${parts.year}-${parts.month}-${parts.day}`
  };
}
function formatRangeLabel(start, end) {
  const fmt = (iso) => {
    const d = /* @__PURE__ */ new Date(`${iso}T12:00:00.000Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(start)} \u2013 ${fmt(end)}`;
}

// supabase/functions/_shared/weekly-report/collect.ts
function win(start, end, tz) {
  const b = periodBounds(start, end, tz);
  return { start, end, startIso: b.startIso, endIso: b.endIso };
}
async function tryQuery(label, fn) {
  try {
    const { data, error } = await fn();
    if (error) return { ok: false, reason: `${label}: ${error.message || "query failed"}` };
    if (data == null) return { ok: false, reason: `${label}: no rows returned` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: `${label}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
var VOID = /* @__PURE__ */ new Set(["abandoned", "pending_payment"]);
async function loadBookings(sb, w) {
  const byId = /* @__PURE__ */ new Map();
  const merge = (rows) => {
    for (const row of rows || []) byId.set(row.id, row);
  };
  const select = "id, created_at, status, city, zone_code, zip_code, email, customer_id, total_estimate_cents, final_charge_cents, payment_received_at, completed_at, service_date, utm_source, booking_channel, referral_code, gclid, fbclid, is_same_day, service_type, business_account_id, membership_plan, rating, is_recurring, frequency, is_reclean, reclean_assessed_value_cents, cleaner_payout_cents";
  const created = await tryQuery(
    "bookings.created",
    () => sb.from("bookings").select(select).gte("created_at", w.startIso).lt("created_at", w.endIso).limit(5e3)
  );
  if (!created.ok) return created;
  merge(created.data);
  const completed = await tryQuery(
    "bookings.completed",
    () => sb.from("bookings").select(select).gte("completed_at", w.startIso).lt("completed_at", w.endIso).limit(5e3)
  );
  if (completed.ok) merge(completed.data);
  const paid = await tryQuery(
    "bookings.paid",
    () => sb.from("bookings").select(select).gte("payment_received_at", w.startIso).lt("payment_received_at", w.endIso).limit(5e3)
  );
  if (paid.ok) merge(paid.data);
  return { ok: true, rows: Array.from(byId.values()) };
}
function inRange(iso, w) {
  if (!iso) return false;
  return iso >= w.startIso && iso < w.endIso;
}
function classifySource(b) {
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
async function countTable(sb, table, filter) {
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
async function sumVerified(sb, w, column) {
  const res = await tryQuery(
    "va_verified_metrics",
    () => sb.from("va_verified_metrics").select(column).gte("work_date", w.start).lte("work_date", w.end).limit(2e3)
  );
  if (!res.ok) return missingMetric("va_verified_metrics", res.reason);
  const rows = res.data || [];
  if (!rows.length) return missingMetric("va_verified_metrics", "no verified VA metrics for this week");
  const nums = rows.map((r) => r[column]).filter((n) => n != null && Number.isFinite(Number(n)));
  if (!nums.length) return missingMetric("va_verified_metrics", `${column} was null for every VA-day this week`);
  return okMetric(nums.reduce((a, b) => a + Number(b), 0), "va_verified_metrics");
}
async function medianVerified(sb, w, column) {
  const res = await tryQuery(
    "va_verified_metrics",
    () => sb.from("va_verified_metrics").select(column).gte("work_date", w.start).lte("work_date", w.end).not(column, "is", null).limit(2e3)
  );
  if (!res.ok) return missingMetric("va_verified_metrics", res.reason);
  const nums = (res.data || []).map((r) => Number(r[column])).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return missingMetric("va_verified_metrics", `no ${column} values this week`);
  const mid = Math.floor(nums.length / 2);
  const med = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return okMetric(med, "va_verified_metrics (median of daily medians)", "seconds");
}
async function snapshotForWindow(sb, w) {
  const sources = [];
  const mark = (id, label, available, reason) => {
    sources.push({ id, label, available, reason });
  };
  const bookingsRes = await loadBookings(sb, w);
  mark("bookings", "Bookings", bookingsRes.ok, bookingsRes.ok ? void 0 : bookingsRes.reason);
  const rows = bookingsRes.ok ? bookingsRes.rows : [];
  const created = rows.filter((b) => inRange(b.created_at, w) && !VOID.has(String(b.status || "")));
  const completed = rows.filter((b) => inRange(b.completed_at, w) && String(b.status) === "completed");
  const collected = rows.filter((b) => inRange(b.payment_received_at, w));
  const bookedCents = created.reduce((s, b) => s + (Number(b.total_estimate_cents) || 0), 0);
  const collectedCents = collected.reduce(
    (s, b) => s + (Number(b.final_charge_cents) || Number(b.total_estimate_cents) || 0),
    0
  );
  const quotes = await countTable(
    sb,
    "va_quotes",
    (q) => q.gte("created_at", w.startIso).lt("created_at", w.endIso)
  );
  mark("va_quotes", "Quotes", quotes.available, quotes.unavailable_reason);
  const leads = await countTable(
    sb,
    "leads",
    (q) => q.gte("created_at", w.startIso).lt("created_at", w.endIso)
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
  const eod = await tryQuery(
    "va_eod_submissions",
    () => sb.from("va_eod_submissions").select("id, status, submitted_late, work_date").gte("work_date", w.start).lte("work_date", w.end).limit(2e3)
  );
  mark("va_eod_submissions", "VA EOD submissions", eod.ok, eod.ok ? void 0 : eod.reason);
  let eodSubmitted = missingMetric("va_eod_submissions", "data unavailable this week");
  let eodOnTime = missingMetric("va_eod_submissions", "data unavailable this week");
  if (eod.ok) {
    const list = eod.data || [];
    const submitted = list.filter((r) => r.status === "submitted" || r.status === "locked" || r.status === "reviewed");
    eodSubmitted = okMetric(submitted.length, "va_eod_submissions");
    const onTime = submitted.filter((r) => r.submitted_late !== true).length;
    eodOnTime = submitted.length ? okMetric(onTime / submitted.length * 100, "va_eod_submissions", "pct") : missingMetric("va_eod_submissions", "no EOD submissions this week to compute on-time %", "pct");
  }
  const members = await tryQuery(
    "membership_credits",
    () => sb.from("membership_credits").select("id, status, monthly_price_cents, created_at, updated_at").limit(5e3)
  );
  mark("membership_credits", "Memberships", members.ok, members.ok ? void 0 : members.reason);
  let activeMembers = missingMetric("membership_credits", "data unavailable this week");
  let newEnroll = missingMetric("membership_credits", "data unavailable this week");
  let mrr = missingMetric("membership_credits", "data unavailable this week", "cents");
  if (members.ok) {
    const list = members.data || [];
    const active = list.filter((m) => String(m.status).toLowerCase() === "active");
    activeMembers = okMetric(active.length, "membership_credits");
    newEnroll = okMetric(list.filter((m) => inRange(m.created_at, w)).length, "membership_credits");
    mrr = okMetric(active.reduce((s, m) => s + (Number(m.monthly_price_cents) || 0), 0), "membership_credits", "cents");
  }
  const recurring = await tryQuery(
    "customer_recurring_schedules",
    () => sb.from("customer_recurring_schedules").select("id, active, created_at, updated_at").limit(5e3)
  );
  mark("customer_recurring_schedules", "Recurring schedules", recurring.ok, recurring.ok ? void 0 : recurring.reason);
  let activeRecurring = missingMetric("customer_recurring_schedules", "data unavailable this week");
  if (recurring.ok) {
    const list = recurring.data || [];
    activeRecurring = okMetric(list.filter((r) => r.active).length, "customer_recurring_schedules");
  }
  const refs = await tryQuery(
    "referrals",
    () => sb.from("referrals").select("id, status, credit_cents, created_at, redeemed_at, used_at, referred_booking_id").gte("created_at", w.startIso).lt("created_at", w.endIso).limit(5e3)
  );
  mark("referrals", "Referrals", refs.ok, refs.ok ? void 0 : refs.reason);
  let refsSent = missingMetric("referrals", "data unavailable this week");
  let refsBooked = missingMetric("referrals", "data unavailable this week");
  let refsCredits = missingMetric("referrals", "data unavailable this week", "cents");
  if (refs.ok) {
    const list = refs.data || [];
    refsSent = okMetric(list.filter((r) => inRange(r.created_at, w)).length, "referrals");
    refsBooked = okMetric(
      list.filter((r) => r.referred_booking_id && (inRange(r.redeemed_at, w) || inRange(r.used_at, w) || inRange(r.created_at, w))).length,
      "referrals"
    );
    refsCredits = okMetric(
      list.filter((r) => inRange(r.redeemed_at, w) || inRange(r.used_at, w)).reduce((s, r) => s + (Number(r.credit_cents) || 0), 0),
      "referrals",
      "cents"
    );
  }
  const creditCost = await tryQuery(
    "customer_credits",
    () => sb.from("customer_credits").select("amount_cents, source, created_at, status").gte("created_at", w.startIso).lt("created_at", w.endIso).limit(5e3)
  );
  mark("customer_credits", "Customer credits", creditCost.ok, creditCost.ok ? void 0 : creditCost.reason);
  let referralCreditCost = missingMetric("customer_credits", "data unavailable this week", "cents");
  if (creditCost.ok) {
    const list = creditCost.data || [];
    const ref = list.filter((c) => String(c.source || "").toLowerCase().includes("referr"));
    referralCreditCost = okMetric(ref.reduce((s, c) => s + Math.abs(Number(c.amount_cents) || 0), 0), "customer_credits", "cents");
  }
  const qc = await countTable(
    sb,
    "qc_issues",
    (q) => q.gte("created_at", w.startIso).lt("created_at", w.endIso)
  );
  const qcOpen = await countTable(
    sb,
    "qc_issues",
    (q) => q.gte("created_at", w.startIso).lt("created_at", w.endIso).in("status", ["open", "in_progress", "pending"])
  );
  mark("qc_issues", "QC issues", qc.available, qc.unavailable_reason);
  const reviews = await tryQuery(
    "reviews",
    () => sb.from("reviews").select("rating, created_at").gte("created_at", w.startIso).lt("created_at", w.endIso).limit(5e3)
  );
  mark("reviews", "Reviews", reviews.ok, reviews.ok ? void 0 : reviews.reason);
  let ratingHigh = missingMetric("reviews + bookings.rating", "data unavailable this week");
  let ratingLow = missingMetric("reviews + bookings.rating", "data unavailable this week");
  const ratingPool = [];
  if (reviews.ok) {
    for (const r of reviews.data || []) {
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
  const acct = await countTable(
    sb,
    "cleaner_accountability_actions",
    (q) => q.gte("created_at", w.startIso).lt("created_at", w.endIso)
  );
  mark("cleaner_accountability_actions", "Accountability actions", acct.available, acct.unavailable_reason);
  const scores = await tryQuery(
    "cleaners",
    () => sb.from("cleaners").select("novara_score, status").eq("status", "active").limit(5e3)
  );
  mark("cleaners.novara_score", "Novara Score (current snapshot)", scores.ok, scores.ok ? void 0 : scores.reason);
  let novara = missingMetric("cleaners", "data unavailable this week", "score");
  if (scores.ok) {
    const nums = (scores.data || []).map((c) => c.novara_score).filter((n) => n != null && Number.isFinite(Number(n)));
    novara = nums.length ? okMetric(nums.reduce((a, b) => a + Number(b), 0) / nums.length, "cleaners.novara_score (current active avg)", "score") : missingMetric("cleaners", "no active cleaners with a Novara Score", "score");
  }
  const spendRes = await tryQuery(
    "pl_ad_spend",
    () => sb.from("pl_ad_spend").select("platform, spend_cents, leads_calls, booked_jobs, date").gte("date", w.start).lte("date", w.end).limit(2e3)
  );
  mark("pl_ad_spend", "Ad spend logs", spendRes.ok, spendRes.ok ? void 0 : spendRes.reason);
  const ad_spend = [];
  let spendTotal = missingMetric("pl_ad_spend", "data unavailable this week", "cents");
  if (spendRes.ok) {
    const byPlat = /* @__PURE__ */ new Map();
    let total = 0;
    for (const row of spendRes.data || []) {
      const platform = (row.platform || "unknown").toLowerCase();
      const cur = byPlat.get(platform) || {
        platform,
        spend_cents: 0,
        leads: 0,
        booked_jobs: 0,
        cac_cents: null,
        source: "pl_ad_spend"
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
  const conversion = quotes.available && quotes.value != null && quotes.value > 0 ? okMetric(created.length / quotes.value * 100, "va_quotes \u2192 bookings", "pct") : quotes.available && quotes.value === 0 ? missingMetric("va_quotes \u2192 bookings", "no quotes sent this week, conversion not computed", "pct") : missingMetric("va_quotes", quotes.unavailable_reason || "quotes unavailable", "pct");
  const emails = created.map((b) => (b.email || "").trim().toLowerCase()).filter(Boolean);
  let newCustomers = missingMetric("bookings", "data unavailable this week");
  let repeatRate = missingMetric("bookings", "data unavailable this week", "pct");
  if (bookingsRes.ok) {
    const unique = Array.from(new Set(emails));
    if (!unique.length) {
      newCustomers = okMetric(0, "bookings");
      repeatRate = missingMetric("bookings", "no booked customers this week", "pct");
    } else {
      const prior = await tryQuery(
        "bookings (prior customers)",
        () => sb.from("bookings").select("email").in("email", unique).lt("created_at", w.startIso).not("status", "in", '("abandoned","pending_payment")').limit(5e3)
      );
      if (!prior.ok) {
        newCustomers = missingMetric("bookings", prior.reason);
        repeatRate = missingMetric("bookings", prior.reason, "pct");
      } else {
        const hadPrior = new Set(
          (prior.data || []).map((r) => (r.email || "").trim().toLowerCase()).filter(Boolean)
        );
        const newbie = unique.filter((e) => !hadPrior.has(e)).length;
        newCustomers = okMetric(newbie, "bookings (first booking in-period)");
        repeatRate = okMetric((unique.length - newbie) / unique.length * 100, "bookings", "pct");
      }
    }
  }
  const bySource = {};
  for (const b of created) {
    const src = classifySource(b);
    bySource[src] = (bySource[src] || 0) + 1;
  }
  const citiesMap = /* @__PURE__ */ new Map();
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
    "pct"
  );
  const reactivations = missingMetric(
    "lifecycle campaigns",
    "we cannot yet tell a reactivation from a normal rebooking"
  );
  const churn = missingMetric(
    "membership_credits",
    "cancellations/pauses are not timestamped as a dedicated event; only active count is stored",
    "pct"
  );
  const metrics = {
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
    jobs_completed: bookingsRes.ok ? okMetric(completed.filter((b) => !b.is_reclean).length, "bookings.status=completed (excl. re-cleans)") : missingMetric("bookings", bookingsRes.reason),
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
    recleans_completed: bookingsRes.ok ? okMetric(completed.filter((b) => b.is_reclean).length, "bookings.is_reclean") : missingMetric("bookings", bookingsRes.reason),
    reclean_absorbed_cents: bookingsRes.ok ? okMetric(
      completed.filter((b) => b.is_reclean).reduce((s, b) => s + (Number(b.cleaner_payout_cents) || 0), 0),
      "bookings.cleaner_payout_cents on re-cleans (company-absorbed)",
      "cents"
    ) : missingMetric("bookings", bookingsRes.reason, "cents")
  };
  return { metrics, cities, ad_spend, sources };
}
var METRIC_META = [
  { key: "leads_received", label: "Leads received", section: "sales", unit: "count" },
  { key: "median_response_seconds", label: "Median response (sec)", section: "sales", unit: "seconds" },
  { key: "sla_compliance_pct", label: "SLA compliance %", section: "sales", unit: "pct" },
  { key: "quotes_sent", label: "Quotes sent", section: "sales", unit: "count" },
  { key: "bookings_made", label: "Bookings made", section: "sales", unit: "count" },
  { key: "revenue_booked_cents", label: "Revenue booked", section: "sales", unit: "cents" },
  { key: "revenue_collected_cents", label: "Revenue collected", section: "sales", unit: "cents" },
  { key: "conversion_pct", label: "Quote \u2192 booking %", section: "sales", unit: "pct" },
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
  { key: "reviews_4_5", label: "Reviews 4\u20135\u2605", section: "retention", unit: "count" },
  { key: "reviews_1_3", label: "Reviews 1\u20133\u2605", section: "retention", unit: "count" },
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
  { key: "recleans_completed", label: "Re-cleans completed", section: "ops", unit: "count" },
  { key: "reclean_absorbed_cents", label: "Re-clean absorbed cost", section: "ops", unit: "cents" }
];
async function collectWeeklySnapshot(sb, periodStart, periodEnd, timezone) {
  const currentW = win(periodStart, periodEnd, timezone);
  const priorStart = addDays(periodStart, -7);
  const priorEnd = addDays(periodEnd, -7);
  const priorW = win(priorStart, priorEnd, timezone);
  const trailingStarts = [1, 2, 3, 4].map((n) => addDays(periodStart, -7 * n));
  const trailingWindows = trailingStarts.map((s) => win(s, addDays(s, 6), timezone));
  const [current, prior, ...trailing] = await Promise.all([
    snapshotForWindow(sb, currentW),
    snapshotForWindow(sb, priorW),
    ...trailingWindows.map((w) => snapshotForWindow(sb, w))
  ]);
  const compared = METRIC_META.map((meta) => {
    const cur = current.metrics[meta.key] || missingMetric(meta.key, "not collected", meta.unit);
    const prv = prior.metrics[meta.key] || missingMetric(meta.key, "not collected", meta.unit);
    const trail = avgMetric(
      trailing.map((t) => t.metrics[meta.key] || missingMetric(meta.key, "not collected", meta.unit)),
      meta.key,
      meta.unit
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
      vs_trailing4_pct: wowPct(cur, trail)
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
    rating_low: current.metrics.reviews_1_3
  };
}

// supabase/functions/_shared/weekly-report/distribute.ts
import { Resend } from "https://esm.sh/resend@2.0.0";

// supabase/functions/_shared/discord.ts
var NOVARA_VIOLET = 5793266;
async function notifyDiscord(supabase, msg) {
  try {
    const url = (await resolveSecret(supabase, "DISCORD_WEBHOOK_URL")).trim();
    if (!url) return false;
    const roleIds = (await resolveSecret(supabase, "DISCORD_MENTION_ROLE_IDS")).split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    const content = roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(" ") : void 0;
    const allowedMentions = roleIds.length ? { roles: roleIds } : { parse: [] };
    const body = {
      username: msg.username || "Novara Ops",
      content,
      allowed_mentions: allowedMentions,
      embeds: [
        {
          title: msg.title,
          description: msg.description ? msg.description.slice(0, 1800) : void 0,
          color: msg.color ?? NOVARA_VIOLET,
          fields: (msg.fields || []).slice(0, 25),
          footer: { text: "Novara" },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }
      ]
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.warn("[discord] webhook returned", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[discord] post failed", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// supabase/functions/_shared/google-drive.ts
var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
var FOLDER_MIME = "application/vnd.google-apps.folder";
function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToDer(pem) {
  const normalized = pem.replace(/\\n/g, "\n");
  const begin = normalized.indexOf("-----BEGIN");
  const beginEnd = begin >= 0 ? normalized.indexOf("-----", begin + 10) : -1;
  const end = normalized.indexOf("-----END");
  const body = (begin >= 0 && end > begin ? normalized.slice(beginEnd + 5, end) : normalized).replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function driveConfigured() {
  return Boolean(
    Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") && Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")
  );
}
async function getDriveToken(impersonate) {
  const saEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const saKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!saEmail || !saKey) return null;
  const now = Math.floor(Date.now() / 1e3);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(
    new TextEncoder().encode(JSON.stringify({
      iss: saEmail,
      scope: DRIVE_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      ...impersonate ? { sub: impersonate } : {}
    }))
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(saKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`))
  );
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const { access_token } = await res.json().catch(() => ({ access_token: null }));
  return access_token || null;
}
function escapeQuery(v) {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
async function findChild(token, parentId, name, mimeType) {
  const qParts = [
    `'${escapeQuery(parentId)}' in parents`,
    `name = '${escapeQuery(name)}'`,
    "trashed = false"
  ];
  if (mimeType) qParts.push(`mimeType = '${escapeQuery(mimeType)}'`);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", qParts.join(" and "));
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "5");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`drive list failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.files?.[0] || null;
}
async function ensureFolder(token, parentId, name) {
  const existing = await findChild(token, parentId, name, FOLDER_MIME);
  if (existing) return existing.id;
  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
  });
  if (!res.ok) throw new Error(`drive folder create failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const file = await res.json();
  return file.id;
}
async function uploadFile(token, folderId, filename, bytes, mimeType) {
  const boundary = "novara" + crypto.randomUUID();
  const meta = JSON.stringify({ name: filename, parents: [folderId] });
  const head = `--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${meta}\r
--${boundary}\r
Content-Type: ${mimeType}\r
\r
`;
  const tail = `\r
--${boundary}--`;
  const enc = new TextEncoder();
  const headBytes = enc.encode(head);
  const tailBytes = enc.encode(tail);
  const body = new Uint8Array(headBytes.length + bytes.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(bytes, headBytes.length);
  body.set(tailBytes, headBytes.length + bytes.length);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    }
  );
  if (!res.ok) throw new Error(`drive upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const file = await res.json();
  return file.id;
}
async function updateFile(token, fileId, bytes, mimeType) {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
      body: bytes
    }
  );
  if (!res.ok) throw new Error(`drive update failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
async function shareReadableByLink(token, fileId) {
  try {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" })
      }
    );
  } catch {
  }
}
function fileUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// supabase/functions/_shared/weekly-report/pdf.ts
var PAGE_W = 612;
var PAGE_H = 792;
var MARGIN_X = 56;
var CONTENT_W = PAGE_W - MARGIN_X * 2;
var BOTTOM = 64;
var WIN_ANSI = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013]/g, "-"],
  [/\u2212/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2022\u00B7]/g, "-"],
  [/\u00A0/g, " "]
];
function pdfSafe(value) {
  let out = String(value ?? "");
  for (const [pattern, replacement] of WIN_ANSI) out = out.replace(pattern, replacement);
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, "");
}
function money(cents) {
  if (cents == null || !Number.isFinite(cents)) return "unavailable";
  return `$${(cents / 100).toFixed(2)}`;
}
function formatValue(unit, value) {
  if (value == null) return "unavailable";
  if (unit === "cents") return money(value);
  if (unit === "pct") return `${value.toFixed(1)}%`;
  if (unit === "seconds") return value >= 60 ? `${Math.round(value / 60)} min` : `${Math.round(value)} sec`;
  if (unit === "score") return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}
function delta(pct) {
  if (pct == null) return "\u2014";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}
async function buildWeeklyReportPdf(input) {
  const { PDFDocument, StandardFonts, rgb } = await import("https://esm.sh/pdf-lib@1.17.1");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const purple = rgb(0.361, 0.059, 0.996);
  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.42, 0.45, 0.5);
  const muted = rgb(0.55, 0.58, 0.62);
  const rule = rgb(0.9, 0.91, 0.93);
  const wash = rgb(0.955, 0.94, 1);
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 52;
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 52;
  };
  const ensure = (needed) => {
    if (y - needed < BOTTOM) newPage();
  };
  const wrap = (text, size, width, face = font) => {
    const out = [];
    for (const rawLine of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of rawLine.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (face.widthOfTextAtSize(candidate, size) > width && line) {
          out.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      out.push(line);
    }
    return out;
  };
  const draw = (text, x, size, face = font, color = dark) => {
    page.drawText(pdfSafe(text), { x, y, size, font: face, color });
  };
  const paragraph = (text, size = 9.5) => {
    for (const line of wrap(text, size, CONTENT_W)) {
      ensure(size + 4);
      draw(line, MARGIN_X, size);
      y -= size + 4;
    }
  };
  const sectionHeader = (title) => {
    ensure(36);
    y -= 6;
    page.drawRectangle({ x: MARGIN_X, y: y - 4, width: CONTENT_W, height: 18, color: wash });
    page.drawText(title.toUpperCase(), { x: MARGIN_X + 8, y: y + 1, size: 9, font: bold, color: purple });
    y -= 22;
  };
  draw("NOVARA CLEANING", MARGIN_X, 18, bold, purple);
  y -= 20;
  draw("Weekly Sales, Retention & Growth Report", MARGIN_X, 13, bold);
  y -= 16;
  draw(formatRangeLabel(input.snapshot.period_start, input.snapshot.period_end), MARGIN_X, 10, font, gray);
  y -= 12;
  const generated = input.generatedAt.toLocaleString("en-US", {
    timeZone: input.snapshot.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
  draw(`Generated ${generated}  \xB7  comparisons vs prior week and trailing 4-week average`, MARGIN_X, 8, font, muted);
  y -= 18;
  sectionHeader("1. Executive summary");
  paragraph(input.executiveSummary, 10);
  y -= 4;
  const renderTable = (title, rows) => {
    sectionHeader(title);
    ensure(28);
    draw("Metric", MARGIN_X, 7.5, bold, gray);
    draw("This week", MARGIN_X + 210, 7.5, bold, gray);
    draw("Prior week", MARGIN_X + 300, 7.5, bold, gray);
    draw("4-wk avg", MARGIN_X + 390, 7.5, bold, gray);
    draw("WoW", MARGIN_X + 470, 7.5, bold, gray);
    y -= 11;
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.4, color: rule });
    y -= 12;
    for (const row of rows) {
      ensure(16);
      const cur = row.current.available ? formatValue(row.unit, row.current.value) : "unavailable";
      const prior = row.prior.available ? formatValue(row.unit, row.prior.value) : "unavailable";
      const trail = row.trailing4.available ? formatValue(row.unit, row.trailing4.value) : "unavailable";
      draw(row.label.slice(0, 34), MARGIN_X, 8.5);
      draw(cur, MARGIN_X + 210, 8.5, row.current.available ? font : font, row.current.available ? dark : muted);
      draw(prior, MARGIN_X + 300, 8.5, font, row.prior.available ? dark : muted);
      draw(trail, MARGIN_X + 390, 8.5, font, row.trailing4.available ? dark : muted);
      draw(delta(row.wow_pct), MARGIN_X + 470, 8.5);
      y -= 13;
      if (!row.current.available && row.current.unavailable_reason) {
        ensure(12);
        for (const line of wrap(`data unavailable this week \u2014 ${row.current.unavailable_reason}`, 7.5, CONTENT_W)) {
          draw(line, MARGIN_X + 8, 7.5, font, muted);
          y -= 10;
        }
      }
    }
    y -= 4;
  };
  renderTable("2. Sales", input.snapshot.metrics.filter((m) => m.section === "sales"));
  renderTable("3. Retention", input.snapshot.metrics.filter((m) => m.section === "retention"));
  renderTable("4. Growth", input.snapshot.metrics.filter((m) => m.section === "growth"));
  sectionHeader("Zone / city performance (completed jobs, else created)");
  if (!input.snapshot.cities.length) {
    paragraph("data unavailable this week \u2014 no bookings with a city in this window.");
  } else {
    ensure(16);
    draw("City", MARGIN_X, 7.5, bold, gray);
    draw("Jobs", MARGIN_X + 280, 7.5, bold, gray);
    draw("Revenue", MARGIN_X + 360, 7.5, bold, gray);
    y -= 12;
    for (const c of input.snapshot.cities) {
      ensure(14);
      draw(c.city.slice(0, 40), MARGIN_X, 8.5);
      draw(String(c.jobs), MARGIN_X + 280, 8.5);
      draw(money(c.revenue_cents), MARGIN_X + 360, 8.5);
      y -= 12;
    }
    y -= 4;
  }
  sectionHeader("Ad spend & CAC (from ad-spend logs)");
  if (!input.snapshot.ad_spend.length) {
    paragraph("data unavailable this week \u2014 no rows in pl_ad_spend for this period.");
  } else {
    for (const row of input.snapshot.ad_spend) {
      ensure(14);
      const cac = row.cac_cents == null ? "CAC unavailable (no booked_jobs on the log)" : `CAC ${money(row.cac_cents)}`;
      paragraph(`${row.platform}: spend ${money(row.spend_cents)}, leads ${row.leads ?? "\u2014"}, booked ${row.booked_jobs ?? "\u2014"}, ${cac}. Source: pl_ad_spend.`);
    }
  }
  renderTable("Cleaner / VA ops", input.snapshot.metrics.filter((m) => m.section === "ops"));
  sectionHeader("5. Insight & analysis");
  paragraph("Each item is a hypothesis grounded in the numbers above. Nothing here changes budgets, zones, or pricing.");
  y -= 2;
  if (!input.insights.length) {
    paragraph("No material week-over-week movements met the insight threshold.");
  } else {
    input.insights.forEach((ins, i) => {
      ensure(48);
      draw(`${i + 1}. ${ins.observation}`, MARGIN_X, 9.5, bold);
      y -= 13;
      paragraph(`${ins.numbers} \u2014 ${ins.hypothesis}`, 9);
      y -= 4;
    });
  }
  sectionHeader("6. Watch list");
  if (!input.watchList.length) {
    paragraph("No items carried forward.");
  } else {
    input.watchList.forEach((item, i) => {
      paragraph(`${i + 1}. ${item}`, 9.5);
    });
  }
  sectionHeader("Sources & model");
  const missing = input.snapshot.sources.filter((s) => !s.available);
  if (missing.length) {
    paragraph(`Unavailable this week: ${missing.map((s) => `${s.label} (${s.reason})`).join("; ")}`);
  } else {
    paragraph("All configured sources returned data for this window.");
  }
  paragraph(`Insight model: ${input.model} (${input.modelVersion}). This report is read-only output.`);
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    const label = `Novara Cleaning  |  Weekly Sales, Retention & Growth  |  page ${idx + 1} of ${pages.length}  |  ${pdfSafe(input.model)}`;
    p.drawLine({ start: { x: MARGIN_X, y: 42 }, end: { x: PAGE_W - MARGIN_X, y: 42 }, thickness: 0.5, color: rule });
    p.drawText(label, { x: MARGIN_X, y: 28, size: 7, font, color: muted });
  });
  return pdf.save();
}
function reportFilename(periodStart) {
  return `${periodStart} - Weekly Report.pdf`;
}
function reportPath(periodStart, periodEnd) {
  const year = periodStart.slice(0, 4);
  return `${year}/${periodStart}_${periodEnd}.pdf`;
}

// supabase/functions/_shared/weekly-report/distribute.ts
async function mirrorWeeklyPdfToDrive(sb, settings, periodStart, bytes) {
  try {
    if (!driveConfigured()) return { ok: false, skipped: "service_account_not_configured" };
    const rootFolderId = await resolveSecret(sb, "GDRIVE_WEEKLY_REPORT_ROOT_FOLDER_ID") || settings.drive_root_folder_id;
    if (!rootFolderId) return { ok: false, skipped: "root_folder_not_configured" };
    const impersonate = await resolveSecret(sb, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
    const token = await getDriveToken(impersonate || void 0);
    if (!token) return { ok: false, error: "Could not mint a Drive token." };
    const yearFolder = await ensureFolder(token, rootFolderId, periodStart.slice(0, 4));
    const filename = reportFilename(periodStart);
    const existing = await findChild(token, yearFolder, filename, "application/pdf");
    let fileId;
    if (existing) {
      await updateFile(token, existing.id, bytes, "application/pdf");
      fileId = existing.id;
    } else {
      fileId = await uploadFile(token, yearFolder, filename, bytes, "application/pdf");
    }
    await shareReadableByLink(token, fileId);
    return { ok: true, fileId, url: fileUrl(fileId), folderId: yearFolder };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function syncWeeklyReportToAirtable(sb, row) {
  try {
    const apiKey = await resolveSecret(sb, "AIRTABLE_API_KEY") || await resolveSecret(sb, "AIRTABLE_PAT");
    const baseId = await resolveSecret(sb, "AIRTABLE_BASE_ID") || await resolveSecret(sb, "AIRTABLE_REVENUE_OPS_BASE_ID");
    const table = await resolveSecret(sb, "AIRTABLE_WEEKLY_REPORTS_TABLE") || "Weekly Reports";
    if (!apiKey || !baseId) return { ok: false, reason: "Airtable credentials not configured" };
    const fields = {
      "Period Start": row.period_start,
      "Period End": row.period_end,
      "Status": row.status,
      "Executive Summary": row.executive_summary,
      "Insight Model": row.insight_model,
      "Drive URL": row.drive_url,
      "Generated At": row.generated_at
    };
    const clean = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== void 0 && v !== null && v !== "") clean[k] = v;
    }
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ["Period Start"] },
        typecast: true,
        records: [{ fields: clean }]
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Airtable ${res.status}: ${body.slice(0, 220)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
async function notifyWeeklyReport(sb, kind, settings, payload) {
  const range = formatRangeLabel(payload.periodStart, payload.periodEnd);
  const title = kind === "ready" ? `Weekly report ready \u2014 ${range}` : `Weekly report FAILED \u2014 ${range}`;
  const description = kind === "ready" ? (payload.summary || "The weekly sales, retention & growth PDF is ready.") + (payload.driveUrl ? `
${payload.driveUrl}` : "") : `Generation failed: ${payload.error || "unknown error"}. The function will retry; this is not silent.`;
  await notifyDiscord(sb, {
    title,
    description,
    color: kind === "ready" ? 5793266 : 12597547,
    fields: payload.driveUrl ? [{ name: "Drive", value: payload.driveUrl, inline: false }] : void 0
  });
  try {
    await sb.from("events").insert({
      event_type: kind === "ready" ? "weekly.report.ready" : "weekly.report.failed",
      source: "weekly-report-generate",
      summary: title,
      data: payload
    });
  } catch {
  }
  const apiKey = await resolveSecret(sb, "RESEND_API_KEY");
  if (!apiKey || !settings.recipients.length) return;
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: settings.recipients,
      subject: title,
      html: `<p>${description.replace(/\n/g, "<br/>")}</p>
             <p style="color:#64748b;font-size:12px">This report is read-only. It does not change budgets, zones, or pricing.</p>`
    });
  } catch (err) {
    console.warn("[weekly-report] email failed", err instanceof Error ? err.message : String(err));
  }
}

// supabase/functions/_shared/weekly-report/insights.ts
var HYPOTHESIS_RE = /\b(may|might|could|worth checking|suggests?|unclear|possible)\b/i;
function fmtMetricValue(unit, value) {
  if (value == null) return "unavailable";
  if (unit === "cents") return `$${(value / 100).toFixed(2)}`;
  if (unit === "pct") return `${value.toFixed(1)}%`;
  if (unit === "seconds") {
    if (value >= 60) return `${Math.round(value / 60)} min`;
    return `${Math.round(value)} sec`;
  }
  if (unit === "score") return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}
function compactSnapshot(snapshot) {
  return {
    period: formatRangeLabel(snapshot.period_start, snapshot.period_end),
    timezone: snapshot.timezone,
    unavailable: snapshot.sources.filter((s) => !s.available).map((s) => ({
      id: s.id,
      reason: s.reason
    })),
    metrics: snapshot.metrics.map((m) => ({
      key: m.key,
      label: m.label,
      section: m.section,
      current: m.current.available ? fmtMetricValue(m.unit, m.current.value) : `UNAVAILABLE (${m.current.unavailable_reason})`,
      prior: m.prior.available ? fmtMetricValue(m.unit, m.prior.value) : "UNAVAILABLE",
      trailing4: m.trailing4.available ? fmtMetricValue(m.unit, m.trailing4.value) : "UNAVAILABLE",
      wow_pct: m.wow_pct == null ? null : Math.round(m.wow_pct * 10) / 10,
      source: m.current.source
    })),
    cities: snapshot.cities,
    ad_spend: snapshot.ad_spend
  };
}
function citationOk(insight, haystack) {
  const blob = `${insight.observation} ${insight.numbers}`.toLowerCase();
  if (!insight.numbers || !/\d/.test(insight.numbers)) return false;
  if (!HYPOTHESIS_RE.test(insight.hypothesis || "")) return false;
  const nums = insight.numbers.match(/-?\d+(?:\.\d+)?/g) || [];
  return nums.some((n) => haystack.includes(n));
}
function deterministicInsights(snapshot, max, priorWatch) {
  const ranked = snapshot.metrics.filter((m) => m.current.available && m.wow_pct != null && Math.abs(m.wow_pct) >= 8).sort((a, b) => {
    const mag = Math.abs(b.wow_pct || 0) - Math.abs(a.wow_pct || 0);
    const rev = (b.unit === "cents" ? 1 : 0) - (a.unit === "cents" ? 1 : 0);
    return mag || rev;
  }).slice(0, max);
  const insights = ranked.map((m) => {
    const cur = fmtMetricValue(m.unit, m.current.value);
    const prior = fmtMetricValue(m.unit, m.prior.value);
    const dir = (m.wow_pct || 0) > 0 ? "rose" : "fell";
    const trail = m.trailing4.available ? ` trailing 4-week average ${fmtMetricValue(m.unit, m.trailing4.value)}` : " trailing 4-week average unavailable";
    return {
      observation: `${m.label} ${dir} ${Math.abs(m.wow_pct || 0).toFixed(0)}% week over week.`,
      numbers: `${m.label} ${cur} this week vs ${prior} prior week (${m.current.source});${trail}.`,
      hypothesis: m.prior.available ? `Cause is unclear from available data \u2014 worth checking whether volume, coverage, or spend around ${m.label.toLowerCase()} changed.` : `Cause is unclear from available data.`,
      watch: Math.abs(m.wow_pct || 0) >= 20
    };
  });
  const byKey = Object.fromEntries(snapshot.metrics.map((m) => [m.key, m]));
  const booked = byKey.revenue_booked_cents;
  const collected = byKey.revenue_collected_cents;
  const bookings = byKey.bookings_made;
  const leads = byKey.leads_received;
  const summaryBits = [
    bookings?.current.available ? `${fmtMetricValue("count", bookings.current.value)} bookings` : null,
    booked?.current.available ? `${fmtMetricValue("cents", booked.current.value)} booked` : null,
    collected?.current.available ? `${fmtMetricValue("cents", collected.current.value)} collected` : null,
    leads?.current.available ? `${fmtMetricValue("count", leads.current.value)} leads` : null
  ].filter(Boolean);
  const wowLine = booked?.wow_pct != null ? ` Booked revenue ${booked.wow_pct >= 0 ? "up" : "down"} ${Math.abs(booked.wow_pct).toFixed(0)}% vs the prior week.` : "";
  const top = insights[0];
  const executive_summary = summaryBits.length ? `Week of ${formatRangeLabel(snapshot.period_start, snapshot.period_end)}: ${summaryBits.join(", ")}.${wowLine}${top ? ` Most material movement: ${top.observation}` : ""} Missing sources are listed as unavailable rather than zero.` : `Week of ${formatRangeLabel(snapshot.period_start, snapshot.period_end)} produced too few available metrics for a numeric headline. See unavailable sources in the body.`;
  const watch_list = [
    ...insights.filter((i) => i.watch).map((i) => i.observation),
    ...priorWatch.slice(0, 4)
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 8);
  return {
    executive_summary,
    insights,
    watch_list,
    model: "deterministic-fallback",
    model_version: "weekly-report-v1"
  };
}
async function callOpenAI(apiKey, model, system, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    })
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `OpenAI ${res.status}: ${text.slice(0, 400)}` };
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "OpenAI envelope not JSON" };
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) return { ok: false, error: "OpenAI returned no content" };
  try {
    return { ok: true, analysis: JSON.parse(content) };
  } catch {
    return { ok: false, error: "OpenAI content not JSON" };
  }
}
async function callAnthropic(apiKey, model, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2200,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `Anthropic ${res.status}: ${text.slice(0, 400)}` };
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "Anthropic envelope not JSON" };
  }
  const content = body?.content?.[0]?.text;
  if (!content) return { ok: false, error: "Anthropic returned no content" };
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    return { ok: true, analysis: JSON.parse(cleaned) };
  } catch {
    return { ok: false, error: "Anthropic content not JSON" };
  }
}
async function generateInsights(sb, snapshot, opts) {
  const fallback = deterministicInsights(snapshot, opts.maxInsights, opts.priorWatch);
  const compact = compactSnapshot(snapshot);
  const haystack = JSON.stringify(compact).toLowerCase();
  const providerRaw = (await resolveSecret(sb, "LLM_PROVIDER") || "anthropic").toLowerCase();
  const provider = providerRaw === "openai" ? "openai" : "anthropic";
  const apiKey = await resolveSecret(sb, provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");
  const model = await resolveSecret(sb, provider === "openai" ? "LLM_MODEL_OPENAI" : "LLM_MODEL_ANTHROPIC") || (provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5");
  if (!apiKey) {
    return { ...fallback, model: `${fallback.model} (no ${provider} key)` };
  }
  const system = `You write the Insight & Analysis section of Novara Cleaning's weekly internal report.
Rules (non-negotiable):
- Use ONLY the JSON data in the user message. Never invent a metric, cause, or dollar amount.
- Every insight is an object: {observation, numbers, hypothesis, watch}.
- "numbers" must quote the actual figures and their source field from the JSON.
- hypothesis must use hedging ("may", "worth checking", "could suggest", "cause unclear from available data"). Never "you must" or "this proves".
- If the data shows a change but not a cause, say cause is unclear from available data.
- Prefer week-over-week and trailing-4-week comparisons. Skip tiny noise.
- Maximum ${opts.maxInsights} insights, ranked by magnitude and revenue relevance.
- Do not mention unavailable metrics except to say they were unavailable.
- The report never takes action; it only informs.
Return JSON: { "executive_summary": "3-5 sentences", "insights": [...], "watch_list": ["short items for next week"] }`;
  const user = `PERIOD ${compact.period}
PRIOR WATCH LIST ${JSON.stringify(opts.priorWatch)}
DATA ${JSON.stringify(compact)}`;
  const llm = provider === "anthropic" ? await callAnthropic(apiKey, model, system, user) : await callOpenAI(apiKey, model, system, user);
  if (!llm.ok) {
    return { ...fallback, model: `${model} failed \u2192 ${fallback.model}`, model_version: llm.error.slice(0, 180) };
  }
  const analysis = llm.analysis;
  const cleaned = (Array.isArray(analysis.insights) ? analysis.insights : []).map((raw) => ({
    observation: String(raw?.observation || "").trim(),
    numbers: String(raw?.numbers || "").trim(),
    hypothesis: String(raw?.hypothesis || "").trim(),
    watch: Boolean(raw?.watch)
  })).filter((i) => i.observation && citationOk(i, haystack)).slice(0, opts.maxInsights);
  const insights = cleaned.length ? cleaned : fallback.insights;
  const executive_summary = String(analysis.executive_summary || "").trim() || fallback.executive_summary;
  const watch_list = [
    ...Array.isArray(analysis.watch_list) ? analysis.watch_list.map((s) => String(s).trim()).filter(Boolean) : [],
    ...insights.filter((i) => i.watch).map((i) => i.observation),
    ...opts.priorWatch
  ].filter((v, i, arr) => v && arr.indexOf(v) === i).slice(0, 8);
  return {
    executive_summary: executive_summary.slice(0, 1200),
    insights,
    watch_list,
    model,
    model_version: provider
  };
}

// supabase/functions/weekly-report-generate/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var BUCKET = "weekly-reports";
var MAX_ATTEMPTS = 5;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "Content-Type": "application/json" },
    status
  });
}
async function authorize(req, sb) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (token && serviceKey && token === serviceKey) return { ok: true, cron: true };
  const cronSecret = req.headers.get("x-cron-secret") || "";
  if (cronSecret) {
    const expected = (await resolveSecret(sb, "CRON_SECRET")).trim();
    if (expected && cronSecret === expected) return { ok: true, cron: true };
  }
  if (!token) return { ok: false };
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user?.id) return { ok: false };
  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r) => r.role === "admin");
  return allowed ? { ok: true, userId: u.user.id } : { ok: false };
}
async function loadSettings(sb) {
  const { data } = await sb.from("app_settings").select("value").eq("key", "weekly_report_settings").maybeSingle();
  return parseSettings(data?.value);
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const auth = await authorize(req, sb);
  if (!auth.ok) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const action = body.action || (body.source === "pg_cron" ? "tick" : "generate");
  try {
    if (action === "get_settings") {
      return json({ ok: true, settings: await loadSettings(sb), defaults: DEFAULT_SETTINGS });
    }
    if (action === "save_settings") {
      if (auth.cron) return json({ error: "Settings changes must come from an admin session." }, 403);
      const next = parseSettings(body.settings);
      await sb.from("app_settings").upsert({
        key: "weekly_report_settings",
        value: next,
        updated_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_by: auth.userId || null
      }, { onConflict: "key" });
      if (next.drive_root_folder_id) {
        await sb.from("app_secrets").upsert({
          key: "GDRIVE_WEEKLY_REPORT_ROOT_FOLDER_ID",
          value: next.drive_root_folder_id,
          description: "Google Drive folder for weekly report PDFs (NVC WeekLt Report & Forcast)."
        }, { onConflict: "key" });
      }
      return json({ ok: true, settings: next });
    }
    const settings = await loadSettings(sb);
    const now = /* @__PURE__ */ new Date();
    if (action === "tick") {
      const parts = zonedNowParts(now, settings.timezone);
      const due = settings.enabled && parts.weekday === settings.run_weekday && parts.hour === settings.run_hour;
      const results = [];
      if (due) {
        const week2 = priorCompletedWeek(now, settings.timezone);
        results.push(await generateForPeriod(sb, settings, week2.start, week2.end, "scheduled", false, auth.userId));
      }
      results.push(...await retryPending(sb, settings));
      return json({ ok: true, due, results });
    }
    if (action === "retry") {
      const retried = await retryPending(sb, settings);
      return json({ ok: true, retried });
    }
    const week = body.periodStart && body.periodEnd ? { start: body.periodStart, end: body.periodEnd } : priorCompletedWeek(now, settings.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week.start) || !/^\d{4}-\d{2}-\d{2}$/.test(week.end)) {
      return json({ error: "periodStart/periodEnd must be YYYY-MM-DD" }, 400);
    }
    const result = await generateForPeriod(
      sb,
      settings,
      week.start,
      week.end,
      auth.cron ? "scheduled" : "on_demand",
      Boolean(body.force),
      auth.userId
    );
    return json(result);
  } catch (err) {
    console.error("[weekly-report-generate]", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
async function retryPending(sb, settings) {
  const { data } = await sb.from("weekly_reports").select("period_start, period_end, status, pdf_attempts").in("status", ["failed", "drive_pending"]).lt("pdf_attempts", MAX_ATTEMPTS).order("updated_at", { ascending: true }).limit(5);
  const rows = data || [];
  const out = [];
  for (const row of rows) {
    out.push(await generateForPeriod(sb, settings, row.period_start, row.period_end, "retry", true));
  }
  return out;
}
async function generateForPeriod(sb, settings, periodStart, periodEnd, trigger, force, userId) {
  const { data: existing } = await sb.from("weekly_reports").select("*").eq("period_start", periodStart).eq("period_end", periodEnd).maybeSingle();
  if (existing?.status === "generated" && existing?.pdf_status === "generated" && !force) {
    return { ok: true, skipped: "already_generated", id: existing.id, driveUrl: existing.drive_url };
  }
  const alreadyNotified = Boolean(existing?.notified_at);
  const resendNotice = force && trigger === "on_demand";
  if (alreadyNotified && !resendNotice && trigger !== "retry") {
    return { ok: true, skipped: "already_notified", id: existing.id, status: existing.status };
  }
  if (alreadyNotified && trigger === "retry" && Number(existing?.pdf_attempts || 0) >= MAX_ATTEMPTS) {
    return { ok: true, skipped: "retry_limit", id: existing.id, status: existing.status };
  }
  const attempts = Number(existing?.pdf_attempts || 0) + 1;
  const upsertBase = {
    period_start: periodStart,
    period_end: periodEnd,
    status: "generating",
    trigger,
    pdf_attempts: attempts,
    generated_by: userId || null
  };
  const { data: row, error: upErr } = await sb.from("weekly_reports").upsert(upsertBase, { onConflict: "period_start,period_end" }).select("id").maybeSingle();
  if (upErr) throw new Error(`Could not claim report row: ${upErr.message}`);
  const id = row?.id || existing?.id;
  try {
    const snapshot = await collectWeeklySnapshot(sb, periodStart, periodEnd, settings.timezone);
    const priorWatch = await loadPriorWatch(sb, periodStart);
    const insight = await generateInsights(sb, snapshot, {
      maxInsights: settings.max_insights,
      priorWatch
    });
    const bytes = await buildWeeklyReportPdf({
      snapshot,
      executiveSummary: insight.executive_summary,
      insights: insight.insights,
      watchList: insight.watch_list,
      model: insight.model,
      modelVersion: insight.model_version,
      generatedAt: /* @__PURE__ */ new Date()
    });
    const path = reportPath(periodStart, periodEnd);
    const { error: storErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true
    });
    if (storErr) throw new Error(`Storage upload failed: ${storErr.message}`);
    const drive = await mirrorWeeklyPdfToDrive(sb, settings, periodStart, bytes);
    const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const status = drive.ok ? "generated" : "drive_pending";
    const pdfStatus = drive.ok ? "generated" : "drive_pending";
    await sb.from("weekly_reports").update({
      status,
      pdf_status: pdfStatus,
      pdf_path: path,
      pdf_generated_at: generatedAt,
      pdf_last_error: drive.ok ? null : drive.error || drive.skipped || "drive mirror failed",
      drive_file_id: drive.fileId || null,
      drive_url: drive.url || null,
      drive_folder_id: drive.folderId || null,
      metrics: snapshot,
      unavailable_sources: snapshot.sources.filter((s) => !s.available).map((s) => s.id),
      insights: insight.insights,
      watch_list: insight.watch_list,
      executive_summary: insight.executive_summary,
      insight_model: insight.model,
      insight_model_version: insight.model_version,
      generated_at: generatedAt
    }).eq("id", id);
    const airtable = await syncWeeklyReportToAirtable(sb, {
      period_start: periodStart,
      period_end: periodEnd,
      status,
      executive_summary: insight.executive_summary,
      insight_model: insight.model,
      drive_url: drive.url || null,
      pdf_path: path,
      generated_at: generatedAt
    });
    if (!alreadyNotified || resendNotice) {
      await notifyWeeklyReport(sb, "ready", settings, {
        periodStart,
        periodEnd,
        driveUrl: drive.url,
        summary: insight.executive_summary
      });
      await sb.from("weekly_reports").update({ notified_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
    }
    return {
      ok: true,
      id,
      status,
      driveUrl: drive.url || null,
      driveError: drive.ok ? void 0 : drive.error || drive.skipped,
      airtable,
      model: insight.model,
      path
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb.from("weekly_reports").update({
      status: "failed",
      pdf_status: "failed",
      pdf_last_error: message.slice(0, 500),
      pdf_attempts: attempts
    }).eq("id", id);
    if (!existing?.failure_notified_at) {
      await notifyWeeklyReport(sb, "failed", settings, {
        periodStart,
        periodEnd,
        error: message
      });
      await sb.from("weekly_reports").update({ failure_notified_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
    }
    return { ok: false, id, error: message, attempts };
  }
}
async function loadPriorWatch(sb, periodStart) {
  const { data } = await sb.from("weekly_reports").select("watch_list").lt("period_start", periodStart).eq("status", "generated").order("period_start", { ascending: false }).limit(1).maybeSingle();
  const list = data?.watch_list;
  return Array.isArray(list) ? list.map((x) => String(x)).filter(Boolean) : [];
}
