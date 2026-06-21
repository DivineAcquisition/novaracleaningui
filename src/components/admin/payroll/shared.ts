import { supabase } from "@/integrations/supabase/client";

export interface PayrollCleaner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  pay_tier: string | null;
  pay_percentage: number | null;
  payment_method: string | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean | null;
  status: string | null;
}

export interface PayrollJobRow {
  id: string;
  date_completed: string;
  customer_name: string | null;
  service_type: string;
  customer_paid_cents: number;
  cleaner_count: number;
  tier_pct_locked: number;
  cleaner_pay_pool_cents: number;
  pay_per_cleaner_cents: number;
  pay_period: string;
  payment_status: string;
  entry_source: string;
  locked: boolean;
  notes: string | null;
  payroll_job_cleaners?: { cleaner_id: string; pay_cents: number; payment_status: string }[];
}

export interface PayrollRunRow {
  id: string;
  cleaner_id: string;
  pay_period_start: string;
  pay_period_end: string;
  total_jobs: number;
  gross_cents: number;
  bonus_cents: number;
  deduction_cents: number;
  net_cents: number;
  payment_method: string | null;
  stripe_connect_id: string | null;
  status: string;
  stripe_transfer_id: string | null;
  sent_at: string | null;
  cleared_at: string | null;
  failure_reason: string | null;
  notes: string | null;
}

export const cleanerName = (c?: Partial<PayrollCleaner> | null): string =>
  c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner" : "Cleaner";

// ─── Operational jobs (derived from real bookings) ─────────────────────────
export interface OperationalJobCleaner {
  id: string;
  name: string;
  payCents: number;
}
export interface OperationalJob {
  bookingId: string;
  bookingNumber: string | null;
  status: string;
  serviceType: string | null;
  serviceDate: string | null;
  dateCompleted: string | null;
  payPeriod: string;
  customer: string;
  customerPaidCents: number;
  payoutStatus: string | null;
  payable: boolean;
  paid: boolean;
  cleaners: OperationalJobCleaner[];
}

/** Pull live + past jobs straight from operations (bookings/job_assignments). */
export async function loadOperationalJobs(
  opts: { fromDate?: string; toDate?: string } = {},
): Promise<OperationalJob[]> {
  const { data, error } = await supabase.functions.invoke("payroll-operations", {
    body: { action: "list", ...opts },
  });
  if (error) throw new Error(error.message || "Failed to load operational jobs");
  // deno-lint-ignore no-explicit-any
  if ((data as any)?.error) throw new Error((data as any).error);
  // deno-lint-ignore no-explicit-any
  return ((data as any)?.jobs as OperationalJob[]) || [];
}

export interface PayoutLedgerRow {
  id: string;
  bookingId: string | null;
  bookingNumber: string | null;
  cleanerId: string | null;
  cleanerName: string;
  totalBookingCents: number | null;
  platformFeeCents: number | null;
  payoutCents: number | null;
  stripeTransferId: string | null;
  status: string | null;
  processedAt: string | null;
  createdAt: string | null;
}

/** Load the real payout ledger (Stripe transfers) for the Runs history. */
export async function loadPayoutLedger(): Promise<PayoutLedgerRow[]> {
  const { data, error } = await supabase.functions.invoke("payroll-operations", {
    body: { action: "payouts" },
  });
  if (error) throw new Error(error.message || "Failed to load payouts");
  // deno-lint-ignore no-explicit-any
  if ((data as any)?.error) throw new Error((data as any).error);
  // deno-lint-ignore no-explicit-any
  return ((data as any)?.payouts as PayoutLedgerRow[]) || [];
}

/** Release a single completed booking's payout via the proven process-payout flow. */
export async function payoutBooking(bookingId: string): Promise<{ ok: boolean; amountCents?: number; skipped?: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("process-payout", {
      body: { bookingId, source: "admin_payroll" },
    });
    if (error) return { ok: false, error: error.message };
    // deno-lint-ignore no-explicit-any
    const d = data as any;
    if (d?.error) return { ok: false, error: d.error };
    if (d?.success) return { ok: true, amountCents: d.amount_cents };
    if (d?.skipped) return { ok: true, skipped: true };
    return { ok: false, error: "Unexpected response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Invoke the server-side payroll-admin function (all money math is server-side). */
export async function payrollAction<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("payroll-admin", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message || "Request failed");
  // deno-lint-ignore no-explicit-any
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export async function loadActiveCleaners(): Promise<PayrollCleaner[]> {
  // Routed through the service-role function so the roster loads regardless
  // of client-side RLS on the cleaners table (consistent with Bookings/Dispatch).
  const { data, error } = await supabase.functions.invoke("payroll-operations", {
    body: { action: "cleaners" },
  });
  if (error) throw new Error(error.message || "Failed to load cleaners");
  // deno-lint-ignore no-explicit-any
  if ((data as any)?.error) throw new Error((data as any).error);
  // deno-lint-ignore no-explicit-any
  return (((data as any)?.cleaners) as PayrollCleaner[]) || [];
}

export const STATUS_TONE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  approved: "bg-sky-50 text-sky-700 border-sky-200",
  paid: "bg-violet-50 text-violet-700 border-violet-200",
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  sent: "bg-amber-50 text-amber-700 border-amber-200",
  cleared: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  hold: "bg-rose-50 text-rose-700 border-rose-200",
  disputed: "bg-rose-50 text-rose-700 border-rose-200",
};
