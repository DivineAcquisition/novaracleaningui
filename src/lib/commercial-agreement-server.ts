// ─── Turning an accepted proposal into a signable agreement ────────────────
//
// Exactly one function does this, and both callers use it: the admin console
// (for the cases where a VA drives it) and the client's own acceptance on the
// tokenized proposal page (the normal path). Two implementations would be two
// chances for the Agreement to disagree with the proposal it came from, which
// is the specific failure this automation exists to prevent.
//
// Exhibit A is built from the PROPOSAL'S OWN SNAPSHOT ROWS, never from the
// live site records. Re-pricing a building after the client accepted must not
// change what they accepted.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { loadCommercialConfigServer } from "@/lib/commercial-pricing-server";
import { computeCommercialQuote } from "@/lib/commercial-pricing";
import {
  agreementUrl,
  buildProposalExhibitA,
  type ProposalSite,
} from "@/lib/commercial-proposal";

type Supa = ReturnType<typeof getAdminSupabase>;

export const PROPOSAL_COLS =
  "id, business_account_id, version, supersedes_id, status, token, expires_at, " +
  "recipient_name, recipient_email, recipient_phone, proposed_frequency, term, " +
  "billing_method, billing_method_locked, invoice_cycle, net_terms, cover_note, " +
  "internal_note, total_per_visit_cents, estimated_monthly_cents, visits_per_month, " +
  "prepared_by_name, assigned_to_email, sent_at, sent_to, send_count, " +
  "first_viewed_at, last_viewed_at, view_count, accepted_at, accepted_by_name, " +
  "accepted_by_email, accepted_billing_method, changes_requested_at, " +
  "change_request_note, change_request_by_name, change_request_ack_at, " +
  "change_request_ack_by, expired_at, withdrawn_at, withdrawn_reason, created_at";

export const PROPOSAL_SITE_COLS =
  "id, proposal_id, business_site_id, nickname, address, facility_type, scope_level, " +
  "sqft, crew_size, service_window_start, service_window_end, frequency, " +
  "per_visit_price_cents, price_source, walkthrough_id, pricing_confirmed_at, sort_order";

export const AGREEMENT_COLS =
  "id, business_account_id, proposal_id, status, token, expires_at, signer_name, " +
  "signer_email, signer_title, term, billing_method, invoice_cycle, net_terms, " +
  "exhibit_a_text, total_per_visit_cents, sent_at, sent_to, send_count, " +
  "first_viewed_at, signed_at, signed_by_name, signed_by_title, document_path, " +
  "countersigned_at, countersigned_by_name, declined_at, declined_reason, created_at";

const int = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

// The commercial tables post-date the checked-in generated Supabase types, so
// supabase-js cannot parse these select strings against a known schema. These
// narrow the results back to the shapes the code actually relies on.
export function row<T>(data: unknown): T | null {
  return (data as T) ?? null;
}

export function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export function mapBillingTerms(v: string | null | undefined): string {
  switch (String(v || "")) {
    case "net_15": return "net_15";
    case "net_30": return "net_30";
    case "none": return "none";
    default: return "on_receipt";
  }
}

export interface GenerateAgreementArgs {
  proposalId?: string | null;
  accountId?: string | null;
  signerName?: string | null;
  signerEmail?: string | null;
  signerTitle?: string | null;
  billingMethod?: "auto_pay" | "invoiced" | null;
  actorName?: string | null;
  actorId?: string | null;
}

export interface GenerateAgreementResult {
  ok: boolean;
  error?: string;
  status?: number;
  agreementId?: string;
  link?: string;
  token?: string;
}

/**
 * Resolve an account's priced sites into proposal-shaped rows.
 *
 * Used only by the no-proposal escape hatch. Sites under the walkthrough
 * threshold have no stored firm price — the engine prices them — so the
 * number is resolved here rather than left as a promise to compute one later.
 */
async function sitesFromAccount(
  supabase: Supa,
  accountId: string,
  cadence: string,
): Promise<{ ok: boolean; error?: string; sites?: ProposalSite[] }> {
  const { data: readiness } = await supabase.rpc("commercial_proposal_readiness", {
    p_account_id: accountId,
  });
  const ready = (readiness || {}) as {
    can_propose?: boolean;
    reason?: string;
    sites?: Array<Record<string, unknown>>;
  };
  if (!ready.can_propose) {
    return {
      ok: false,
      error: ready.reason || "Every site needs a firm price before an agreement can be generated.",
    };
  }

  const config = await loadCommercialConfigServer(supabase);
  const sites: ProposalSite[] = [];
  for (const raw of ready.sites || []) {
    const site = raw as Record<string, unknown>;
    if (site.ready !== true) continue;

    let cents = int(site.firm_price_cents);
    let source: "formula" | "walkthrough" = "walkthrough";
    if (cents == null || cents <= 0) {
      const q = computeCommercialQuote(config, {
        sqft: Number(site.sqft) || 0,
        facilityTypeKey: String(site.facility_type || "other"),
        scopeLevel: String(site.scope_level || "standard"),
      });
      if (!q.ok || q.requiresWalkthrough || q.formulaCents <= 0) {
        return { ok: false, error: `${String(site.nickname)} has no firm price yet.` };
      }
      cents = q.formulaCents;
      source = "formula";
    }

    sites.push({
      business_site_id: String(site.site_id),
      nickname: String(site.nickname || "Site"),
      address: (site.address as string) ?? null,
      facility_type: (site.facility_type as string) ?? null,
      scope_level: (site.scope_level as string) ?? null,
      sqft: int(site.sqft),
      crew_size: int(site.crew_size),
      service_window_start: (site.service_window_start as string) ?? null,
      service_window_end: (site.service_window_end as string) ?? null,
      frequency: cadence,
      per_visit_price_cents: cents,
      price_source: source,
    });
  }

  return { ok: true, sites };
}

export async function generateAgreement(
  supabase: Supa,
  args: GenerateAgreementArgs,
): Promise<GenerateAgreementResult> {
  let accountId = args.accountId || null;
  let proposal: Record<string, unknown> | null = null;
  let sites: ProposalSite[] = [];

  if (args.proposalId) {
    const { data } = await supabase
      .from("commercial_proposals")
      .select(PROPOSAL_COLS)
      .eq("id", args.proposalId)
      .maybeSingle();
    if (!data) return { ok: false, error: "Proposal not found.", status: 404 };
    proposal = row<Record<string, unknown>>(data);
    if (!proposal) return { ok: false, error: "Proposal not found.", status: 404 };

    if (proposal.status !== "accepted") {
      return {
        ok: false,
        status: 409,
        error:
          "The agreement is generated from an ACCEPTED proposal — this one is " +
          `${String(proposal.status).replace(/_/g, " ")}. Putting a contract in front of ` +
          "somebody who hasn't agreed in principle is the step this pipeline removes.",
      };
    }
    accountId = String(proposal.business_account_id);

    const { data: siteRows } = await supabase
      .from("commercial_proposal_sites")
      .select(PROPOSAL_SITE_COLS)
      .eq("proposal_id", args.proposalId)
      .order("sort_order");
    sites = (siteRows || []) as unknown as ProposalSite[];
  }

  if (!accountId) {
    return { ok: false, error: "An account or an accepted proposal is required.", status: 400 };
  }

  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, phone, billing_terms, recurring_frequency")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return { ok: false, error: "Account not found.", status: 404 };

  if (!sites.length) {
    const resolved = await sitesFromAccount(
      supabase,
      accountId,
      account.recurring_frequency || "weekly",
    );
    if (!resolved.ok) return { ok: false, status: 409, error: resolved.error };
    sites = resolved.sites || [];
  }

  if (!sites.length) {
    return { ok: false, status: 409, error: "No priced sites to put on an agreement." };
  }

  const exhibit = buildProposalExhibitA(sites);
  const billingMethod =
    args.billingMethod ||
    (proposal?.accepted_billing_method as "auto_pay" | "invoiced" | null) ||
    (proposal?.billing_method as "auto_pay" | "invoiced" | null) ||
    "invoiced";

  const { data: ttl } = await supabase.rpc("commercial_proposal_setting_int", {
    p_key: "agreement_token_ttl_days",
    p_default: 30,
  });
  const { data: minted } = await supabase.rpc("mint_commercial_token");
  const token = String(minted || "");
  if (!token) return { ok: false, error: "Could not mint a signing link.", status: 500 };

  // One agreement out for signature at a time — the partial unique index
  // enforces it, so anything already pending is retired first.
  await supabase
    .from("commercial_agreements")
    .update({ status: "superseded", token: null, updated_at: new Date().toISOString() })
    .eq("business_account_id", accountId)
    .eq("status", "pending");

  const { data: created, error } = await supabase
    .from("commercial_agreements")
    .insert({
      business_account_id: accountId,
      proposal_id: args.proposalId || null,
      status: "pending",
      token,
      expires_at: new Date(Date.now() + (Number(ttl) || 30) * 86400_000).toISOString(),
      signer_name:
        args.signerName || (proposal?.recipient_name as string | null) || account.contact_name,
      signer_email:
        args.signerEmail || (proposal?.recipient_email as string | null) || account.email,
      signer_title: args.signerTitle || null,
      term: (proposal?.term as string | null) || "month_to_month",
      billing_method: billingMethod,
      invoice_cycle: (proposal?.invoice_cycle as string | null) || "monthly",
      net_terms: (proposal?.net_terms as string | null) || mapBillingTerms(account.billing_terms),
      exhibit_a_text: exhibit.text,
      exhibit_a_sites: sites,
      total_per_visit_cents: exhibit.totalPerVisitCents,
      created_by: args.actorId || null,
      created_by_name: args.actorName || "System",
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    return { ok: false, error: error?.message || "Could not create the agreement.", status: 400 };
  }

  return {
    ok: true,
    agreementId: (created as { id: string }).id,
    token,
    link: agreementUrl(token),
  };
}
