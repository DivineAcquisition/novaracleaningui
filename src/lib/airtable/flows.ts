// ─── Flow registry: one place that runs every Airtable sync flow ──────────────
//
// The queue worker, the reconcile pass, and the (kept-for-compat) HTTP routes
// all execute flows through runFlow() so behavior is identical no matter what
// triggered the sync. Each flow uses the EXISTING mappers, merge keys and
// direction — this file adds no new mappings.
//
//   client        customers        → Clients            (merge: Email)
//   job           bookings         → Jobs               (merge: Job ID)
//   payroll_runs  pay ledgers      → Payroll Runs       (merge: Run ID)
//   qc_issue(s)   qc_issues        → QC Issues          (merge: Issue ID)
//   partner       hosts/properties → Clients/Properties (merge: Email/Nickname; identity only —
//                                     Airtable keeps owning rates/status/lifecycle)
//   turnover      turnover_requests→ Jobs               (merge: Job ID = STR-{id})
//   contractors   cleaners         → Contractors        (merge: Email)
//   vas           va_onboarding    → VAs                (merge: Email)
//   commercial    business_accounts/sites → Commercial Accounts/Sites (merge: names)
//
// All flows are idempotent upserts: re-running (or replaying after downtime)
// updates in place and never re-fires side effects — no notification, email or
// SMS is ever sent from here.

import { getAdminSupabase } from "./sources/admin-client";
import {
  syncAllPayrollRuns,
  syncClientByEmail,
  syncClientById,
  syncJobByBookingId,
  DEFAULT_LIVE_ENTRY_SOURCE,
} from "./sync";
import { syncAllQcIssues, syncQcIssueById } from "./qc";
import { syncContractors } from "./contractors";
import { syncVas } from "./vas";
import { syncClient, syncCommercialAccount, syncJob, syncProperty, syncSite } from "./mappers";
import { invalidatePartnerSnapshot } from "./partner-admin";
import { CLIENT_TYPE, ENTRY_SOURCE, JOB_SERVICE_TYPE, PAYMENT_STATUS } from "./schema";
import { flagForReview } from "./telemetry";

export type FlowName =
  | "client"
  | "job"
  | "payroll_runs"
  | "qc_issue"
  | "qc_issues_all"
  | "partner"
  | "turnover"
  | "contractors"
  | "vas"
  | "commercial";

export const FLOW_NAMES: FlowName[] = [
  "client",
  "job",
  "payroll_runs",
  "qc_issue",
  "qc_issues_all",
  "partner",
  "turnover",
  "contractors",
  "vas",
  "commercial",
];

/**
 * An error retrying can never fix (missing identity key, malformed payload).
 * The worker flags it for admin review and stops retrying instead of burning
 * attempts against the same wall.
 */
export class FlowPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowPermanentError";
  }
}

export interface FlowResult {
  status: "success" | "skipped";
  records: number;
  detail?: Record<string, unknown>;
}

// ─── partner: hosts + properties identity sync (moved from the API route) ────

/**
 * Reconcile the operational STR data in Supabase (hosts + properties) into the
 * Airtable Client & Revenue Ops base. Identity-only: pricing, lifecycle and
 * status remain OWNED by Airtable, so this can never clobber admin-set rates.
 * Rows without their merge key are flagged for review — never guessed.
 */
export async function syncAllPartners(): Promise<FlowResult> {
  const supabase = getAdminSupabase();

  const [{ data: hosts, error: hErr }, { data: properties, error: pErr }] = await Promise.all([
    supabase.from("hosts").select("id, name, email, phone, status"),
    supabase.from("properties").select("id, nickname, address, bedrooms, bathrooms, host_id"),
  ]);
  if (hErr) throw new Error(`Read hosts failed: ${hErr.message}`);
  if (pErr) throw new Error(`Read properties failed: ${pErr.message}`);

  const hostById = new Map<string, { email: string | null; name: string | null }>();
  const hostsByEmail = new Map<string, string[]>();
  const warnings: string[] = [];
  let hostsSynced = 0;

  for (const h of hosts || []) {
    hostById.set(h.id as string, { email: (h.email as string) || null, name: (h.name as string) || null });
    const email = String(h.email || "").trim().toLowerCase();
    if (!email) {
      // Email is the merge key — an unidentifiable host must be reviewed, not guessed.
      await flagForReview({
        flow: "partner",
        reason: "identity",
        recordRef: String(h.id),
        airtableTable: "Clients",
        message: `Host "${h.name || h.id}" has no email (the Clients merge key) — cannot sync until one is set.`,
      });
      continue;
    }
    hostsByEmail.set(email, [...(hostsByEmail.get(email) || []), String(h.id)]);
    try {
      await syncClient({
        email: String(h.email),
        name: (h.name as string) || String(h.email),
        phone: (h.phone as string) || undefined,
        type: CLIENT_TYPE.strHost,
      });
      hostsSynced += 1;
    } catch (err) {
      warnings.push(`Host ${h.email}: ${(err as Error).message}`);
    }
  }

  // Two workspace hosts sharing one email would silently merge into a single
  // Airtable client — surface the ambiguity instead.
  for (const [email, ids] of hostsByEmail) {
    if (ids.length > 1) {
      await flagForReview({
        flow: "partner",
        reason: "identity",
        recordRef: email,
        airtableTable: "Clients",
        message: `${ids.length} workspace hosts share the email ${email} — they merge into ONE Airtable client. Confirm this is intended or fix the duplicate.`,
        detail: { hostIds: ids },
      });
    }
  }

  let propertiesSynced = 0;
  for (const p of properties || []) {
    const nickname = (p.nickname as string)?.trim();
    if (!nickname) {
      await flagForReview({
        flow: "partner",
        reason: "identity",
        recordRef: String(p.id),
        airtableTable: "Properties",
        message: `Property ${p.id} has no nickname (the Properties merge key) — cannot sync until one is set.`,
      });
      continue;
    }
    const host = p.host_id ? hostById.get(p.host_id as string) : undefined;
    try {
      await syncProperty({
        nickname,
        address: (p.address as string) || undefined,
        bedrooms: typeof p.bedrooms === "number" ? p.bedrooms : undefined,
        bathrooms: typeof p.bathrooms === "number" ? p.bathrooms : undefined,
        // Identity + host link only — Airtable owns rates/status/lifecycle.
        hostEmail: host?.email || undefined,
      });
      propertiesSynced += 1;
    } catch (err) {
      warnings.push(`Property ${nickname}: ${(err as Error).message}`);
    }
  }

  // Next Host Accounts read reflects this sync immediately.
  invalidatePartnerSnapshot();

  if (warnings.length && hostsSynced === 0 && propertiesSynced === 0) {
    throw new Error(warnings.slice(0, 3).join(" · "));
  }
  return {
    status: "success",
    records: hostsSynced + propertiesSynced,
    detail: { hostsSynced, propertiesSynced, warnings: warnings.slice(0, 20) },
  };
}

// ─── turnover: completed STR turnover → Job row (moved from the API route) ───

// Cleaner keeps 70% of the turnover price (mirrors _shared/turnover-engine.ts).
const CLEANER_SHARE = 0.7;

/**
 * Map a COMPLETED partner turnover into Airtable as a Job (merge on Job ID =
 * STR-{turnoverId}), including the authoritative cleaner pay. Idempotent; the
 * bookkeeping stamps it writes don't re-fire the completion trigger.
 */
export async function syncTurnoverJob(turnoverId: string): Promise<FlowResult> {
  if (!turnoverId) throw new FlowPermanentError("turnoverId required");
  const supabase = getAdminSupabase();

  const { data: tr } = await supabase
    .from("turnover_requests")
    .select("*")
    .eq("id", turnoverId)
    .maybeSingle();
  if (!tr) return { status: "skipped", records: 0, detail: { reason: "turnover not found" } };
  if (tr.status !== "completed") {
    return { status: "skipped", records: 0, detail: { reason: `status=${tr.status}` } };
  }

  const [{ data: host }, { data: property }] = await Promise.all([
    supabase.from("hosts").select("name, email").eq("id", tr.host_id).maybeSingle(),
    supabase.from("properties").select("nickname, address").eq("id", tr.property_id).maybeSingle(),
  ]);

  let cleanerName: string | undefined;
  if (tr.assigned_cleaner_id) {
    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("first_name, last_name")
      .eq("id", tr.assigned_cleaner_id)
      .maybeSingle();
    if (cleaner) cleanerName = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || undefined;
  }

  const priceCents = Math.round(Number(tr.price || 0) * 100);
  const cleanerPayCents = Math.round(priceCents * CLEANER_SHARE);

  await syncJob({
    jobId: `STR-${turnoverId}`,
    dateCompleted: (tr.completed_at ? String(tr.completed_at).slice(0, 10) : tr.requested_date) || undefined,
    serviceType: JOB_SERVICE_TYPE.strTurnover,
    customerPaidCents: priceCents,
    cleanerName,
    numberOfCleaners: 1,
    // Authoritative turnover pay (70% of price) — wins over the tier estimate.
    cleanerPayPoolCents: cleanerPayCents,
    payPerCleanerCents: cleanerPayCents,
    paymentStatus:
      tr.balance_charged_at || tr.payment_option === "full" || tr.paid_at
        ? PAYMENT_STATUS.paid
        : PAYMENT_STATUS.pending,
    entrySource: ENTRY_SOURCE.portal,
    clientEmail: host?.email || undefined,
    propertyNickname: property?.nickname || undefined,
  });

  // Idempotent bookkeeping — same values every re-run, and status is untouched
  // so the completion trigger never re-fires.
  await supabase
    .from("turnover_requests")
    .update({ cleaner_payout_cents: cleanerPayCents, airtable_job_synced_at: new Date().toISOString() })
    .eq("id", turnoverId);

  return { status: "success", records: 1, detail: { jobId: `STR-${turnoverId}`, cleanerPayCents } };
}

// ─── commercial: business accounts + sites (same mapping as the actions route) ─

function mapAccountType(t: unknown): string {
  return t === "office" ? "Office" : t === "partnership" ? "Partnership" : "Commercial";
}
function mapAccountStatus(s: unknown): string {
  return s === "active"
    ? "Active"
    : s === "paused"
      ? "Paused"
      : s === "offboarded"
        ? "Offboarded"
        : s === "onboarding"
          ? "Onboarding"
          : "Prospect";
}

/** Re-push every business account + its active sites into Airtable. */
export async function syncAllCommercial(): Promise<FlowResult> {
  const supabase = getAdminSupabase();
  const [{ data: accounts, error: aErr }, { data: sites, error: sErr }] = await Promise.all([
    supabase
      .from("business_accounts")
      .select("id, business_name, account_type, status, recurring_frequency, default_rate_cents, stripe_customer_id, email"),
    supabase
      .from("business_sites")
      .select("id, business_account_id, nickname, address, city, state, zip_code, sqft, facility_type, restrooms, floors, access_method, active")
      .eq("active", true),
  ]);
  if (aErr) throw new Error(`Read business_accounts failed: ${aErr.message}`);
  if (sErr) throw new Error(`Read business_sites failed: ${sErr.message}`);

  const nameByAccountId = new Map<string, string>();
  const warnings: string[] = [];
  let accountsSynced = 0;
  let sitesSynced = 0;

  for (const account of accounts || []) {
    const businessName = String(account.business_name || "").trim();
    if (!businessName) {
      await flagForReview({
        flow: "commercial",
        reason: "identity",
        recordRef: String(account.id),
        airtableTable: "Commercial Accounts",
        message: `Business account ${account.id} has no business name (the merge key) — cannot sync until one is set.`,
      });
      continue;
    }
    nameByAccountId.set(String(account.id), businessName);
    try {
      await syncCommercialAccount({
        businessName,
        accountType: mapAccountType(account.account_type),
        accountStatus: mapAccountStatus(account.status),
        serviceFrequency: account.recurring_frequency || undefined,
        monthlyContractValue:
          account.default_rate_cents != null ? Number(account.default_rate_cents) / 100 : undefined,
        stripeCustomerId: account.stripe_customer_id || undefined,
        decisionMakerEmail: account.email || undefined,
      });
      accountsSynced += 1;
    } catch (err) {
      warnings.push(`Account ${businessName}: ${(err as Error).message}`);
    }
  }

  for (const st of sites || []) {
    const nickname = String(st.nickname || "").trim();
    if (!nickname) {
      await flagForReview({
        flow: "commercial",
        reason: "identity",
        recordRef: String(st.id),
        airtableTable: "Sites",
        message: `Business site ${st.id} has no nickname (the merge key) — cannot sync until one is set.`,
      });
      continue;
    }
    try {
      await syncSite({
        nickname,
        address:
          [st.address, st.city, st.state, st.zip_code].filter(Boolean).join(", ") || undefined,
        sqft: st.sqft ?? undefined,
        facilityType: st.facility_type ?? undefined,
        restrooms: st.restrooms ?? undefined,
        floors: st.floors ?? undefined,
        accessMethod: st.access_method ?? undefined,
        commercialAccountName: nameByAccountId.get(String(st.business_account_id)) || undefined,
      });
      sitesSynced += 1;
    } catch (err) {
      warnings.push(`Site ${nickname}: ${(err as Error).message}`);
    }
  }

  if (warnings.length && accountsSynced === 0 && sitesSynced === 0 && (accounts || []).length > 0) {
    throw new Error(warnings.slice(0, 3).join(" · "));
  }
  return {
    status: "success",
    records: accountsSynced + sitesSynced,
    detail: { accountsSynced, sitesSynced, warnings: warnings.slice(0, 20) },
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export interface FlowPayload {
  id?: string;
  email?: string;
  bookingId?: string;
  turnoverId?: string;
}

/** Execute one flow. Throws on transient failure (worker retries with backoff). */
export async function runFlow(flow: string, payload: FlowPayload = {}): Promise<FlowResult> {
  switch (flow as FlowName) {
    case "client": {
      const id = payload.id;
      const email = payload.email;
      if (!id && !email) throw new FlowPermanentError("client flow requires an id or email");
      try {
        const recordId = id ? await syncClientById(id) : await syncClientByEmail(String(email));
        if (!recordId) {
          // Missing customer, or they have not finished a booking (Clients is
          // completed-booking + STR host only).
          return { status: "skipped", records: 0, detail: { reason: "customer not found or not a completed-booking client" } };
        }
        return { status: "success", records: 1, detail: { recordId } };
      } catch (err) {
        const msg = (err as Error).message || "";
        if (/merge key/i.test(msg)) {
          await flagForReview({
            flow: "client",
            reason: "identity",
            recordRef: id || email || "",
            airtableTable: "Clients",
            message: `Customer ${id || email} has no email (the Clients merge key) — cannot sync until one is set.`,
          });
          throw new FlowPermanentError(msg);
        }
        throw err;
      }
    }

    case "job": {
      const bookingId = payload.bookingId || payload.id;
      if (!bookingId) throw new FlowPermanentError("job flow requires a bookingId");
      const recordId = await syncJobByBookingId(bookingId, { entrySource: DEFAULT_LIVE_ENTRY_SOURCE });
      if (!recordId) return { status: "skipped", records: 0, detail: { reason: "booking not found or not completed" } };
      return { status: "success", records: 1, detail: { recordId } };
    }

    case "payroll_runs": {
      const count = await syncAllPayrollRuns();
      return { status: "success", records: count };
    }

    case "qc_issue": {
      const issueId = payload.id;
      if (!issueId) throw new FlowPermanentError("qc_issue flow requires an id");
      const recordId = await syncQcIssueById(issueId);
      if (!recordId) return { status: "skipped", records: 0, detail: { reason: "issue not found" } };
      return { status: "success", records: 1, detail: { recordId } };
    }

    case "qc_issues_all": {
      const count = await syncAllQcIssues();
      return { status: "success", records: count };
    }

    case "partner":
      return syncAllPartners();

    case "turnover": {
      const turnoverId = payload.turnoverId || payload.id;
      if (!turnoverId) throw new FlowPermanentError("turnover flow requires a turnoverId");
      return syncTurnoverJob(turnoverId);
    }

    case "contractors": {
      const result = await syncContractors();
      return {
        status: "success",
        records: result.contractorsSynced,
        detail: { warnings: result.warnings.slice(0, 20) },
      };
    }

    case "vas": {
      const result = await syncVas();
      return {
        status: "success",
        records: result.vasSynced,
        detail: { warnings: result.warnings.slice(0, 20) },
      };
    }

    case "commercial":
      return syncAllCommercial();

    default:
      throw new FlowPermanentError(`Unknown sync flow: ${flow}`);
  }
}
