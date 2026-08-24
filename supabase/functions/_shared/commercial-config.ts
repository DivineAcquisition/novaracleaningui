// ─── Commercial pricing config + gates (I/O layer) ─────────────────────────
//
// commercial-pricing.ts is pure arithmetic. This is the half that touches the
// database: it loads the admin-editable rate tables, resolves an account's
// compliance state, and answers whether a site has the completed walkthrough
// its size demands.
//
// Every consumer — the live quote a VA sees, the price book-partner-job
// records, the crew dispatch is asked for — goes through here, so there is
// exactly one answer to "what does this job cost and may it be booked".

import {
  DEFAULT_COMMERCIAL_CONFIG,
  DEFAULT_COMMERCIAL_SETTINGS,
  type CommercialPricingConfig,
  type CommercialSettings,
  type FacilityType,
  type ScopeLevel,
  type SizeTier,
} from "./commercial-pricing.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

/**
 * Load the three rate tables plus the tunables.
 *
 * A missing or empty table falls back to the shipped defaults rather than
 * failing the quote: an admin who deactivates every facility type should get
 * a usable price and a support ticket, not a dead booking flow.
 */
export async function loadCommercialConfig(admin: SB): Promise<CommercialPricingConfig> {
  const [facilityRes, scopeRes, tierRes, settingsRes] = await Promise.all([
    admin.from("commercial_facility_types")
      .select("key, label, base_rate_cents_per_sqft, description, sort_order, active")
      .eq("active", true).order("sort_order"),
    admin.from("commercial_scope_levels")
      .select("key, label, multiplier, summary, sqft_per_cleaner_hour, sort_order, active")
      .eq("active", true).order("sort_order"),
    admin.from("commercial_size_tiers")
      .select("label, min_sqft, max_sqft, multiplier").order("min_sqft"),
    admin.from("app_settings").select("value").eq("key", "commercial_pricing_settings").maybeSingle(),
  ]);

  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const facilityTypes = ((facilityRes?.data || []) as FacilityType[]).map((f) => ({
    ...f,
    base_rate_cents_per_sqft: num(f.base_rate_cents_per_sqft, 0),
  }));
  const scopeLevels = ((scopeRes?.data || []) as ScopeLevel[]).map((s) => ({
    ...s,
    multiplier: num(s.multiplier, 1),
    sqft_per_cleaner_hour: Math.round(num(s.sqft_per_cleaner_hour, 2200)),
  }));
  const sizeTiers = ((tierRes?.data || []) as SizeTier[]).map((t) => ({
    ...t,
    min_sqft: Math.round(num(t.min_sqft, 0)),
    max_sqft: t.max_sqft == null ? null : Math.round(num(t.max_sqft, 0)),
    multiplier: num(t.multiplier, 1),
  }));

  const raw = (settingsRes?.data?.value || {}) as Partial<CommercialSettings>;
  const settings: CommercialSettings = {
    ...DEFAULT_COMMERCIAL_SETTINGS,
    ...Object.fromEntries(
      Object.entries(DEFAULT_COMMERCIAL_SETTINGS).map(([k, v]) => [
        k,
        num((raw as Record<string, unknown>)[k], v as number),
      ]),
    ),
  } as CommercialSettings;

  return {
    facilityTypes: facilityTypes.length ? facilityTypes : DEFAULT_COMMERCIAL_CONFIG.facilityTypes,
    scopeLevels: scopeLevels.length ? scopeLevels : DEFAULT_COMMERCIAL_CONFIG.scopeLevels,
    sizeTiers: sizeTiers.length ? sizeTiers : DEFAULT_COMMERCIAL_CONFIG.sizeTiers,
    settings,
  };
}

// ─── Account compliance ────────────────────────────────────────────────────

export type CoiStatus = "not_on_file" | "current" | "expiring_soon" | "expired";

export interface CoiOverride {
  id: string;
  reason: string;
  expires_at: string;
  created_by_name?: string | null;
  created_at?: string;
}

export interface CoiState {
  status: CoiStatus;
  blocked: boolean;
  expiration_date: string | null;
  days_remaining: number | null;
  documents_in_review: number;
  override: CoiOverride | null;
}

export interface BillingState {
  configured: boolean;
  method: "auto_pay" | "invoiced" | null;
  reason?: string | null;
  summary?: string | null;
  payment_method_type?: string | null;
  payment_method_last4?: string | null;
  invoice_cycle?: string | null;
  net_terms?: string | null;
  billing_contact_email?: string | null;
}

export interface AccountCompliance {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  account_id?: string;
  business_name?: string | null;
  agreement_signed_at?: string | null;
  coi_expires_at?: string | null;
  coi_sent_at?: string | null;
  coi_status?: CoiStatus;
  coi?: CoiState | null;
  billing?: BillingState | null;
  billing_configured?: boolean;
  company_coi_sent_at?: string | null;
  active_site_count?: number;
}

/** Where an admin goes to fix a COI gap, named in every block message. */
export const COI_CONSOLE_PATH = "/admin/commercial?tab=compliance";

/** Where an admin goes to fix a proposal / agreement / billing gap. */
export const DEAL_CONSOLE_PATH = "/admin/commercial?tab=pipeline";

// ─── Where the block is enforced ───────────────────────────────────────────
//
// accountCompliance() is called from every point at which a commercial job
// moves toward a crew standing on a client's floor:
//
//   book-partner-job          confirming a booking (and therefore converting a
//                             walkthrough's firm price into one)
//   partner-jobs-generate     auto-generating a recurring visit — held, not
//                             skipped and not created anyway
//   admin-booking-assign      assigning or reassigning a crew
//   dispatch-job              sending offers
//   accept-job-offer          a cleaner accepting an offer that was sent while
//                             the certificate was still valid
//   reassign-booking-cleaner  a cleaner handing the job to a crewmate
//
// The last two matter because time passes between offer and acceptance. A
// gate that only runs when ops clicks something is not a gate on the day the
// certificate lapses and nobody clicks anything.

/**
 * The message a blocked action shows.
 *
 * Every enforcement point says the same three things — which account, what is
 * missing, and where to fix it — because a block a person cannot act on is
 * just an error they will route around.
 */
export function complianceBlockMessage(
  compliance: AccountCompliance,
  action: string,
): string {
  const name = compliance.business_name || "This account";
  const sites = Number(compliance.active_site_count) || 0;
  const cascade = sites > 1
    ? ` This applies to all ${sites} of the account's sites, not just this one.`
    : "";

  // Different gaps are fixed in different places, and sending someone to the
  // compliance console to solve a missing signature is how a block becomes
  // something people route around instead of resolving.
  const fixes: string[] = [];
  if (compliance.coi_status && compliance.coi_status !== "current") {
    fixes.push(
      `Upload a current certificate under Commercial → Compliance (${COI_CONSOLE_PATH}) and the block lifts immediately.`,
    );
  }
  if (compliance.billing_configured === false || !compliance.agreement_signed_at) {
    fixes.push(
      `The proposal, agreement and billing steps are under Commercial → Pipeline (${DEAL_CONSOLE_PATH}).`,
    );
  }

  return `${action} is blocked for ${name} — ${compliance.blockers.join(" ")}${cascade}` +
    (fixes.length ? ` ${fixes.join(" ")}` : "");
}

/**
 * Whether this account may have work confirmed and dispatched.
 *
 * The rule lives in SQL (commercial_account_compliance), which computes COI
 * status from the expiry date on every read, so the admin console, the booking
 * function, the recurring generator, and dispatch cannot disagree about
 * whether an account is covered.
 *
 * If the RPC is unavailable the same logic is applied to the account row
 * directly rather than failing open — a compliance gate that disappears when a
 * function is missing is not a gate. The fallback deliberately ignores
 * overrides: it cannot verify one, and guessing in the permissive direction is
 * the wrong way to be wrong about insurance.
 */
export async function accountCompliance(
  admin: SB,
  accountId: string,
): Promise<AccountCompliance> {
  const { data, error } = await admin.rpc("commercial_account_compliance", {
    p_account_id: accountId,
  });
  if (!error && data && typeof data === "object") {
    const d = data as unknown as Record<string, unknown>;
    const coi = (d.coi && typeof d.coi === "object" ? d.coi : null) as Record<string, unknown> | null;
    return {
      ok: d.ok === true,
      blockers: Array.isArray(d.blockers) ? (d.blockers as string[]) : [],
      warnings: Array.isArray(d.warnings) ? (d.warnings as string[]) : [],
      account_id: (d.account_id as string) ?? accountId,
      business_name: (d.business_name as string) ?? null,
      agreement_signed_at: (d.agreement_signed_at as string) ?? null,
      coi_expires_at: (d.coi_expires_at as string) ?? null,
      coi_sent_at: (d.coi_sent_at as string) ?? null,
      coi_status: (d.coi_status as CoiStatus) ?? undefined,
      billing: (d.billing as BillingState) ?? null,
      billing_configured: d.billing_configured === true,
      company_coi_sent_at: (d.company_coi_sent_at as string) ?? null,
      active_site_count: Number(d.active_site_count) || 0,
      coi: coi
        ? {
          status: (coi.status as CoiStatus) || "not_on_file",
          blocked: coi.blocked === true,
          expiration_date: (coi.expiration_date as string) ?? null,
          days_remaining: coi.days_remaining == null ? null : Number(coi.days_remaining),
          documents_in_review: Number(coi.documents_in_review) || 0,
          override: (coi.override as CoiOverride) ?? null,
        }
        : null,
    };
  }

  const { data: acct } = await admin
    .from("business_accounts")
    .select(
      "business_name, status, agreement_signed_at, coi_sent_at, coi_expires_at, " +
        "billing_configured_at, billing_method, company_coi_sent_at",
    )
    .eq("id", accountId).maybeSingle();
  if (!acct) return { ok: false, blockers: ["Account not found."], warnings: [] };

  const blockers: string[] = [];
  const warnings: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const expiry = acct.coi_expires_at ? String(acct.coi_expires_at).slice(0, 10) : null;
  let status: CoiStatus = "not_on_file";
  if (!acct.agreement_signed_at) blockers.push("No signed agreement on the account.");
  // The mirror column, not the profile: this path runs when the RPC is
  // unavailable, so it reads the flattened copy the billing trigger keeps.
  if (!acct.billing_configured_at) {
    blockers.push("Billing has not been set up — neither Auto-Pay nor invoiced terms are on file.");
  }
  if (expiry && expiry < today) {
    status = "expired";
    blockers.push(`Certificate of insurance expired ${expiry}.`);
  } else if (expiry) {
    status = "current";
  } else {
    blockers.push("No current certificate of insurance on file.");
  }
  if (acct.status === "offboarded") blockers.push("Account is offboarded.");

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    account_id: accountId,
    business_name: acct.business_name ?? null,
    agreement_signed_at: acct.agreement_signed_at ?? null,
    coi_expires_at: acct.coi_expires_at ?? null,
    coi_sent_at: acct.coi_sent_at ?? null,
    coi_status: status,
    billing_configured: Boolean(acct.billing_configured_at),
    company_coi_sent_at: acct.company_coi_sent_at ?? null,
  };
}

// ─── The four dispatch requirements, in one read ───────────────────────────

export interface DispatchRequirement {
  key: "firm_price" | "signed_agreement" | "billing_configured" | "coi_current";
  label: string;
  met: boolean;
  detail: string | null;
  fix_path: string | null;
}

export interface SiteDispatchEligibility {
  found: boolean;
  eligible: boolean;
  site_id?: string;
  site_nickname?: string;
  account_id?: string;
  business_name?: string | null;
  requirements: DispatchRequirement[];
  outstanding: string[];
  message: string;
}

/**
 * Whether one site may be booked and dispatched, and if not, which of the four
 * requirements is missing.
 *
 * The individual gates in book-partner-job stay where they are — each has a
 * far more useful message than a generic list, because each knows what it was
 * about to do. This is for the callers that need the whole picture at once:
 * the console, and the dispatch paths that would otherwise refuse without
 * saying which requirement failed.
 */
export async function siteDispatchEligibility(
  admin: SB,
  siteId: string,
): Promise<SiteDispatchEligibility> {
  const { data, error } = await admin.rpc("commercial_site_dispatch_eligibility", {
    p_site_id: siteId,
  });
  if (error || !data || typeof data !== "object") {
    // Never fail open. A gate that disappears when a function is missing is
    // not a gate.
    return {
      found: false,
      eligible: false,
      requirements: [],
      outstanding: ["a dispatch eligibility check"],
      message:
        "Could not confirm this site is cleared to dispatch. Nothing is dispatched on an unanswered check.",
    };
  }
  const d = data as unknown as Record<string, unknown>;
  return {
    found: d.found === true,
    eligible: d.eligible === true,
    site_id: (d.site_id as string) ?? siteId,
    site_nickname: (d.site_nickname as string) ?? undefined,
    account_id: (d.account_id as string) ?? undefined,
    business_name: (d.business_name as string) ?? null,
    requirements: Array.isArray(d.requirements) ? (d.requirements as DispatchRequirement[]) : [],
    outstanding: Array.isArray(d.outstanding) ? (d.outstanding as string[]) : [],
    message: String(d.message || ""),
  };
}

/**
 * Record that a block actually fired.
 *
 * A gate nobody can see the effect of is indistinguishable from a bug report
 * about "the button doesn't work", so every refusal lands on the events bus
 * with the account and the reason.
 */
export async function logComplianceBlock(
  admin: SB,
  args: {
    compliance: AccountCompliance;
    action: string;
    bookingId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await admin.from("events").insert({
    event_type: "coi.block.enforced",
    booking_id: args.bookingId || null,
    source: "commercial-compliance",
    summary: `${args.action} blocked — ${args.compliance.business_name || "account"}: ${args.compliance.blockers.join(" ")}`,
    data: {
      account_id: args.compliance.account_id,
      action: args.action,
      blockers: args.compliance.blockers,
      coi_status: args.compliance.coi_status,
      active_site_count: args.compliance.active_site_count,
      ...(args.detail || {}),
    },
  }).then(() => undefined, () => undefined);
}

// ─── Walkthroughs ──────────────────────────────────────────────────────────

export interface WalkthroughRecord {
  id: string;
  business_site_id: string;
  status: string;
  priced_at?: string | null;
  conducted_on: string | null;
  conducted_by: string | null;
  firm_price_cents: number | null;
  recommended_crew_size: number | null;
  scope_level: string | null;
  facility_type_key: string | null;
  sqft: number | null;
}

const WALKTHROUGH_COLS =
  "id, business_site_id, status, conducted_on, conducted_by, priced_at, firm_price_cents, " +
  "recommended_crew_size, scope_level, facility_type_key, sqft";

/**
 * The walkthrough that produced this site's current price, if any.
 *
 * `priced` is the pipeline stage where a human set a firm price from the
 * findings. A walkthrough that is merely `conducted` has findings and no
 * price, which is precisely the state this gate must not accept.
 */
export async function latestCompletedWalkthrough(
  admin: SB,
  siteId: string,
): Promise<WalkthroughRecord | null> {
  const { data } = await admin
    .from("commercial_walkthroughs")
    .select(WALKTHROUGH_COLS)
    .eq("business_site_id", siteId)
    .eq("status", "priced")
    .not("firm_price_cents", "is", null)
    .order("priced_at", { ascending: false })
    .limit(1);
  const row = Array.isArray(data) && data.length ? data[0] : null;
  return (row as WalkthroughRecord) || null;
}

export interface SitePricingState {
  eligible: boolean;
  requires_walkthrough?: boolean;
  stage?: string;
  reason?: string;
  firm_price_cents?: number | null;
  recommended_crew_size?: number | null;
  walkthrough_id?: string | null;
  exclusion_code?: string | null;
}

/**
 * Whether a site may reach a confirmed, dispatchable booking, and if not, why.
 *
 * Computed in SQL from the site's square footage, the threshold, and where its
 * walkthrough got to — so the booking flow, the admin pipeline board, and the
 * site record cannot disagree about whether a building is priced. An excluded
 * site is never eligible whatever its size: that is what an exclusion means.
 */
export async function sitePricingState(
  admin: SB,
  siteId: string,
): Promise<SitePricingState | null> {
  const { data, error } = await admin.rpc("commercial_site_pricing_state", {
    p_site_id: siteId,
  });
  if (error || !data || typeof data !== "object") return null;
  return data as SitePricingState;
}

export async function walkthroughById(
  admin: SB,
  id: string,
): Promise<WalkthroughRecord | null> {
  const { data } = await admin
    .from("commercial_walkthroughs")
    .select(WALKTHROUGH_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as WalkthroughRecord) || null;
}
