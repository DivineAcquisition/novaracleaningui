// Calendar-year 1099-NEC prep report.
//
// Aggregates contractor compensation across every payroll rail so admin can
// reconcile before filing via Stripe Connect Tax Reporting (or a CPA).
//
// Rails:
//   • connect_payouts — Stripe Transfers from process-payout (in Stripe 1099)
//   • manual_payouts  — Custom Payout ledger (usually bookkeeping-only)
//   • payroll_runs    — historical weekly Auto Payroll Connect sends
//   • extra_pay       — supplies/mileage/surge/OT/job-value once marked paid
//   • tips            — customer tips once received (even before paid_out_at)
//
// Custom Payout rows that already have a completed Connect transfer for the
// same booking + cleaner are de-duplicated so the $77 Cat overlap is not
// counted twice. Mileage/supply reimbursements are peeled off when identifiable.

export const NEC_THRESHOLD_CENTS = 60_000;

export const STRIPE_TAX_FORMS_URL = "https://dashboard.stripe.com/connect/taxes/forms";
export const STRIPE_TAX_SETTINGS_URL = "https://dashboard.stripe.com/settings/connect/tax_forms";

export type SourceKey =
  | "connect_payouts"
  | "manual_payouts"
  | "payroll_runs"
  | "extra_pay"
  | "tips";

export interface CleanerAgg {
  cleanerId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  stripeAccountId: string | null;
  payoutsEnabled: boolean;
  sources: Record<SourceKey, number>;
  reimbursementCents: number;
  stripeTrackedCents: number;
  offConnectCents: number;
  reportableCents: number;
  paymentCount: number;
  meetsNecThreshold: boolean;
}

export interface Tax1099Report {
  taxYear: number;
  generatedAt: string;
  necThresholdCents: number;
  stripeTaxFormsUrl: string;
  stripeTaxSettingsUrl: string;
  notes: string[];
  totals: {
    reportableCents: number;
    reimbursementCents: number;
    stripeTrackedCents: number;
    offConnectCents: number;
    cleanersPaid: number;
    meetsNecThreshold: number;
    connectReady: number;
    connectIncomplete: number;
    noConnect: number;
    bySource: Record<SourceKey, number>;
  };
  cleaners: CleanerAgg[];
}

export interface CleanerRowInput {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean | null;
}

export interface ConnectPayoutInput {
  cleaner_id: string | null;
  booking_id: string | null;
  cleaner_payout_cents: number | null;
  status: string | null;
  processed_at: string | null;
  created_at: string | null;
  stripe_transfer_id: string | null;
}

export interface ManualPayoutInput {
  cleaner_id: string | null;
  booking_id: string | null;
  amount_cents: number | null;
  status: string | null;
  paid_at: string | null;
  created_at: string | null;
  cleaner_breakdown: unknown;
  transfer_ids: unknown;
}

export interface PayrollRunInput {
  cleaner_id: string | null;
  net_cents: number | null;
  sent_amount_cents: number | null;
  clawed_back_cents: number | null;
  reimbursement_cents: number | null;
  status: string | null;
  sent_at: string | null;
  executed_at: string | null;
  created_at: string | null;
  stripe_transfer_id: string | null;
}

export interface ExtraPayInput {
  cleaner_id: string | null;
  total_cents: number | null;
  supply_cents: number | null;
  mileage_cents: number | null;
  surge_cents: number | null;
  overtime_cents: number | null;
  job_value_cents: number | null;
  status: string | null;
  paid_at: string | null;
  created_at: string | null;
  stripe_transfer_id: string | null;
}

export interface TipInput {
  cleaner_id: string | null;
  amount_cents: number | null;
  status: string | null;
  paid_out_at: string | null;
  created_at: string | null;
}

export interface Aggregate1099Input {
  taxYear: number;
  generatedAt?: string;
  cleaners: CleanerRowInput[];
  payouts: ConnectPayoutInput[];
  manualPayouts: ManualPayoutInput[];
  payrollRuns: PayrollRunInput[];
  extraPay: ExtraPayInput[];
  tips: TipInput[];
}

const CONNECT_PAID = new Set(["completed", "paid", "succeeded", "transferred"]);
const MANUAL_PAID = new Set(["paid"]);
const RUN_PAID = new Set(["paid", "sent", "succeeded", "completed", "cleared"]);
const EXTRA_PAID = new Set(["paid", "sent", "succeeded", "completed"]);
const TIP_COUNTED = new Set(["received", "paid", "succeeded", "completed"]);

export function emptySources(): Record<SourceKey, number> {
  return {
    connect_payouts: 0,
    manual_payouts: 0,
    payroll_runs: 0,
    extra_pay: 0,
    tips: 0,
  };
}

export function yearBounds(taxYear: number): { startIso: string; endIso: string } {
  return {
    startIso: `${taxYear}-01-01T00:00:00.000Z`,
    endIso: `${taxYear + 1}-01-01T00:00:00.000Z`,
  };
}

export function inYear(iso: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isFinite(t) && Number.isFinite(start) && Number.isFinite(end)) {
    return t >= start && t < end;
  }
  return iso >= startIso && iso < endIso;
}

export function parseTaxYear(raw: unknown, now: Date = new Date()): number {
  const current = now.getUTCFullYear();
  const n = Number(raw);
  if (!Number.isFinite(n)) return current;
  const y = Math.trunc(n);
  if (y < 2020 || y > current + 1) return current;
  return y;
}

function overlapKey(bookingId: string | null | undefined, cleanerId: string | null | undefined): string | null {
  if (!bookingId || !cleanerId) return null;
  return `${bookingId}:${cleanerId}`;
}

function breakdownMembers(
  p: ManualPayoutInput,
): Array<{ cleanerId: string; amountCents: number }> {
  const breakdown = Array.isArray(p.cleaner_breakdown) ? p.cleaner_breakdown : [];
  if (breakdown.length > 0) {
    return (breakdown as Array<{ cleanerId?: string; amountCents?: number }>)
      .map((m) => ({
        cleanerId: String(m.cleanerId || ""),
        amountCents: Number(m.amountCents) || 0,
      }))
      .filter((m) => m.cleanerId && m.amountCents > 0);
  }
  const id = String(p.cleaner_id || "");
  const amt = Number(p.amount_cents) || 0;
  return id && amt > 0 ? [{ cleanerId: id, amountCents: amt }] : [];
}

function hasTransferIds(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0;
}

export function aggregate1099(input: Aggregate1099Input): Tax1099Report {
  const { startIso, endIso } = yearBounds(input.taxYear);
  const byId = new Map<string, CleanerAgg>();

  const seed = (c: CleanerRowInput): CleanerAgg => ({
    cleanerId: String(c.id),
    firstName: c.first_name || null,
    lastName: c.last_name || null,
    email: c.email || null,
    phone: c.phone || null,
    status: c.status || null,
    stripeAccountId: c.stripe_account_id || null,
    payoutsEnabled: Boolean(c.payouts_enabled),
    sources: emptySources(),
    reimbursementCents: 0,
    stripeTrackedCents: 0,
    offConnectCents: 0,
    reportableCents: 0,
    paymentCount: 0,
    meetsNecThreshold: false,
  });

  for (const c of input.cleaners) byId.set(String(c.id), seed(c));

  const ensure = (id: string): CleanerAgg | null => {
    if (!id) return null;
    let row = byId.get(id);
    if (!row) {
      row = seed({
        id,
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        status: "unknown",
        stripe_account_id: null,
        payouts_enabled: false,
      });
      byId.set(id, row);
    }
    return row;
  };

  const credit = (
    cleanerId: string,
    source: SourceKey,
    cents: number,
    opts: { stripeTracked?: boolean; reimbursement?: boolean } = {},
  ) => {
    if (!cents || cents <= 0) return;
    const row = ensure(cleanerId);
    if (!row) return;
    if (opts.reimbursement) {
      row.reimbursementCents += cents;
      row.paymentCount += 1;
      return;
    }
    row.sources[source] += cents;
    row.paymentCount += 1;
    if (opts.stripeTracked) row.stripeTrackedCents += cents;
    else row.offConnectCents += cents;
  };

  const connectCounted = new Map<string, number>();

  for (const p of input.payouts) {
    if (!CONNECT_PAID.has(String(p.status || "").toLowerCase())) continue;
    const when = p.processed_at || p.created_at;
    if (!inYear(when, startIso, endIso)) continue;
    const cents = Number(p.cleaner_payout_cents) || 0;
    const cleanerId = String(p.cleaner_id || "");
    credit(cleanerId, "connect_payouts", cents, { stripeTracked: Boolean(p.stripe_transfer_id) });
    const key = overlapKey(p.booking_id, cleanerId);
    if (key) connectCounted.set(key, (connectCounted.get(key) || 0) + cents);
  }

  for (const p of input.manualPayouts) {
    if (!MANUAL_PAID.has(String(p.status || "").toLowerCase())) continue;
    const when = p.paid_at || p.created_at;
    if (!inYear(when, startIso, endIso)) continue;
    const stripeTracked = hasTransferIds(p.transfer_ids);
    for (const member of breakdownMembers(p)) {
      const key = overlapKey(p.booking_id, member.cleanerId);
      const already = key ? connectCounted.get(key) || 0 : 0;
      const remaining = Math.max(0, member.amountCents - already);
      if (key && already > 0) connectCounted.set(key, Math.max(0, already - member.amountCents));
      credit(member.cleanerId, "manual_payouts", remaining, { stripeTracked });
    }
  }

  for (const r of input.payrollRuns) {
    if (!RUN_PAID.has(String(r.status || "").toLowerCase())) continue;
    const when = r.sent_at || r.executed_at || r.created_at;
    if (!inYear(when, startIso, endIso)) continue;
    const sent = Number(r.sent_amount_cents ?? r.net_cents) || 0;
    const clawed = Number(r.clawed_back_cents) || 0;
    const reimb = Number(r.reimbursement_cents) || 0;
    const transferred = Math.max(0, sent - clawed);
    const compensation = Math.max(0, transferred - reimb);
    const cleanerId = String(r.cleaner_id || "");
    credit(cleanerId, "payroll_runs", compensation, { stripeTracked: Boolean(r.stripe_transfer_id) });
    if (reimb > 0) credit(cleanerId, "payroll_runs", reimb, { reimbursement: true });
  }

  for (const e of input.extraPay) {
    if (!EXTRA_PAID.has(String(e.status || "").toLowerCase())) continue;
    const when = e.paid_at || e.created_at;
    if (!inYear(when, startIso, endIso)) continue;
    const supply = Number(e.supply_cents) || 0;
    const mileage = Number(e.mileage_cents) || 0;
    const surge = Number(e.surge_cents) || 0;
    const ot = Number(e.overtime_cents) || 0;
    const jobValue = Number(e.job_value_cents) || 0;
    const total = Number(e.total_cents) || supply + mileage + surge + ot + jobValue;
    const reimb = supply + mileage;
    const compensation = Math.max(0, total - reimb);
    const cleanerId = String(e.cleaner_id || "");
    credit(cleanerId, "extra_pay", compensation, { stripeTracked: Boolean(e.stripe_transfer_id) });
    if (reimb > 0) credit(cleanerId, "extra_pay", reimb, { reimbursement: true });
  }

  for (const t of input.tips) {
    const status = String(t.status || "").toLowerCase();
    if (!t.paid_out_at && !TIP_COUNTED.has(status)) continue;
    const when = t.paid_out_at || t.created_at;
    if (!inYear(when, startIso, endIso)) continue;
    credit(String(t.cleaner_id || ""), "tips", Number(t.amount_cents) || 0, { stripeTracked: false });
  }

  const rows: CleanerAgg[] = [];
  for (const row of byId.values()) {
    row.reportableCents =
      row.sources.connect_payouts +
      row.sources.manual_payouts +
      row.sources.payroll_runs +
      row.sources.extra_pay +
      row.sources.tips;
    row.meetsNecThreshold = row.reportableCents >= NEC_THRESHOLD_CENTS;
    if (row.reportableCents > 0 || row.reimbursementCents > 0) rows.push(row);
  }

  rows.sort(
    (a, b) =>
      b.reportableCents - a.reportableCents || (a.lastName || "").localeCompare(b.lastName || ""),
  );

  const totals = {
    reportableCents: rows.reduce((s, r) => s + r.reportableCents, 0),
    reimbursementCents: rows.reduce((s, r) => s + r.reimbursementCents, 0),
    stripeTrackedCents: rows.reduce((s, r) => s + r.stripeTrackedCents, 0),
    offConnectCents: rows.reduce((s, r) => s + r.offConnectCents, 0),
    cleanersPaid: rows.length,
    meetsNecThreshold: rows.filter((r) => r.meetsNecThreshold).length,
    connectReady: rows.filter((r) => r.payoutsEnabled).length,
    connectIncomplete: rows.filter((r) => r.stripeAccountId && !r.payoutsEnabled).length,
    noConnect: rows.filter((r) => !r.stripeAccountId).length,
    bySource: {
      connect_payouts: rows.reduce((s, r) => s + r.sources.connect_payouts, 0),
      manual_payouts: rows.reduce((s, r) => s + r.sources.manual_payouts, 0),
      payroll_runs: rows.reduce((s, r) => s + r.sources.payroll_runs, 0),
      extra_pay: rows.reduce((s, r) => s + r.sources.extra_pay, 0),
      tips: rows.reduce((s, r) => s + r.sources.tips, 0),
    },
  };

  return {
    taxYear: input.taxYear,
    generatedAt: input.generatedAt || new Date().toISOString(),
    necThresholdCents: NEC_THRESHOLD_CENTS,
    stripeTaxFormsUrl: STRIPE_TAX_FORMS_URL,
    stripeTaxSettingsUrl: STRIPE_TAX_SETTINGS_URL,
    notes: [
      "Form 1099-NEC is used for non-employee compensation to US contractors at or above $600 in the tax year.",
      "Stripe Connect Tax Reporting files forms from Connect transfers. Custom Payout mark-paid rows without transfer_ids are ledger-only and will NOT appear in Stripe’s totals unless you import/adjust them.",
      "If a Custom Payout duplicates a completed Connect transfer for the same job and cleaner, only the Connect amount is counted.",
      "Mileage/supply reimbursements are listed separately and excluded from the reportable NEC estimate when identifiable.",
      "Customer tips with status “received” are included even if they have not yet been marked paid_out.",
      "Confirm final filing amounts with a tax advisor. This report is an ops reconciliation aid, not a filed tax form.",
    ],
    totals,
    cleaners: rows,
  };
}

export function reportToCsv(report: Tax1099Report): string {
  const headers = [
    "tax_year",
    "cleaner_id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "status",
    "stripe_account_id",
    "payouts_enabled",
    "connect_payouts_cents",
    "manual_payouts_cents",
    "payroll_runs_cents",
    "extra_pay_cents",
    "tips_cents",
    "reportable_cents",
    "reimbursement_cents",
    "stripe_tracked_cents",
    "off_connect_cents",
    "meets_nec_threshold",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of report.cleaners) {
    lines.push(
      [
        report.taxYear,
        r.cleanerId,
        r.firstName,
        r.lastName,
        r.email,
        r.phone,
        r.status,
        r.stripeAccountId,
        r.payoutsEnabled,
        r.sources.connect_payouts,
        r.sources.manual_payouts,
        r.sources.payroll_runs,
        r.sources.extra_pay,
        r.sources.tips,
        r.reportableCents,
        r.reimbursementCents,
        r.stripeTrackedCents,
        r.offConnectCents,
        r.meetsNecThreshold,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Minimal shape of the service-role client used by this report.
export type Payroll1099Client = { from: (table: string) => any };

async function mustSelect<T>(label: string, query: QueryResult<T>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

export async function fetch1099Inputs(
  supabase: Payroll1099Client,
  taxYear: number,
): Promise<Aggregate1099Input> {
  const cleaners = await mustSelect<CleanerRowInput>(
    "cleaners",
    supabase
      .from("cleaners")
      .select("id, first_name, last_name, email, phone, status, stripe_account_id, payouts_enabled"),
  );

  const payouts = await mustSelect<ConnectPayoutInput>(
    "payouts",
    supabase
      .from("payouts")
      .select("cleaner_id, booking_id, cleaner_payout_cents, status, processed_at, created_at, stripe_transfer_id")
      .in("status", ["completed", "paid", "succeeded", "transferred"]),
  );

  const manualPayouts = await mustSelect<ManualPayoutInput>(
    "manual_payouts",
    supabase
      .from("manual_payouts")
      .select("cleaner_id, booking_id, amount_cents, status, paid_at, created_at, cleaner_breakdown, transfer_ids")
      .eq("status", "paid"),
  );

  const payrollRuns = await mustSelect<PayrollRunInput>(
    "payroll_runs",
    supabase
      .from("payroll_runs")
      .select(
        "cleaner_id, net_cents, sent_amount_cents, clawed_back_cents, reimbursement_cents, status, sent_at, executed_at, created_at, stripe_transfer_id",
      )
      .in("status", ["paid", "sent", "succeeded", "completed", "cleared"]),
  );

  const extraPay = await mustSelect<ExtraPayInput>(
    "job_extra_pay",
    supabase
      .from("job_extra_pay")
      .select(
        "cleaner_id, total_cents, supply_cents, mileage_cents, surge_cents, overtime_cents, job_value_cents, status, paid_at, created_at, stripe_transfer_id",
      )
      .in("status", ["paid", "sent", "succeeded", "completed"]),
  );

  const tips = await mustSelect<TipInput>(
    "cleaner_tips",
    supabase.from("cleaner_tips").select("cleaner_id, amount_cents, status, paid_out_at, created_at"),
  );

  return { taxYear, cleaners, payouts, manualPayouts, payrollRuns, extraPay, tips };
}

export async function build1099Report(
  supabase: Payroll1099Client,
  taxYear: number,
): Promise<Tax1099Report> {
  const inputs = await fetch1099Inputs(supabase, taxYear);
  return aggregate1099(inputs);
}
