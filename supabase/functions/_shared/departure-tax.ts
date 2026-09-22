// Year-end 1099-NEC preparation at departure.
// Locks a YTD snapshot and flags the contractor for the existing batch.
// Does not generate or send a 1099 document.

import { evaluateW9Status, type W9Status } from "./engagement-end.ts";

export type YtdSource = "payroll" | "payouts" | "none";

export type DepartureTaxPrep = {
  year: number;
  cents: number;
  source: YtdSource;
  w9Status: W9Status;
  w9Followup: boolean;
};

type Admin = {
  from: (table: string) => any;
};

function yearOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).getUTCFullYear();
}

function jobCompletedAt(line: { payroll_jobs?: { date_completed?: string } | Array<{ date_completed?: string }> | null }): string | null {
  const job = line.payroll_jobs;
  if (Array.isArray(job)) return job[0]?.date_completed ?? null;
  return job?.date_completed ?? null;
}

export async function prepareDepartureTax(
  admin: Admin,
  cleaner: {
    id: string;
    payouts_enabled?: boolean | null;
    stripe_account_id?: string | null;
    ob_payouts_setup?: boolean | null;
  },
  year: number,
): Promise<DepartureTaxPrep> {
  const { data: lines, error } = await admin
    .from("payroll_job_cleaners")
    .select("pay_cents, payment_status, payroll_jobs!inner(date_completed)")
    .eq("cleaner_id", cleaner.id);
  if (error) throw new Error(error.message || "Could not read payroll lines");

  const payrollLines = lines || [];
  let cents = 0;
  let source: YtdSource = "none";

  if (payrollLines.length > 0) {
    source = "payroll";
    for (const line of payrollLines) {
      if (String(line.payment_status || "").toLowerCase() === "disputed") continue;
      if (yearOf(jobCompletedAt(line)) !== year) continue;
      cents += Number(line.pay_cents) || 0;
    }
  } else {
    const { data: payouts, error: payoutErr } = await admin
      .from("payouts")
      .select("cleaner_payout_cents, status, processed_at, created_at")
      .eq("cleaner_id", cleaner.id)
      .eq("status", "completed");
    if (payoutErr) throw new Error(payoutErr.message || "Could not read payouts");
    for (const row of payouts || []) {
      const when = yearOf(row.processed_at || row.created_at);
      if (when !== year) continue;
      source = "payouts";
      cents += Number(row.cleaner_payout_cents) || 0;
    }
  }

  const w9Status = evaluateW9Status(cleaner);
  return {
    year,
    cents,
    source,
    w9Status,
    w9Followup: w9Status !== "complete",
  };
}
