// ─── Sync orchestration: Supabase source → mappers → Airtable ─────────────────
//
// Fetches the full source record(s) with the service-role client, builds the
// normalized mapper input via the source adapters, and upserts into Airtable.
// Used by the webhook route (live triggers) and the backfill script.

import { getAdminSupabase } from "./sources/admin-client";
import {
  bookingToClientInput,
  bookingToJobInput,
  customerToClientInput,
  type CleanerRow,
} from "./sources/supabase";
import { syncClient, syncJob, syncPayrollRun } from "./mappers";
import { CLIENT_FIELDS, CLIENT_TYPE, ENTRY_SOURCE, JOB_FIELDS, PAYROLL_RUN_FIELDS, TABLES } from "./schema";
import { createField, deleteRecords, listRecords, listTableFields } from "./client";
import { payPeriodMonday, payPeriodSunday } from "./pay";

/** Normalize emails for Clients keep/purge matching. */
function normEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

let keepEmailCache: { emails: Set<string>; at: number } | null = null;
const KEEP_EMAIL_TTL_MS = 60_000;

/**
 * Clients table keep-set: anyone who finished an actual booking, plus STR
 * hosts (Properties link into Clients). Leads / quotes / abandoned carts and
 * internal QA accounts do not belong here.
 */
export async function emailsThatBelongInClients(): Promise<Set<string>> {
  if (keepEmailCache && Date.now() - keepEmailCache.at < KEEP_EMAIL_TTL_MS) {
    return keepEmailCache.emails;
  }
  const supabase = getAdminSupabase();
  const keep = new Set<string>();

  const [{ data: completed }, { data: hosts }] = await Promise.all([
    supabase
      .from("bookings")
      .select("email")
      .eq("status", "completed")
      .not("email", "is", null)
      .limit(5000),
    supabase.from("hosts").select("email").not("email", "is", null).limit(1000),
  ]);

  for (const row of completed || []) {
    const e = normEmail(row.email);
    if (e) keep.add(e);
  }
  for (const row of hosts || []) {
    const e = normEmail(row.email);
    if (e) keep.add(e);
  }
  keepEmailCache = { emails: keep, at: Date.now() };
  return keep;
}

/** True when this customer email may occupy a Clients row. */
export async function customerBelongsInClients(email: string | null | undefined): Promise<boolean> {
  const e = normEmail(email);
  if (!e) return false;
  return (await emailsThatBelongInClients()).has(e);
}

/**
 * Delete Airtable Clients rows that are not completed-booking clients and not
 * partner (STR Host / Commercial) records. Idempotent.
 */
export async function purgeStaleClients(): Promise<{ kept: number; deleted: number }> {
  const keepEmails = await emailsThatBelongInClients();
  const existing = await listRecords(TABLES.clients);
  const stale: string[] = [];
  let kept = 0;
  for (const rec of existing) {
    const email = normEmail(rec.fields[CLIENT_FIELDS.email]);
    const type = String(rec.fields[CLIENT_FIELDS.clientType] || "");
    const isPartner = type === CLIENT_TYPE.strHost || type === CLIENT_TYPE.commercial;
    if (isPartner || (email && keepEmails.has(email))) {
      kept += 1;
      continue;
    }
    stale.push(rec.id);
  }
  if (stale.length) await deleteRecords(TABLES.clients, stale);
  return { kept, deleted: stale.length };
}

// ─── QC documentation fields (Drive Folder / Documented) ─────────────────────
// Written by NAME; created lazily via the Meta API on first use so the sync
// never hard-fails on a base that predates the QC hub. Cached per lambda.
let qcJobFieldsReady: boolean | null = null;
async function ensureQcJobFields(): Promise<boolean> {
  if (qcJobFieldsReady !== null) return qcJobFieldsReady;
  try {
    const fields = await listTableFields(TABLES.jobs);
    const names = new Set(fields.map((f) => f.name));
    if (!names.has(JOB_FIELDS.driveFolder)) {
      await createField(TABLES.jobs, { name: JOB_FIELDS.driveFolder, type: "url" });
    }
    if (!names.has(JOB_FIELDS.documented)) {
      await createField(TABLES.jobs, {
        name: JOB_FIELDS.documented,
        type: "checkbox",
        options: { icon: "check", color: "greenBright" },
      });
    }
    qcJobFieldsReady = true;
  } catch {
    qcJobFieldsReady = false;
  }
  return qcJobFieldsReady;
}

const ASSIGNMENT_STATUSES = ["Confirmed", "Accepted", "accepted", "In Progress", "Completed"];

const AGREEMENT_TYPE_BY_AUDIENCE: Record<string, string> = {
  one_time: "One-Time",
  membership: "Recurring",
  str_host: "STR Partnership",
  commercial: "Commercial",
};

/**
 * Hunt down the client's remaining data points so every Airtable column that
 * CAN be filled IS filled: lifecycle from real booking history, agreement date
 * + type from DocuSeal, payment method from Stripe.
 */
async function clientEnrichment(email: string, customer?: {
  membership_status?: string | null;
  membership_plan?: string | null;
}): Promise<Partial<import("./mappers/types").ClientInput>> {
  const supabase = getAdminSupabase();
  const extra: Partial<import("./mappers/types").ClientInput> = {};

  // Lifecycle from actual booking history.
  try {
    const { data: bks } = await supabase
      .from("bookings")
      .select("status")
      .eq("email", email)
      .limit(100);
    const statuses = (bks || []).map((b) => String(b.status || "").toLowerCase());
    const isMember =
      String(customer?.membership_status || "") === "active" ||
      (customer?.membership_plan && customer.membership_plan !== "none");
    extra.lifecycleStage = isMember
      ? "Member"
      : statuses.includes("completed")
        ? "Active"
        : statuses.length > 0
          ? "Quoted"
          : "Lead";
  } catch {
    /* best-effort */
  }

  // Signed agreement (date + type) from DocuSeal.
  try {
    const { data: subs } = await supabase
      .from("docuseal_submissions")
      .select("audience, status, created_at")
      .ilike("submitter_email", email)
      .in("audience", ["one_time", "membership", "str_host"])
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1);
    const sub = (subs || [])[0];
    if (sub) {
      extra.agreementSignedDate = String(sub.created_at || "").slice(0, 10) || undefined;
      extra.agreementType = AGREEMENT_TYPE_BY_AUDIENCE[String(sub.audience)] || undefined;
    }
  } catch {
    /* best-effort */
  }

  return extra;
}

/** Upsert a client by Supabase customer id (only if they belong in Clients). */
export async function syncClientById(customerId: string): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!(await customerBelongsInClients(data.email))) return null;
  const extra = await clientEnrichment(data.email, data);
  return syncClient(customerToClientInput(data, extra));
}

/** Upsert a client by email (only if they belong in Clients). */
export async function syncClientByEmail(email: string): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data } = await supabase.from("customers").select("*").eq("email", email).maybeSingle();
  if (!data) return null;
  if (!(await customerBelongsInClients(data.email))) return null;
  const extra = await clientEnrichment(email, data);
  return syncClient(customerToClientInput(data, extra));
}

/** Resolve the cleaners assigned to a booking via its dispatch job. */
async function cleanersForBooking(jobId: string | null | undefined): Promise<CleanerRow[]> {
  if (!jobId) return [];
  const supabase = getAdminSupabase();
  const { data: assigns } = await supabase
    .from("job_assignments")
    .select("cleaner_id, status")
    .eq("job_id", jobId)
    .in("status", ASSIGNMENT_STATUSES);
  const ids = Array.from(
    new Set((assigns || []).map((a: { cleaner_id: string | null }) => a.cleaner_id).filter(Boolean)),
  ) as string[];
  if (!ids.length) return [];
  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, pay_tier, pay_percentage")
    .in("id", ids);
  return (cleaners || []) as CleanerRow[];
}

/**
 * Upsert a job from a booking id. Ensures the client exists first so the
 * Job→Client link resolves on the first pass.
 */
export async function syncJobByBookingId(
  bookingId: string,
  opts?: { entrySource?: string },
): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, status, service_type, service_date, completed_at, email, first_name, last_name, phone, city, state, zip_code, final_charge_cents, total_estimate_cents, cleaner_payout_cents, num_cleaners_assigned, booking_channel, membership_plan, job_id, customer_id",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return null;

  // Clients table = finished bookings only. Sync the linked client when this
  // booking is completed (or the email already qualifies via another completed
  // job / partner identity). Prefer the full customer record; fall back to the
  // booking's own contact fields when there's no matching customer row.
  const bookingCompleted = String(booking.status || "").toLowerCase() === "completed";
  if (bookingCompleted || (await customerBelongsInClients(booking.email))) {
    let clientSynced = false;
    if (booking.customer_id) {
      clientSynced = (await syncClientById(booking.customer_id).catch(() => null)) != null;
    }
    if (!clientSynced) {
      const clientInput = bookingToClientInput(booking);
      if (clientInput) await syncClient(clientInput).catch(() => null);
    }
  }

  const cleaners = await cleanersForBooking(booking.job_id);

  // ── Authoritative pay from the REAL ledgers (custom payout + extra pay) ──
  // The tier-% estimate is only a fallback; when money was actually recorded
  // for this job, Airtable must show exactly that.
  const [{ data: payout }, { data: extras }] = await Promise.all([
    supabase
      .from("manual_payouts")
      .select("amount_cents, status, cleaner_breakdown, cleaner_name")
      .eq("booking_id", bookingId)
      .neq("status", "cancelled")
      .maybeSingle(),
    supabase
      .from("job_extra_pay")
      .select("total_cents, status")
      .eq("booking_id", bookingId)
      .neq("status", "failed"),
  ]);

  const extraCents = (extras || []).reduce((s, e) => s + (Number(e.total_cents) || 0), 0);
  const breakdown = Array.isArray(payout?.cleaner_breakdown) ? payout?.cleaner_breakdown : [];
  const crewCount = Math.max(cleaners.length, breakdown.length, Number(booking.num_cleaners_assigned) || 0, 0);

  let poolCents: number | undefined;
  let perCleanerCents: number | undefined;
  let paymentStatus: string | undefined;
  if (payout) {
    poolCents = (Number(payout.amount_cents) || 0) + extraCents;
    perCleanerCents = Math.round(poolCents / Math.max(1, crewCount));
    const extrasAllPaid = (extras || []).every((e) => String(e.status) === "paid");
    paymentStatus = String(payout.status) === "paid" && extrasAllPaid ? "Paid" : "Pending";
  } else if (extraCents > 0) {
    poolCents = extraCents;
    perCleanerCents = Math.round(extraCents / Math.max(1, crewCount));
    paymentStatus = (extras || []).every((e) => String(e.status) === "paid") ? "Paid" : "Pending";
  } else {
    // No money recorded yet — the job hasn't been paid regardless of booking status.
    paymentStatus = String(booking.status || "").toLowerCase() === "cancelled" ? "Failed" : "Pending";
  }

  const input = bookingToJobInput(booking, cleaners, {
    entrySource: opts?.entrySource,
    cleanerPayPoolCents: poolCents,
    payPerCleanerCents: perCleanerCents,
    paymentStatus,
    numberOfCleaners: crewCount || undefined,
  });
  if (!input.cleanerName && payout?.cleaner_name) input.cleanerName = String(payout.cleaner_name);

  // ── QC documentation: Drive link + "documented ✓" onto the job record ──
  try {
    const { data: doc } = await supabase
      .from("job_documentation")
      .select("documented, drive_folder_url, mirror_status")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (doc && (await ensureQcJobFields())) {
      input.documented = Boolean(doc.documented);
      if (doc.mirror_status === "mirrored" && doc.drive_folder_url) {
        input.driveFolderUrl = String(doc.drive_folder_url);
      }
    }
  } catch {
    /* best-effort — job sync must not fail on QC enrichment */
  }

  return syncJob(input);
}

/**
 * Build + upsert all weekly payroll runs (Mon–Sun per cleaner) from Custom
 * Payroll only (`manual_payouts`). Extra-pay / supplies / mileage rows do not
 * belong in this table. Stale runs (extras-only or retired sources) are purged
 * so Payroll Runs mirrors the custom-payout ledger exactly.
 */
export async function syncAllPayrollRuns(limit = 1000): Promise<number> {
  const supabase = getAdminSupabase();

  interface RunAcc {
    cleanerId: string;
    monday: string;
    grossCents: number;
    bookingIds: Set<string>;
    components: number;
    paidComponents: number;
    lastPaidAt?: string;
  }
  const runs = new Map<string, RunAcc>();
  const cleanerIds = new Set<string>();

  const acc = (cleanerId: string, monday: string): RunAcc => {
    const key = `${cleanerId}_${monday}`;
    let r = runs.get(key);
    if (!r) {
      r = { cleanerId, monday, grossCents: 0, bookingIds: new Set(), components: 0, paidComponents: 0 };
      runs.set(key, r);
    }
    return r;
  };

  const { data: payouts } = await supabase
    .from("manual_payouts")
    .select("id, booking_id, cleaner_id, cleaner_name, cleaner_breakdown, service_date, amount_cents, status, created_at, paid_at")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const p of payouts || []) {
    const date = (p.service_date || p.created_at || "").slice(0, 10);
    if (!date) continue;
    const monday = payPeriodMonday(date);
    const breakdown = Array.isArray(p.cleaner_breakdown) && p.cleaner_breakdown.length
      ? (p.cleaner_breakdown as { cleanerId?: string; amountCents?: number }[])
      : p.cleaner_id
        ? [{ cleanerId: String(p.cleaner_id), amountCents: Number(p.amount_cents) || 0 }]
        : [];
    for (const b of breakdown) {
      const cid = String(b.cleanerId || "");
      if (!cid) continue;
      cleanerIds.add(cid);
      const r = acc(cid, monday);
      r.grossCents += Number(b.amountCents) || 0;
      if (p.booking_id) r.bookingIds.add(String(p.booking_id));
      r.components += 1;
      if (String(p.status) === "paid") {
        r.paidComponents += 1;
        const paidDate = String(p.paid_at || "").slice(0, 10);
        if (paidDate && (!r.lastPaidAt || paidDate > r.lastPaidAt)) r.lastPaidAt = paidDate;
      }
    }
  }

  const cleanerNameById: Record<string, string> = {};
  if (cleanerIds.size) {
    const { data: cleaners } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name")
      .in("id", Array.from(cleanerIds));
    for (const c of cleaners || []) {
      cleanerNameById[c.id] = `${c.first_name || ""} ${c.last_name || ""}`.trim();
    }
  }

  const jobRecordIdByBookingId: Record<string, string> = {};
  try {
    const jobRecords = await listRecords(TABLES.jobs);
    for (const j of jobRecords) {
      const jobId = String(j.fields[JOB_FIELDS.jobId] || "");
      if (jobId) jobRecordIdByBookingId[jobId] = j.id;
    }
  } catch {
    /* links are best-effort */
  }

  const keepRunIds = new Set<string>();
  let ok = 0;
  for (const r of runs.values()) {
    const runId = `${r.cleanerId}_${r.monday}`;
    keepRunIds.add(runId);
    const gross = Math.round(r.grossCents) / 100;
    const jobRecordIds = Array.from(r.bookingIds)
      .map((bid) => jobRecordIdByBookingId[bid])
      .filter(Boolean) as string[];
    const allPaid = r.components > 0 && r.paidComponents === r.components;
    try {
      await syncPayrollRun({
        runId,
        cleanerName: cleanerNameById[r.cleanerId] || "Cleaner",
        periodStart: r.monday,
        periodEnd: payPeriodSunday(r.monday),
        totalJobs: r.bookingIds.size || r.components,
        grossPay: gross,
        bonus: 0,
        deduction: 0,
        netPay: gross,
        paymentMethod: "Manual",
        status: allPaid ? "Paid" : "Pending",
        sentAt: allPaid ? r.lastPaidAt : undefined,
        notes: r.components > 0 ? `Custom payouts ×${r.components}: $${gross.toFixed(2)}` : undefined,
        jobRecordIds,
      });
      ok++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[airtable] payroll run ${runId} failed:`, (err as Error).message);
    }
  }

  try {
    const existing = await listRecords(TABLES.payrollRuns);
    const stale = existing
      .filter((rec) => !keepRunIds.has(String(rec.fields[PAYROLL_RUN_FIELDS.runId] || "")))
      .map((rec) => rec.id);
    if (stale.length) await deleteRecords(TABLES.payrollRuns, stale);
  } catch {
    /* purge is best-effort */
  }

  return ok;
}

export const DEFAULT_LIVE_ENTRY_SOURCE = ENTRY_SOURCE.webhook;
