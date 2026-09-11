// ─── Consolidated portfolio invoicing ──────────────────────────────────────
//
// A property manager with twenty units and eleven turnovers in March should
// get one invoice in March, not eleven. So billing here is period-based and
// portfolio-wide: every completed turnover across the whole registry rolls
// into a single Stripe invoice, itemized by unit, so the manager can settle
// once and still reconcile each line against a specific apartment.
//
// Invoiced is the default for this relationship type. Auto-Pay accounts get
// the same consolidated document — the only difference is Stripe charges the
// card on file instead of sending a payable invoice.
//
// This uses the existing Stripe Invoicing integration. There is no parallel
// AR system here: `property_manager_invoices` records what we sent and what
// was on it, and Stripe remains the source of truth for whether it is paid.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { resolveAppSecret, stripeCall } from "@/lib/stripe-rest";
import { facingInvoiceStatus, netTermsLabel } from "@/lib/partner-portal/stripe-billing";
import { PM_SERVICE_LABELS, formatRate, unitDisplayName, type PmServiceType } from "./pricing";
import { clip } from "./registry";
import { syncOpenTurnovers } from "./turnovers";

type Admin = ReturnType<typeof getAdminSupabase>;
type Row = Record<string, unknown>;

export type InvoiceCycle = "weekly" | "biweekly" | "monthly";

const DAYS_UNTIL_DUE: Record<string, number> = {
  on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
};

// ─── Billing periods ───────────────────────────────────────────────────────

export interface BillingPeriod {
  start: string;
  end: string;
  label: string;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/**
 * The billing period containing `anchorDay`. Monthly runs calendar months
 * because that is what a property manager's own books run on; weekly and
 * biweekly run Monday-anchored so a period never splits a weekend turnover
 * from the job that caused it.
 */
export function periodFor(cycle: InvoiceCycle, anchorDay: string): BillingPeriod {
  const day = String(anchorDay).slice(0, 10);
  if (cycle === "monthly") {
    const start = `${day.slice(0, 7)}-01`;
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const end = addDays(d.toISOString().slice(0, 10), -1);
    return { start, end, label: monthLabel(start) };
  }
  const span = cycle === "biweekly" ? 14 : 7;
  // Anchored on a fixed Monday so consecutive periods tile without drifting,
  // whatever day of the week the caller happens to ask on.
  const EPOCH_MONDAY = Date.UTC(1970, 0, 5, 12, 0, 0);
  const elapsedDays = Math.floor(
    (new Date(`${day}T12:00:00Z`).getTime() - EPOCH_MONDAY) / 86_400_000,
  );
  const start = addDays(day, -(((elapsedDays % span) + span) % span));
  const end = addDays(start, span - 1);
  return { start, end, label: `${shortDay(start)} – ${shortDay(end)}` };
}

/** The most recently CLOSED period — the one that is ready to bill. */
export function lastClosedPeriod(cycle: InvoiceCycle, today = new Date()): BillingPeriod {
  const day = today.toISOString().slice(0, 10);
  const current = periodFor(cycle, day);
  return periodFor(cycle, addDays(current.start, -1));
}

export function dueDateFor(periodEnd: string, netTerms: string | null | undefined): string {
  return addDays(periodEnd, DAYS_UNTIL_DUE[String(netTerms || "net_15")] ?? 15);
}


// ─── Building the statement ────────────────────────────────────────────────

export interface InvoiceTurnoverLine {
  turnoverId: string;
  serviceType: PmServiceType;
  serviceLabel: string;
  /** The day the work actually happened, falling back to the deadline. */
  servicedOn: string;
  amountCents: number;
  /** Non-zero when an approved scope adjustment moved this turnover's value. */
  scopeAdjustmentCents: number;
}

export interface InvoiceUnitLine {
  unitId: string;
  unitLabel: string;
  address: string | null;
  turnovers: InvoiceTurnoverLine[];
  subtotalCents: number;
}

export interface InvoiceDraft {
  pmAccountId: string;
  period: BillingPeriod;
  units: InvoiceUnitLine[];
  turnoverCount: number;
  unitCount: number;
  subtotalCents: number;
  dueDate: string;
  netTermsLabel: string | null;
}

/**
 * Gather every completed, not-yet-invoiced turnover in the period and group
 * it under the unit it happened on.
 *
 * A turnover's billable amount is its final value: the standing rate, or the
 * adjusted total when an approved scope adjustment moved it. Cancelled work
 * and work still in flight are simply not on this period's invoice — they
 * fall into whichever period they complete in.
 */
export async function buildInvoiceDraft(
  supabase: Admin,
  input: { pmAccountId: string; period: BillingPeriod; netTerms?: string | null },
): Promise<InvoiceDraft> {
  // Reconcile before reading. A scope adjustment approved on the job hasn't
  // touched the turnover yet, and billing the pre-adjustment amount would be
  // wrong in the direction that is hardest to notice.
  await syncOpenTurnovers(supabase, input.pmAccountId);

  const { data: rows } = await supabase
    .from("property_manager_turnovers")
    .select(
      "id, unit_id, service_type, needed_by_date, scheduled_date, completed_at, price_cents, final_price_cents, scope_adjustment_cents, status, invoice_id",
    )
    .eq("pm_account_id", input.pmAccountId)
    .eq("status", "completed")
    .is("invoice_id", null)
    .lte("needed_by_date", input.period.end);

  const inPeriod = ((rows || []) as Row[]).filter((r) => {
    const day = servicedDay(r);
    return day >= input.period.start && day <= input.period.end;
  });

  const unitIds = Array.from(new Set(inPeriod.map((r) => String(r.unit_id))));
  const unitsById = new Map<string, Row>();
  if (unitIds.length) {
    const { data: units } = await supabase
      .from("property_manager_units")
      .select("id, unit_label, address, city, state")
      .in("id", unitIds);
    for (const u of (units || []) as Row[]) unitsById.set(String(u.id), u);
  }

  const grouped = new Map<string, InvoiceUnitLine>();
  for (const row of inPeriod) {
    const unitId = String(row.unit_id);
    const unit = unitsById.get(unitId);
    if (!grouped.has(unitId)) {
      grouped.set(unitId, {
        unitId,
        unitLabel: unit
          ? unitDisplayName(unit as { unit_label?: string | null; address?: string | null })
          : "Unit",
        address: (unit?.address as string) || null,
        turnovers: [],
        subtotalCents: 0,
      });
    }
    const line = grouped.get(unitId)!;
    const service = String(row.service_type) as PmServiceType;
    const amount = Math.max(
      0,
      Math.round(Number(row.final_price_cents ?? row.price_cents ?? 0)),
    );
    line.turnovers.push({
      turnoverId: String(row.id),
      serviceType: service,
      serviceLabel: PM_SERVICE_LABELS[service] || service,
      servicedOn: servicedDay(row),
      amountCents: amount,
      scopeAdjustmentCents: Math.round(Number(row.scope_adjustment_cents || 0)),
    });
    line.subtotalCents += amount;
  }

  const units = Array.from(grouped.values()).sort((a, b) =>
    a.unitLabel.localeCompare(b.unitLabel),
  );
  for (const u of units) u.turnovers.sort((a, b) => a.servicedOn.localeCompare(b.servicedOn));

  return {
    pmAccountId: input.pmAccountId,
    period: input.period,
    units,
    turnoverCount: inPeriod.length,
    unitCount: units.length,
    subtotalCents: units.reduce((sum, u) => sum + u.subtotalCents, 0),
    dueDate: dueDateFor(input.period.end, input.netTerms),
    netTermsLabel: netTermsLabel(input.netTerms),
  };
}


function servicedDay(row: Row): string {
  const completed = row.completed_at ? String(row.completed_at).slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(completed)) return completed;
  const scheduled = row.scheduled_date ? String(row.scheduled_date).slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) return scheduled;
  return String(row.needed_by_date || "").slice(0, 10);
}

/** The line as it reads on the invoice: unit first, so it sorts by property. */
export function lineDescription(unit: InvoiceUnitLine, turnover: InvoiceTurnoverLine): string {
  const base = `${unit.unitLabel} — ${turnover.serviceLabel} · ${shortDay(turnover.servicedOn)}`;
  return turnover.scopeAdjustmentCents > 0
    ? `${base} (includes approved scope adjustment)`
    : base;
}

// ─── Issuing ───────────────────────────────────────────────────────────────

export interface IssueInvoiceResult {
  ok: boolean;
  status: number;
  message: string;
  invoiceId?: string;
  stripeInvoiceId?: string | null;
  hostedInvoiceUrl?: string | null;
  subtotalCents?: number;
  unitCount?: number;
  turnoverCount?: number;
}

/**
 * Issue the period's consolidated invoice.
 *
 * Idempotent on (account, period): a second run returns the invoice already
 * issued rather than double-billing a portfolio. Turnovers are stamped with
 * the invoice id only after Stripe accepts it, so a Stripe failure leaves
 * them billable next run instead of stranding them as invoiced-but-unsent.
 */
export async function issueConsolidatedInvoice(
  supabase: Admin,
  input: {
    pmAccountId: string;
    period?: BillingPeriod;
    actorName?: string | null;
    /** Build and store the statement without sending it to Stripe. */
    dryRun?: boolean;
  },
): Promise<IssueInvoiceResult> {
  const { data: account } = await supabase
    .from("property_manager_accounts")
    .select(
      "id, company_name, email, billing_method, invoice_cycle, net_terms, stripe_customer_id, default_payment_method_id",
    )
    .eq("id", input.pmAccountId)
    .maybeSingle();
  if (!account) return { ok: false, status: 404, message: "Property manager account not found." };

  const acct = account as Row;
  const cycle = (String(acct.invoice_cycle || "monthly") as InvoiceCycle) || "monthly";
  const period = input.period || lastClosedPeriod(cycle);

  const { data: existing } = await supabase
    .from("property_manager_invoices")
    .select("id, stripe_invoice_id, hosted_invoice_url, subtotal_cents, unit_count, turnover_count, status")
    .eq("pm_account_id", input.pmAccountId)
    .eq("period_start", period.start)
    .eq("period_end", period.end)
    .maybeSingle();
  if (existing && String((existing as Row).status) !== "draft") {
    const row = existing as Row;
    return {
      ok: true,
      status: 200,
      message: `${period.label} is already invoiced.`,
      invoiceId: String(row.id),
      stripeInvoiceId: (row.stripe_invoice_id as string) || null,
      hostedInvoiceUrl: (row.hosted_invoice_url as string) || null,
      subtotalCents: Number(row.subtotal_cents || 0),
      unitCount: Number(row.unit_count || 0),
      turnoverCount: Number(row.turnover_count || 0),
    };
  }

  const draft = await buildInvoiceDraft(supabase, {
    pmAccountId: input.pmAccountId,
    period,
    netTerms: acct.net_terms as string,
  });
  if (draft.turnoverCount === 0) {
    return {
      ok: true,
      status: 200,
      message: `No completed turnovers in ${period.label} — nothing to invoice.`,
      subtotalCents: 0,
      unitCount: 0,
      turnoverCount: 0,
    };
  }


  const recordPatch: Row = {
    pm_account_id: input.pmAccountId,
    period_start: period.start,
    period_end: period.end,
    line_items: draft.units,
    turnover_count: draft.turnoverCount,
    unit_count: draft.unitCount,
    subtotal_cents: draft.subtotalCents,
    due_date: draft.dueDate,
    status: "draft",
    created_by_name: clip(input.actorName, 120) || null,
  };

  const { data: record, error: recordError } = existing
    ? await supabase
        .from("property_manager_invoices")
        .update(recordPatch)
        .eq("id", (existing as Row).id as string)
        .select("id")
        .single()
    : await supabase.from("property_manager_invoices").insert(recordPatch).select("id").single();
  if (recordError || !record) {
    return { ok: false, status: 400, message: recordError?.message || "Could not build that invoice." };
  }
  const invoiceId = String((record as Row).id);

  if (input.dryRun) {
    return {
      ok: true,
      status: 200,
      message: `${period.label}: ${draft.turnoverCount} turnover${draft.turnoverCount === 1 ? "" : "s"} across ${draft.unitCount} unit${draft.unitCount === 1 ? "" : "s"} — ${formatRate(draft.subtotalCents)}.`,
      invoiceId,
      subtotalCents: draft.subtotalCents,
      unitCount: draft.unitCount,
      turnoverCount: draft.turnoverCount,
    };
  }

  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return { ok: false, status: 503, message: "Stripe is not configured on this environment." };
  }

  const email = clip(acct.email, 200);
  if (!email) {
    return { ok: false, status: 409, message: "Add a billing email to this account before invoicing." };
  }

  try {
    const customerId = await ensurePmCustomer(stripeKey, {
      accountId: input.pmAccountId,
      email,
      companyName: clip(acct.company_name, 200) || "Property manager",
      existingId: (acct.stripe_customer_id as string) || null,
    });
    if (customerId !== acct.stripe_customer_id) {
      await supabase
        .from("property_manager_accounts")
        .update({ stripe_customer_id: customerId })
        .eq("id", input.pmAccountId);
    }

    const autoPay = String(acct.billing_method) === "auto_pay";
    const params: Record<string, string> = {
      customer: customerId,
      collection_method: autoPay ? "charge_automatically" : "send_invoice",
      description: `Turnover services — ${period.label}`,
      footer:
        `Consolidated statement for ${draft.unitCount} unit${draft.unitCount === 1 ? "" : "s"} ` +
        `across ${draft.turnoverCount} turnover${draft.turnoverCount === 1 ? "" : "s"}.`,
      auto_advance: "false",
      "metadata[pm_account_id]": input.pmAccountId,
      "metadata[pm_invoice_id]": invoiceId,
      "metadata[period_start]": period.start,
      "metadata[period_end]": period.end,
      "metadata[kind]": "property_manager_consolidated",
    };
    if (!autoPay) {
      params.days_until_due = String(DAYS_UNTIL_DUE[String(acct.net_terms || "net_15")] ?? 15);
    }
    const invoice = await stripeCall(stripeKey, "POST", "invoices", params);
    const stripeInvoiceId = String(invoice.id);

    // One Stripe line per turnover, described unit-first, added unit by unit
    // so the finalized invoice reads as a list of properties.
    for (const unit of draft.units) {
      for (const turnover of unit.turnovers) {
        await stripeCall(stripeKey, "POST", "invoiceitems", {
          customer: customerId,
          invoice: stripeInvoiceId,
          amount: String(turnover.amountCents),
          currency: "usd",
          description: lineDescription(unit, turnover).slice(0, 250),
          "metadata[pm_unit_id]": unit.unitId,
          "metadata[pm_turnover_id]": turnover.turnoverId,
        });
      }
    }

    const finalized = await stripeCall(
      stripeKey,
      "POST",
      `invoices/${stripeInvoiceId}/finalize`,
      { auto_advance: "true" },
    );

    const hostedUrl = (finalized.hosted_invoice_url as string) || (finalized.invoice_pdf as string) || null;
    await supabase
      .from("property_manager_invoices")
      .update({
        stripe_invoice_id: stripeInvoiceId,
        stripe_customer_id: customerId,
        hosted_invoice_url: hostedUrl,
        status: String(finalized.status || "open"),
        issued_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    const turnoverIds = draft.units.flatMap((u) => u.turnovers.map((t) => t.turnoverId));
    await supabase
      .from("property_manager_turnovers")
      .update({ invoice_id: invoiceId, invoiced_at: new Date().toISOString() })
      .in("id", turnoverIds);

    await supabase.from("events").insert({
      event_type: "property_manager.invoice.issued",
      source: "property-manager",
      summary:
        `Consolidated ${period.label} invoice issued to ${clip(acct.company_name, 120)} — ` +
        `${draft.turnoverCount} turnovers across ${draft.unitCount} units, ${formatRate(draft.subtotalCents)}.`,
      data: {
        pm_account_id: input.pmAccountId,
        invoice_id: invoiceId,
        stripe_invoice_id: stripeInvoiceId,
        period_start: period.start,
        period_end: period.end,
        unit_count: draft.unitCount,
        turnover_count: draft.turnoverCount,
        subtotal_cents: draft.subtotalCents,
      },
    });

    return {
      ok: true,
      status: 200,
      message: `${period.label} invoiced: ${draft.turnoverCount} turnover${draft.turnoverCount === 1 ? "" : "s"} across ${draft.unitCount} unit${draft.unitCount === 1 ? "" : "s"}, ${formatRate(draft.subtotalCents)}.`,
      invoiceId,
      stripeInvoiceId,
      hostedInvoiceUrl: hostedUrl,
      subtotalCents: draft.subtotalCents,
      unitCount: draft.unitCount,
      turnoverCount: draft.turnoverCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("events").insert({
      event_type: "property_manager.invoice.failed",
      source: "property-manager",
      summary: `Could not issue the ${period.label} invoice for ${clip(acct.company_name, 120)}.`,
      data: { pm_account_id: input.pmAccountId, invoice_id: invoiceId, error: message },
    });
    return { ok: false, status: 502, message: `Stripe rejected the invoice: ${message}` };
  }
}

async function ensurePmCustomer(
  stripeKey: string,
  args: { accountId: string; email: string; companyName: string; existingId?: string | null },
): Promise<string> {
  if (args.existingId) return args.existingId;
  const found = await stripeCall(stripeKey, "GET", "customers", { email: args.email, limit: "1" });
  const existing = found?.data?.[0]?.id as string | undefined;
  if (existing) return existing;
  const created = await stripeCall(stripeKey, "POST", "customers", {
    email: args.email,
    name: args.companyName,
    "metadata[pm_account_id]": args.accountId,
    "metadata[kind]": "property_manager",
  });
  return String(created.id);
}

// ─── Reading them back ─────────────────────────────────────────────────────

export interface PortalInvoice {
  id: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  unitCount: number;
  turnoverCount: number;
  status: "paid" | "outstanding" | "overdue";
  statusLabel: string;
  dueDate: string | null;
  url: string | null;
  /** Per-unit breakdown, so the portal can show what each property cost. */
  units: InvoiceUnitLine[];
}

export function publicInvoice(row: Row, nowDay?: string): PortalInvoice {
  const status = facingInvoiceStatus({
    status: String(row.status || "open"),
    dueDate: (row.due_date as string) || null,
    nowDay,
  });
  return {
    id: String(row.id),
    periodLabel: periodLabelFor(String(row.period_start), String(row.period_end)),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    amountCents: Number(row.subtotal_cents || 0),
    unitCount: Number(row.unit_count || 0),
    turnoverCount: Number(row.turnover_count || 0),
    status,
    statusLabel: status === "paid" ? "Paid" : status === "overdue" ? "Past due" : "Due",
    dueDate: (row.due_date as string) || null,
    url: (row.hosted_invoice_url as string) || null,
    units: Array.isArray(row.line_items) ? (row.line_items as InvoiceUnitLine[]) : [],
  };
}

export function periodLabelFor(start: string, end: string): string {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const firstOfMonth = start.slice(8, 10) === "01";
  return sameMonth && firstOfMonth ? monthLabel(start) : `${shortDay(start)} – ${shortDay(end)}`;
}

export async function listPmInvoices(
  supabase: Admin,
  pmAccountId: string,
): Promise<PortalInvoice[]> {
  const { data } = await supabase
    .from("property_manager_invoices")
    .select(
      "id, period_start, period_end, subtotal_cents, unit_count, turnover_count, status, due_date, hosted_invoice_url, line_items",
    )
    .eq("pm_account_id", pmAccountId)
    .neq("status", "draft")
    .order("period_start", { ascending: false })
    .limit(24);
  const today = new Date().toISOString().slice(0, 10);
  return ((data || []) as Row[]).map((row) => publicInvoice(row, today));
}

/** Refresh local status from Stripe. Stripe stays the source of truth. */
export async function syncInvoiceStatus(
  supabase: Admin,
  invoiceId: string,
): Promise<{ ok: boolean; status: string | null }> {
  const { data } = await supabase
    .from("property_manager_invoices")
    .select("id, stripe_invoice_id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  const row = data as Row | null;
  if (!row?.stripe_invoice_id) return { ok: false, status: null };

  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return { ok: false, status: null };
  try {
    const invoice = await stripeCall(stripeKey, "GET", `invoices/${String(row.stripe_invoice_id)}`);
    const status = String(invoice.status || "");
    if (status && status !== row.status) {
      await supabase
        .from("property_manager_invoices")
        .update({ status, hosted_invoice_url: invoice.hosted_invoice_url || null })
        .eq("id", invoiceId);
    }
    return { ok: true, status };
  } catch {
    return { ok: false, status: null };
  }
}
