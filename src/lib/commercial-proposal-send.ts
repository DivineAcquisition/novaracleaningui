// ─── Walk-in commercial proposal send ──────────────────────────────────────
//
// Internal Booking does not require a saved customer record — the VA types
// the details and submits. Send works the same way: an existing commercial
// account is optional prefill, not a gate.

export function isMissingSchemaRelation(message: string | null | undefined): boolean {
  const msg = String(message || "");
  return /schema cache|could not find the (table|view)|relation .* does not exist|does not exist/i.test(msg);
}

export function isValidProposalEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export interface WalkInSiteInput {
  nickname: string;
  rateCents: number | null;
}

export function pipelineStageFromRows(args: {
  agreementSignedAt?: string | null;
  billingConfiguredAt?: string | null;
  agreementStatus?: string | null;
  proposalStatus?: string | null;
  pricedSites: number;
  activeSites: number;
  excludedSites: number;
}): string {
  const openSites = Math.max(0, args.activeSites - args.excludedSites);
  if (args.agreementSignedAt && args.billingConfiguredAt && args.pricedSites > 0 && args.pricedSites === openSites) {
    return "dispatch_eligible";
  }
  if (args.agreementSignedAt && args.billingConfiguredAt) return "pricing_pending";
  if (args.agreementSignedAt) return "billing_pending";
  if (args.agreementStatus === "pending") return "agreement_sent";
  if (args.proposalStatus === "accepted") return "proposal_accepted";
  if (args.proposalStatus === "changes_requested") return "changes_requested";
  if (args.proposalStatus === "sent") return "proposal_sent";
  if (args.proposalStatus === "expired") return "proposal_expired";
  if (args.pricedSites > 0 && args.pricedSites === openSites) return "firm_price_ready";
  return "pricing_pending";
}

export function proposalSendRequirements(input: {
  businessName: string;
  recipientName: string;
  recipientEmail: string;
  frequency: string;
  sites: WalkInSiteInput[];
}): string[] {
  const out: string[] = [];
  if (!input.businessName.trim()) out.push("Business name");
  if (!input.recipientName.trim()) out.push("Decision-maker's name");
  if (!isValidProposalEmail(input.recipientEmail)) out.push("Decision-maker's email");
  if (!String(input.frequency || "").trim()) out.push("Service frequency");
  if (!input.sites.length) out.push("At least one site with an address");
  for (const site of input.sites) {
    const name = site.nickname.trim() || "Site";
    if (!site.rateCents || site.rateCents <= 0) {
      out.push(`${name} still needs a per-visit rate`);
    }
  }
  return out;
}
