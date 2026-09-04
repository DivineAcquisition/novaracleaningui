// ─── P&L numbers used by /admin/pnl (and the Google Sheet mirror) ────────────
//
// Same rules as supabase/functions/pl-sheet-sync:
//   • collected revenue = completed jobs (re-cleans are $0)
//   • job value = final_charge_cents ?? total_estimate_cents
//   • cleaner pay prefers the manual_payouts ledger, else the tier estimate
//   • extra pay (surge/OT/supplies) is an other job cost
//   • ad spend and expenses come from pl_ad_spend / pl_expenses
// Pipeline (confirmed / assigned / pending_payment) is shown separately so
// booked Facebook jobs like Kimberly and Nikkia appear before they finish.

export const PNL_TZ = "America/New_York";
export const PNL_OPERATIONS_START = "2026-05-01";
export const PNL_SHEET_URL_BASE = "https://docs.google.com/spreadsheets/d/";

export const PIPELINE_STATUSES = ["confirmed", "assigned", "pending_payment", "pending_details"] as const;
export const COLLECTED_STATUSES = ["completed"] as const;

export type PnlBooking = {
  id: string;
  booking_number: number | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  service_date: string;
  service_type: string | null;
  status: string;
  final_charge_cents: number | null;
  total_estimate_cents: number | null;
  cleaner_payout_cents: number | null;
  is_reclean?: boolean | null;
  time_slot?: string | null;
};

export type PnlPayout = { booking_id: string; amount_cents: number | null; status: string | null };
export type PnlExtra = { booking_id: string; total_cents: number | null; status: string | null };
export type PnlAdSpend = {
  date: string;
  platform: string;
  spend_cents: number;
  leads_calls: number | null;
  booked_jobs: number | null;
  campaign_notes: string | null;
};
export type PnlExpense = {
  date: string;
  type: string;
  who: string;
  description: string;
  amount_cents: number;
  status: string;
};

export type PnlJobRow = {
  id: string;
  ref: string;
  client: string;
  serviceDate: string;
  serviceType: string;
  status: string;
  revenueCents: number;
  cleanerPayCents: number;
  extraPayCents: number;
  profitCents: number;
  pipeline: boolean;
  reclean: boolean;
};

export type PnlMonth = {
  month: string;
  label: string;
  collectedCents: number;
  pipelineCents: number;
  cleanerPayCents: number;
  extraPayCents: number;
  jobProfitCents: number;
  adSpendCents: number;
  paidExpenseCents: number;
  promisedExpenseCents: number;
  contributionCents: number;
  collectedRoas: number | null;
  bookedRoas: number | null;
  completedJobs: number;
  pipelineJobs: number;
};

export type PnlAdRow = PnlAdSpend & {
  month: string;
  collectedRoas: number | null;
  bookedRoas: number | null;
};

export function ymdInZone(at: Date, timeZone = PNL_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthKey(ymd: string): string {
  return String(ymd || "").slice(0, 7);
}

export function monthStart(ymd: string): string {
  return `${monthKey(ymd)}-01`;
}

export function monthLabel(yyyyMm: string): string {
  const d = new Date(`${yyyyMm}-01T12:00:00.000Z`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function monthsInclusive(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  let cur = monthStart(fromYmd);
  const last = monthStart(toYmd);
  while (cur <= last) {
    out.push(monthKey(cur));
    const d = new Date(`${cur}T12:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    cur = `${d.toISOString().slice(0, 7)}-01`;
  }
  return out;
}

export function bookingRevenueCents(b: PnlBooking): number {
  if (b.is_reclean) return 0;
  return Number(b.final_charge_cents ?? b.total_estimate_cents ?? 0) || 0;
}

export function bookingClient(b: PnlBooking): string {
  return String(b.business_name || `${b.first_name || ""} ${b.last_name || ""}`.trim() || "Client");
}

export function bookingRef(b: PnlBooking): string {
  return b.booking_number != null ? `NVC-${String(b.booking_number).padStart(4, "0")}` : String(b.id).slice(0, 8);
}

export function isPipelineStatus(status: string): boolean {
  return (PIPELINE_STATUSES as readonly string[]).includes(status);
}

export function isCollectedStatus(status: string): boolean {
  return (COLLECTED_STATUSES as readonly string[]).includes(status);
}

function roas(revenueCents: number, spendCents: number): number | null {
  if (!spendCents) return null;
  return Math.round((revenueCents / spendCents) * 100) / 100;
}

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatRoas(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}x`;
}

export function sumMonths(months: PnlMonth[]): PnlMonth {
  const collectedCents = months.reduce((s, m) => s + m.collectedCents, 0);
  const pipelineCents = months.reduce((s, m) => s + m.pipelineCents, 0);
  const cleanerPayCents = months.reduce((s, m) => s + m.cleanerPayCents, 0);
  const extraPayCents = months.reduce((s, m) => s + m.extraPayCents, 0);
  const jobProfitCents = months.reduce((s, m) => s + m.jobProfitCents, 0);
  const adSpendCents = months.reduce((s, m) => s + m.adSpendCents, 0);
  const paidExpenseCents = months.reduce((s, m) => s + m.paidExpenseCents, 0);
  const promisedExpenseCents = months.reduce((s, m) => s + m.promisedExpenseCents, 0);
  return {
    month: "all",
    label: "All months",
    collectedCents,
    pipelineCents,
    cleanerPayCents,
    extraPayCents,
    jobProfitCents,
    adSpendCents,
    paidExpenseCents,
    promisedExpenseCents,
    contributionCents: jobProfitCents - adSpendCents - paidExpenseCents,
    collectedRoas: roas(collectedCents, adSpendCents),
    bookedRoas: roas(collectedCents + pipelineCents, adSpendCents),
    completedJobs: months.reduce((s, m) => s + m.completedJobs, 0),
    pipelineJobs: months.reduce((s, m) => s + m.pipelineJobs, 0),
  };
}

export function buildPnl(input: {
  bookings: PnlBooking[];
  payouts?: PnlPayout[];
  extras?: PnlExtra[];
  adSpend: PnlAdSpend[];
  expenses: PnlExpense[];
  since?: string;
  todayYmd?: string;
}): {
  todayYmd: string;
  months: PnlMonth[];
  jobs: PnlJobRow[];
  ads: PnlAdRow[];
} {
  const todayYmd = input.todayYmd || ymdInZone(new Date());
  const since = input.since || PNL_OPERATIONS_START;

  const payByBooking = new Map<string, number>();
  for (const p of input.payouts || []) {
    if (!p.booking_id || p.status === "cancelled") continue;
    payByBooking.set(p.booking_id, (payByBooking.get(p.booking_id) || 0) + (Number(p.amount_cents) || 0));
  }
  const extraByBooking = new Map<string, number>();
  for (const e of input.extras || []) {
    if (!e.booking_id || e.status === "failed" || e.status === "cancelled") continue;
    extraByBooking.set(e.booking_id, (extraByBooking.get(e.booking_id) || 0) + (Number(e.total_cents) || 0));
  }

  const jobs: PnlJobRow[] = [];
  for (const b of input.bookings) {
    const collected = isCollectedStatus(b.status);
    const pipeline = isPipelineStatus(b.status);
    if (!collected && !pipeline) continue;
    const revenueCents = bookingRevenueCents(b);
    const cleanerPayCents = payByBooking.has(b.id)
      ? payByBooking.get(b.id)!
      : collected
        ? Number(b.cleaner_payout_cents) || 0
        : 0;
    const extraPayCents = extraByBooking.get(b.id) || 0;
    jobs.push({
      id: b.id,
      ref: bookingRef(b),
      client: bookingClient(b),
      serviceDate: String(b.service_date || "").slice(0, 10),
      serviceType: String(b.service_type || "standard"),
      status: b.status,
      revenueCents,
      cleanerPayCents,
      extraPayCents,
      profitCents: collected ? revenueCents - cleanerPayCents - extraPayCents : 0,
      pipeline,
      reclean: Boolean(b.is_reclean),
    });
  }

  const monthKeys = monthsInclusive(since, todayYmd);
  const byMonth = new Map<string, PnlMonth>();
  for (const m of monthKeys) {
    byMonth.set(m, {
      month: m,
      label: monthLabel(m),
      collectedCents: 0,
      pipelineCents: 0,
      cleanerPayCents: 0,
      extraPayCents: 0,
      jobProfitCents: 0,
      adSpendCents: 0,
      paidExpenseCents: 0,
      promisedExpenseCents: 0,
      contributionCents: 0,
      collectedRoas: null,
      bookedRoas: null,
      completedJobs: 0,
      pipelineJobs: 0,
    });
  }

  const bucket = (ymd: string) => byMonth.get(monthKey(ymd));

  for (const j of jobs) {
    const row = bucket(j.serviceDate);
    if (!row) continue;
    if (j.pipeline) {
      row.pipelineCents += j.revenueCents;
      row.pipelineJobs += 1;
    } else {
      row.collectedCents += j.revenueCents;
      row.cleanerPayCents += j.cleanerPayCents;
      row.extraPayCents += j.extraPayCents;
      row.jobProfitCents += j.profitCents;
      if (!j.reclean) row.completedJobs += 1;
    }
  }

  const ads: PnlAdRow[] = input.adSpend.map((a) => {
    const month = monthKey(a.date);
    const row = byMonth.get(month);
    if (row) row.adSpendCents += Number(a.spend_cents) || 0;
    return { ...a, month, collectedRoas: null, bookedRoas: null };
  });

  for (const e of input.expenses) {
    const row = bucket(e.date);
    if (!row) continue;
    if (e.status === "Paid") row.paidExpenseCents += Number(e.amount_cents) || 0;
    else if (e.status === "Promised" || e.status === "Approved") row.promisedExpenseCents += Number(e.amount_cents) || 0;
  }

  for (const row of byMonth.values()) {
    row.contributionCents = row.jobProfitCents - row.adSpendCents - row.paidExpenseCents;
    row.collectedRoas = roas(row.collectedCents, row.adSpendCents);
    row.bookedRoas = roas(row.collectedCents + row.pipelineCents, row.adSpendCents);
  }

  for (const ad of ads) {
    const row = byMonth.get(ad.month);
    ad.collectedRoas = row?.collectedRoas ?? null;
    ad.bookedRoas = row?.bookedRoas ?? null;
  }

  return {
    todayYmd,
    months: monthKeys.map((m) => byMonth.get(m)!),
    jobs: jobs.sort((a, b) => `${a.serviceDate}|${a.ref}`.localeCompare(`${b.serviceDate}|${b.ref}`)),
    ads: ads.sort((a, b) => `${a.date}|${a.platform}`.localeCompare(`${b.date}|${b.platform}`)),
  };
}
