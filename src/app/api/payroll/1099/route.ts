// ─── GET/POST /api/payroll/1099 — Tax-year 1099-NEC prep report ─────────────
//
// Aggregates contractor compensation across every payroll rail for a calendar
// tax year so admins can reconcile before filing via Stripe Connect Tax
// Reporting (or an external CPA).
//
// Rails:
//   • connect_payouts  — Stripe Transfers from process-payout (in Stripe 1099)
//   • manual_payouts   — Custom Payout ledger (often bookkeeping-only; empty
//                        transfer_ids means NOT on a Connect transfer)
//   • payroll_runs     — weekly Auto Payroll Connect sends (minus clawbacks)
//   • extra_pay        — supplies/mileage/surge/OT marked paid (often off-Connect)
//   • tips             — tip-cleaner payouts once paid_out
//
// Manual multi-cleaner rows are attributed via cleaner_breakdown when present.
// Reimbursements on payroll_runs are surfaced separately (typically not NEC).
//
// Admin/VA gated. Money is integer cents. IRS 1099-NEC federal threshold = $600.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEC_THRESHOLD_CENTS = 60_000;

type SourceKey =
  | "connect_payouts"
  | "manual_payouts"
  | "payroll_runs"
  | "extra_pay"
  | "tips";

interface CleanerAgg {
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

function emptySources(): Record<SourceKey, number> {
  return {
    connect_payouts: 0,
    manual_payouts: 0,
    payroll_runs: 0,
    extra_pay: 0,
    tips: 0,
  };
}

function yearBounds(taxYear: number): { startIso: string; endIso: string } {
  return {
    startIso: `${taxYear}-01-01T00:00:00.000Z`,
    endIso: `${taxYear + 1}-01-01T00:00:00.000Z`,
  };
}

function inYear(iso: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!iso) return false;
  return iso >= startIso && iso < endIso;
}

function parseTaxYear(raw: unknown): number {
  const now = new Date();
  const current = now.getUTCFullYear();
  const n = Number(raw);
  if (!Number.isFinite(n)) return current;
  const y = Math.trunc(n);
  if (y < 2020 || y > current + 1) return current;
  return y;
}

async function buildReport(taxYear: number) {
  const supabase = getAdminSupabase();
  const { startIso, endIso } = yearBounds(taxYear);

  const { data: cleaners, error: cleanersErr } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, email, phone, status, stripe_account_id, payouts_enabled")
    .order("last_name", { ascending: true });
  if (cleanersErr) throw cleanersErr;

  const byId = new Map<string, CleanerAgg>();
  for (const c of cleaners || []) {
    byId.set(String(c.id), {
      cleanerId: String(c.id),
      firstName: (c.first_name as string) || null,
      lastName: (c.last_name as string) || null,
      email: (c.email as string) || null,
      phone: (c.phone as string) || null,
      status: (c.status as string) || null,
      stripeAccountId: (c.stripe_account_id as string) || null,
      payoutsEnabled: Boolean(c.payouts_enabled),
      sources: emptySources(),
      reimbursementCents: 0,
      stripeTrackedCents: 0,
      offConnectCents: 0,
      reportableCents: 0,
      paymentCount: 0,
      meetsNecThreshold: false,
    });
  }

  const ensure = (id: string): CleanerAgg | null => {
    if (!id) return null;
    let row = byId.get(id);
    if (!row) {
      row = {
        cleanerId: id,
        firstName: null,
        lastName: null,
        email: null,
        phone: null,
        status: "unknown",
        stripeAccountId: null,
        payoutsEnabled: false,
        sources: emptySources(),
        reimbursementCents: 0,
        stripeTrackedCents: 0,
        offConnectCents: 0,
        reportableCents: 0,
        paymentCount: 0,
        meetsNecThreshold: false,
      };
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

  // ── Connect booking payouts (Stripe Transfers) ───────────────────────────
  {
    const { data, error } = await supabase
      .from("payouts")
      .select("cleaner_id, cleaner_payout_cents, status, processed_at, created_at, stripe_transfer_id")
      .in("status", ["completed", "paid", "succeeded", "transferred"]);
    if (error) throw error;
    for (const p of data || []) {
      const when = (p.processed_at as string) || (p.created_at as string);
      if (!inYear(when, startIso, endIso)) continue;
      const hasTransfer = Boolean(p.stripe_transfer_id);
      credit(String(p.cleaner_id || ""), "connect_payouts", Number(p.cleaner_payout_cents) || 0, {
        stripeTracked: hasTransfer,
      });
    }
  }

  // ── Custom / manual payouts (often bookkeeping-only) ─────────────────────
  {
    const { data, error } = await supabase
      .from("manual_payouts")
      .select("cleaner_id, amount_cents, status, paid_at, created_at, cleaner_breakdown, transfer_ids")
      .eq("status", "paid");
    if (error) throw error;
    for (const p of data || []) {
      const when = (p.paid_at as string) || (p.created_at as string);
      if (!inYear(when, startIso, endIso)) continue;

      const transferIds = Array.isArray(p.transfer_ids) ? p.transfer_ids : [];
      const stripeTracked = transferIds.length > 0;

      const breakdown = Array.isArray(p.cleaner_breakdown) ? p.cleaner_breakdown : [];
      if (breakdown.length > 0) {
        for (const m of breakdown as Array<{ cleanerId?: string; amountCents?: number }>) {
          credit(String(m.cleanerId || ""), "manual_payouts", Number(m.amountCents) || 0, {
            stripeTracked,
          });
        }
      } else {
        credit(String(p.cleaner_id || ""), "manual_payouts", Number(p.amount_cents) || 0, {
          stripeTracked,
        });
      }
    }
  }

  // ── Weekly payroll runs (Connect sends) ──────────────────────────────────
  {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select(
        "cleaner_id, net_cents, sent_amount_cents, clawed_back_cents, reimbursement_cents, status, sent_at, executed_at, created_at, stripe_transfer_id",
      )
      .in("status", ["paid", "sent", "succeeded", "completed", "cleared"]);
    if (error) throw error;
    for (const r of data || []) {
      const when = (r.sent_at as string) || (r.executed_at as string) || (r.created_at as string);
      if (!inYear(when, startIso, endIso)) continue;
      const sent = Number(r.sent_amount_cents ?? r.net_cents) || 0;
      const clawed = Number(r.clawed_back_cents) || 0;
      const reimb = Number(r.reimbursement_cents) || 0;
      const transferred = Math.max(0, sent - clawed);
      // Prefer treating reimbursements as non-NEC when we can peel them off.
      const compensation = Math.max(0, transferred - reimb);
      const hasTransfer = Boolean(r.stripe_transfer_id);
      credit(String(r.cleaner_id || ""), "payroll_runs", compensation, { stripeTracked: hasTransfer });
      if (reimb > 0) {
        credit(String(r.cleaner_id || ""), "payroll_runs", reimb, { reimbursement: true });
      }
    }
  }

  // ── Extra pay (often marked paid without Connect) ────────────────────────
  {
    const { data, error } = await supabase
      .from("job_extra_pay")
      .select(
        "cleaner_id, total_cents, supply_cents, mileage_cents, surge_cents, overtime_cents, status, paid_at, created_at, stripe_transfer_id",
      )
      .in("status", ["paid", "sent", "succeeded", "completed"]);
    if (error) throw error;
    for (const e of data || []) {
      const when = (e.paid_at as string) || (e.created_at as string);
      if (!inYear(when, startIso, endIso)) continue;
      const supply = Number(e.supply_cents) || 0;
      const mileage = Number(e.mileage_cents) || 0;
      const surge = Number(e.surge_cents) || 0;
      const ot = Number(e.overtime_cents) || 0;
      const total = Number(e.total_cents) || supply + mileage + surge + ot;
      const reimb = supply + mileage;
      const compensation = Math.max(0, total - reimb);
      const hasTransfer = Boolean(e.stripe_transfer_id);
      credit(String(e.cleaner_id || ""), "extra_pay", compensation, { stripeTracked: hasTransfer });
      if (reimb > 0) {
        credit(String(e.cleaner_id || ""), "extra_pay", reimb, { reimbursement: true });
      }
    }
  }

  // ── Tips ─────────────────────────────────────────────────────────────────
  {
    const { data, error } = await supabase
      .from("cleaner_tips")
      .select("cleaner_id, amount_cents, status, paid_out_at, created_at");
    if (error) throw error;
    for (const t of data || []) {
      const when = (t.paid_out_at as string) || null;
      if (!when) continue;
      if (!inYear(when, startIso, endIso)) continue;
      // Tips paid out through Connect are usually Stripe-tracked; we don't have
      // a transfer id on this table, so count as reportable but not stripe-confirmed.
      credit(String(t.cleaner_id || ""), "tips", Number(t.amount_cents) || 0, {
        stripeTracked: false,
      });
    }
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

  rows.sort((a, b) => b.reportableCents - a.reportableCents || (a.lastName || "").localeCompare(b.lastName || ""));

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
    taxYear,
    generatedAt: new Date().toISOString(),
    necThresholdCents: NEC_THRESHOLD_CENTS,
    stripeTaxFormsUrl: "https://dashboard.stripe.com/connect/taxes/forms",
    stripeTaxSettingsUrl: "https://dashboard.stripe.com/settings/connect/tax_forms",
    notes: [
      "Form 1099-NEC is used for non-employee compensation to US contractors at or above $600 in the tax year.",
      "Stripe Connect Tax Reporting files forms from Connect transfers. Custom Payout mark-paid rows without transfer_ids are ledger-only and will NOT appear in Stripe’s totals unless you import/adjust them.",
      "Mileage/supply reimbursements are listed separately and excluded from the reportable NEC estimate when identifiable.",
      "Confirm final filing amounts with a tax advisor. This report is an ops reconciliation aid, not a filed tax form.",
    ],
    totals,
    cleaners: rows,
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  const url = new URL(req.url);
  const taxYear = parseTaxYear(url.searchParams.get("taxYear"));

  try {
    return NextResponse.json(await buildReport(taxYear));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build 1099 report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const taxYear = parseTaxYear(body.taxYear);
  try {
    return NextResponse.json(await buildReport(taxYear));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build 1099 report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
