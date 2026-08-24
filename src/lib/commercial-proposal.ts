// ─── Commercial proposal → agreement → billing: shared vocabulary ───────────
//
// Pure functions only. Everything here is used by the admin console, the two
// public tokenized pages, and the server routes that back them, so it cannot
// reach for a Supabase client or a secret.
//
// The one rule worth stating up front: a proposal's site rows are a SNAPSHOT.
// Exhibit A on the agreement is built from those rows, never from the live
// site records, so re-pricing a building tomorrow cannot silently change what
// the client accepted today.

import { buildExhibitA, type ExhibitASite } from "@/lib/docuseal";

export type BillingMethod = "auto_pay" | "invoiced";
export type InvoiceCycle = "per_visit" | "weekly" | "biweekly" | "monthly";
export type NetTerms = "on_receipt" | "net_15" | "net_30" | "net_45" | "none";

export type ProposalStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "changes_requested"
  | "expired"
  | "withdrawn"
  | "superseded";

export type AgreementStatus =
  | "pending"
  | "signed"
  | "declined"
  | "voided"
  | "superseded";

export interface ProposalSite {
  id?: string;
  business_site_id: string | null;
  nickname: string;
  address: string | null;
  facility_type: string | null;
  scope_level: string | null;
  sqft: number | null;
  crew_size: number | null;
  service_window_start: string | null;
  service_window_end: string | null;
  frequency: string | null;
  per_visit_price_cents: number;
  price_source: "formula" | "walkthrough";
  walkthrough_id?: string | null;
  sort_order?: number;
}

// ─── Money ─────────────────────────────────────────────────────────────────

export function money(cents: number | null | undefined): string {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Cadence ───────────────────────────────────────────────────────────────
//
// Turning a written cadence into visits per month is what makes a per-visit
// rate legible as a monthly number. A client reads "$1,780 per visit" and
// asks what that costs them a month; leaving them to work it out is how a
// proposal gets forwarded to a CFO with a question attached instead of a
// decision.

const VISITS_PER_MONTH: Array<[RegExp, number]> = [
  [/(^|\b)5\s*x\s*\/?\s*w|five\s+days|weekday|mon\W*fri/i, 21.7],
  [/(^|\b)7\s*x|daily|every\s*day/i, 30.4],
  [/(^|\b)6\s*x/i, 26.1],
  [/(^|\b)4\s*x/i, 17.3],
  [/(^|\b)3\s*x/i, 13],
  [/(^|\b)2\s*x|twice\s+a\s+week|semi\W?weekly/i, 8.7],
  [/bi\W?weekly|every\s+other\s+week|fortnight/i, 2.17],
  [/weekly|once\s+a\s+week|1\s*x/i, 4.33],
  [/semi\W?monthly|twice\s+a\s+month/i, 2],
  [/monthly|once\s+a\s+month/i, 1],
  [/quarterly/i, 0.33],
];

/** Visits per month implied by a cadence string, or null when unreadable. */
export function visitsPerMonth(frequency: string | null | undefined): number | null {
  const raw = String(frequency || "").trim();
  if (!raw) return null;
  for (const [pattern, n] of VISITS_PER_MONTH) {
    if (pattern.test(raw)) return n;
  }
  return null;
}

/**
 * Estimated recurring monthly value across a proposal's sites.
 *
 * Returns null when any site's cadence can't be read rather than guessing —
 * a monthly figure that quietly dropped a location is worse than no monthly
 * figure, because it looks authoritative.
 */
export function estimatedMonthlyCents(
  sites: Array<Pick<ProposalSite, "per_visit_price_cents" | "frequency">>,
  fallbackFrequency?: string | null,
): number | null {
  if (!sites.length) return null;
  let total = 0;
  for (const s of sites) {
    const per = visitsPerMonth(s.frequency || fallbackFrequency);
    if (per == null) return null;
    total += Math.round(Number(s.per_visit_price_cents || 0) * per);
  }
  return total;
}

export function totalPerVisitCents(
  sites: Array<Pick<ProposalSite, "per_visit_price_cents">>,
): number {
  return sites.reduce((sum, s) => sum + Number(s.per_visit_price_cents || 0), 0);
}

// ─── Labels ────────────────────────────────────────────────────────────────

export const TERM_LABELS: Record<string, string> = {
  month_to_month: "Month-to-month",
  annual: "12-month term",
};

export const NET_TERMS_LABELS: Record<NetTerms, string> = {
  on_receipt: "Due on receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_45: "Net 45",
  none: "No invoice (handled off-platform)",
};

export const INVOICE_CYCLE_LABELS: Record<InvoiceCycle, string> = {
  per_visit: "After each visit",
  weekly: "Weekly",
  biweekly: "Every other week",
  monthly: "Monthly",
};

export const BILLING_METHOD_LABELS: Record<BillingMethod, string> = {
  auto_pay: "Auto-Pay",
  invoiced: "Invoiced",
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  changes_requested: "Changes requested",
  expired: "Expired",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
};

export const PIPELINE_STAGES = [
  "pricing_pending",
  "firm_price_ready",
  "proposal_sent",
  "changes_requested",
  "proposal_expired",
  "proposal_accepted",
  "agreement_sent",
  "billing_pending",
  "dispatch_eligible",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  pricing_pending: "Pricing pending",
  firm_price_ready: "Firm price ready",
  proposal_sent: "Proposal sent",
  changes_requested: "Changes requested",
  proposal_expired: "Proposal expired",
  proposal_accepted: "Proposal accepted",
  agreement_sent: "Agreement out for signature",
  billing_pending: "Billing setup pending",
  dispatch_eligible: "Dispatch-eligible",
};

export function titleCase(v: string | null | undefined): string {
  const raw = String(v || "").replace(/[_-]+/g, " ").trim();
  if (!raw) return "";
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── The value stack ───────────────────────────────────────────────────────
//
// What a commercial buyer is actually comparing when two bids land within a
// few percent of each other. Kept here rather than in the page so the same
// list is quotable from the admin console when a VA is on the phone.

export interface ValueStackItem {
  title: string;
  detail: string;
}

export const VALUE_STACK: ValueStackItem[] = [
  {
    title: "Fully insured, and you hold the certificate",
    detail:
      "General liability coverage is in force before the first visit, and a current certificate of insurance is sent to you on signature — not promised and chased later.",
  },
  {
    title: "Background-checked, W-9'd personnel",
    detail:
      "Every cleaner who enters your building is screened and on record. Crew assignments are tracked per visit, so you always know who was on site.",
  },
  {
    title: "Every visit documented with photos",
    detail:
      "Crews work a scope checklist built for your facility type and capture photo evidence section by section. You get the record, not just an invoice.",
  },
  {
    title: "Priced from a walkthrough, not a phone call",
    detail:
      "Larger facilities are measured and scoped in person before a rate is quoted, which is why the number in this proposal is the number you are billed.",
  },
  {
    title: "The Novara Guarantee",
    detail:
      "If something is missed, tell us within 24 hours and we return to correct it at no charge. No re-negotiation, no credit memo argument.",
  },
];

// ─── Exhibit A ─────────────────────────────────────────────────────────────

/** A proposal's snapshot rows in the shape the agreement builder wants. */
export function proposalSitesToExhibit(sites: ProposalSite[]): ExhibitASite[] {
  return sites.map((s) => ({
    nickname: s.nickname,
    address: s.address,
    sqft: s.sqft,
    facilityType: s.facility_type ? titleCase(s.facility_type) : null,
    scopeLevel: s.scope_level ? titleCase(s.scope_level) : null,
    crewSize: s.crew_size,
    firmPriceCents: s.per_visit_price_cents,
    cadence: s.frequency,
    excluded: false,
  }));
}

/**
 * Exhibit A for an accepted proposal.
 *
 * Every site on the proposal is priced by construction — the column is NOT
 * NULL and checked greater than zero — so unlike the account-level builder
 * this one can never emit a "rate pending" line. If it does, something has
 * bypassed the proposal path.
 */
export function buildProposalExhibitA(sites: ProposalSite[]): {
  text: string;
  totalPerVisitCents: number;
  pricedCount: number;
  pendingCount: number;
} {
  return buildExhibitA(proposalSitesToExhibit(sites));
}

// ─── Links ─────────────────────────────────────────────────────────────────
//
// Both tokenized pages live on the commercial subdomain, which is where the
// public commercial funnel already is. One host for everything a commercial
// prospect ever opens.

const COMMERCIAL_ORIGIN = "https://commercial.novaracleaning.com";

function origin(): string {
  const configured =
    process.env.NEXT_PUBLIC_COMMERCIAL_ORIGIN ||
    process.env.COMMERCIAL_ORIGIN ||
    "";
  return (configured || COMMERCIAL_ORIGIN).replace(/\/+$/, "");
}

export function proposalUrl(token: string): string {
  return `${origin()}/proposal/${token}`;
}

export function agreementUrl(token: string): string {
  return `${origin()}/commercial-agreement/${token}`;
}

// ─── Requirement vocabulary ────────────────────────────────────────────────
//
// Mirrors commercial_site_dispatch_eligibility so the console and the refusal
// messages name the same four things in the same words.

export interface DispatchRequirement {
  key: "firm_price" | "signed_agreement" | "billing_configured" | "coi_current";
  label: string;
  met: boolean;
  detail: string | null;
  fix_path: string | null;
}

export interface DispatchEligibility {
  found: boolean;
  eligible: boolean;
  site_id?: string;
  site_nickname?: string;
  account_id?: string;
  business_name?: string;
  requirements?: DispatchRequirement[];
  outstanding?: string[];
  message: string;
}
