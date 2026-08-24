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

export interface AccountCompliance {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  agreement_signed_at?: string | null;
  coi_expires_at?: string | null;
  coi_sent_at?: string | null;
}

/**
 * Whether this account may have work confirmed and dispatched.
 *
 * The check lives in SQL (commercial_account_compliance) so the admin console,
 * the booking function, and any report all read the same rule. If the RPC is
 * unavailable the same logic is applied to the account row directly rather
 * than failing open — a compliance gate that disappears when a function is
 * missing is not a gate.
 */
export async function accountCompliance(
  admin: SB,
  accountId: string,
): Promise<AccountCompliance> {
  const { data, error } = await admin.rpc("commercial_account_compliance", {
    p_account_id: accountId,
  });
  if (!error && data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    return {
      ok: d.ok === true,
      blockers: Array.isArray(d.blockers) ? (d.blockers as string[]) : [],
      warnings: Array.isArray(d.warnings) ? (d.warnings as string[]) : [],
      agreement_signed_at: (d.agreement_signed_at as string) ?? null,
      coi_expires_at: (d.coi_expires_at as string) ?? null,
      coi_sent_at: (d.coi_sent_at as string) ?? null,
    };
  }

  const { data: acct } = await admin
    .from("business_accounts")
    .select("status, agreement_signed_at, coi_sent_at, coi_expires_at")
    .eq("id", accountId).maybeSingle();
  if (!acct) return { ok: false, blockers: ["Account not found."], warnings: [] };

  const blockers: string[] = [];
  const warnings: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (!acct.agreement_signed_at) blockers.push("No signed agreement on the account.");
  if (acct.coi_expires_at && String(acct.coi_expires_at).slice(0, 10) < today) {
    blockers.push(`Certificate of insurance expired ${String(acct.coi_expires_at).slice(0, 10)}.`);
  } else if (!acct.coi_expires_at && !acct.coi_sent_at) {
    blockers.push("No certificate of insurance on file.");
  } else if (!acct.coi_expires_at) {
    warnings.push("Certificate of insurance on file has no recorded expiry date.");
  }
  if (acct.status === "offboarded") blockers.push("Account is offboarded.");

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    agreement_signed_at: acct.agreement_signed_at ?? null,
    coi_expires_at: acct.coi_expires_at ?? null,
    coi_sent_at: acct.coi_sent_at ?? null,
  };
}

// ─── Walkthroughs ──────────────────────────────────────────────────────────

export interface WalkthroughRecord {
  id: string;
  business_site_id: string;
  status: string;
  conducted_on: string | null;
  conducted_by: string | null;
  firm_price_cents: number | null;
  recommended_crew_size: number | null;
  scope_level: string | null;
  facility_type_key: string | null;
  sqft: number | null;
}

const WALKTHROUGH_COLS =
  "id, business_site_id, status, conducted_on, conducted_by, firm_price_cents, " +
  "recommended_crew_size, scope_level, facility_type_key, sqft";

/** The most recent completed walkthrough for a site, if there is one. */
export async function latestCompletedWalkthrough(
  admin: SB,
  siteId: string,
): Promise<WalkthroughRecord | null> {
  const { data } = await admin
    .from("commercial_walkthroughs")
    .select(WALKTHROUGH_COLS)
    .eq("business_site_id", siteId)
    .eq("status", "completed")
    .not("firm_price_cents", "is", null)
    .order("conducted_on", { ascending: false })
    .limit(1);
  const row = Array.isArray(data) && data.length ? data[0] : null;
  return (row as WalkthroughRecord) || null;
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
