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
  // `payment_method` is a newly-added column not yet in the generated types.
  // deno-lint-ignore no-explicit-any
  const { data, error } = await (supabase.from as any)("cleaners")
    .select("id, first_name, last_name, email, pay_tier, pay_percentage, payment_method, stripe_account_id, payouts_enabled, status")
    .order("first_name", { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as PayrollCleaner[];
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
