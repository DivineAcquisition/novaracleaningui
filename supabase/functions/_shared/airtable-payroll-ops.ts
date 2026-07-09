// ─── Airtable Ops base — Payroll Runs write-back ────────────────────────────
//
// Mirrors each executed payroll run into the Airtable Ops base
// (NVC | Client & Revenue Ops) "Payroll Runs" table, keyed by a stable
// "Run ID" so re-syncing updates the existing row. Writes use Airtable FIELD
// IDS (not display names) so renaming a column in Airtable never breaks sync.
//
// Fully gated + fire-and-forget: if AIRTABLE_API_KEY isn't configured it
// no-ops, exactly like the existing airtable.ts mirror. Never throws.
//
// Config (public.app_secrets, with spec defaults baked in):
//   AIRTABLE_API_KEY                 PAT with data.records:write on the Ops base
//   PAYROLL_OPS_AIRTABLE_BASE_ID     default appoUuFQZQfCyKGlw
//   PAYROLL_OPS_AIRTABLE_RUNS_TABLE  default tblGr8Cu8avwvV3xy

import { resolveSecret } from "./app-secrets.ts";

const AIRTABLE_API = "https://api.airtable.com/v0";

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

// Field IDs for Payroll Runs (tblGr8Cu8avwvV3xy) — from the build spec.
const F = {
  runId: "fldma9MP4dAavHr1w",
  cleanerName: "fldmEx7eF3BNqikvg",
  periodStart: "fldL2UnaibUcEsgNm",
  periodEnd: "fldfcED6fn7u9caTe",
  totalJobs: "fldX0KX925No7glkg",
  grossPay: "fldesfKdzVEm6wDJH",
  bonus: "fldutIxR6mPgSYFHY",
  deduction: "fldL1rXbU4rlVS5sU",
  netPay: "fldwPSiefPgpg1JXB",
  paymentMethod: "fldU0IFWyFhjdz6Le",
  status: "fldq3EcOQXuVyz5JY",
  stripeTransferId: "fldGvKPcpkSJvFmoX",
  sentAt: "fldZY62ImpkJc4jWe",
  notes: "fldxFZwfMIkzOWFpY",
} as const;

const log = (s: string, d?: unknown) =>
  console.log(`[AIRTABLE-PAYROLL-OPS] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

const cents = (c: number | null | undefined): number =>
  c == null ? 0 : Math.round(Number(c)) / 100;

// Map internal status → the Airtable single-select option name (Section 2).
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  processing: "Processing",
  paid: "Paid",
  sent: "Paid",
  cleared: "Paid",
  failed: "Failed",
  hold: "Hold",
};

export interface PayrollRunForOps {
  id: string;
  cleaner_id: string;
  pay_period_start: string;
  pay_period_end: string;
  total_jobs: number;
  gross_cents: number;
  bonus_cents: number;
  deduction_cents: number;
  reimbursement_cents?: number | null;
  net_cents: number;
  payment_method: string | null;
  status: string;
  stripe_transfer_id: string | null;
  sent_at: string | null;
  notes: string | null;
}

/** Stable Airtable "Run ID" for a payroll_runs row (matches the spec shape). */
export function opsRunId(run: { pay_period_start: string; cleaner_id: string }): string {
  return `RUN-${run.pay_period_start}-${String(run.cleaner_id).slice(0, 8)}`;
}

/**
 * Upsert one payroll run into the Ops base. Returns true on 2xx, false on
 * any failure / when Airtable isn't configured. Never throws.
 */
export async function syncPayrollRunToOps(
  supabase: SupabaseLike,
  run: PayrollRunForOps,
  cleanerName: string,
): Promise<boolean> {
  try {
    const apiKey = (await resolveSecret(supabase, "AIRTABLE_API_KEY")) ||
      (await resolveSecret(supabase, "AIRTABLE_PAT"));
    if (!apiKey || !run?.id) return false;
    const baseId = (await resolveSecret(supabase, "PAYROLL_OPS_AIRTABLE_BASE_ID")) || "appoUuFQZQfCyKGlw";
    const table = (await resolveSecret(supabase, "PAYROLL_OPS_AIRTABLE_RUNS_TABLE")) || "tblGr8Cu8avwvV3xy";

    const fields: Record<string, unknown> = {
      [F.runId]: opsRunId(run),
      [F.cleanerName]: cleanerName,
      [F.periodStart]: run.pay_period_start,
      [F.periodEnd]: run.pay_period_end,
      [F.totalJobs]: run.total_jobs ?? 0,
      [F.grossPay]: cents(run.gross_cents),
      [F.bonus]: cents(run.bonus_cents),
      [F.deduction]: cents(run.deduction_cents),
      [F.netPay]: cents(run.net_cents),
      [F.paymentMethod]: run.payment_method || "stripe_connect",
      [F.status]: STATUS_LABEL[run.status] || "Draft",
      [F.stripeTransferId]: run.stripe_transfer_id || "",
      [F.sentAt]: run.sent_at || "",
      // Reimbursements (supplies + mileage) are already inside net pay; the
      // Ops table has no dedicated column, so break them out in Notes.
      [F.notes]: [
        run.notes || "",
        Number(run.reimbursement_cents) > 0
          ? `Reimbursements (supplies + mileage): $${cents(run.reimbursement_cents).toFixed(2)} included in net`
          : "",
      ].filter(Boolean).join(" · "),
    };
    // Drop empties so we never clobber a populated Airtable cell with blank.
    for (const k of Object.keys(fields)) {
      if (fields[k] === "" || fields[k] === null || fields[k] === undefined) delete fields[k];
    }

    const res = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(table)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: [F.runId] },
        typecast: true,
        records: [{ fields }],
        returnFieldsByFieldId: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log("upsert failed", { status: res.status, body: body.slice(0, 300) });
      return false;
    }
    return true;
  } catch (err) {
    log("error", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
