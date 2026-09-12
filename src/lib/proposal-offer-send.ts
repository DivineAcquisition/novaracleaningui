// ─── Proposal send — four unique offer flows ───────────────────────────────
//
// Proposals is the execution of an offer: mail the agreement and payment
// setup. Each line of business has its own path. Pure helpers only.

import { isValidProposalEmail } from "@/lib/commercial-proposal-send";

export const PROPOSAL_SEND_FLOWS = ["str", "office", "commercial", "property_manager"] as const;
export type ProposalSendFlow = (typeof PROPOSAL_SEND_FLOWS)[number];

export interface ProposalSendFlowDef {
  id: ProposalSendFlow;
  label: string;
  shortLabel: string;
  mails: string;
  detail: string;
}

export const PROPOSAL_SEND_FLOW_DEFS: ProposalSendFlowDef[] = [
  {
    id: "str",
    label: "STR (Host)",
    shortLabel: "STR",
    mails: "Host onboarding — agreement + payment",
    detail: "Start here. Type the host and home details, set the turnover rate, and send. No request or walkthrough.",
  },
  {
    id: "office",
    label: "Office",
    shortLabel: "Office",
    mails: "Proposal → agreement → billing",
    detail: "Search the prospect from a request, or type a walk-in. Decision-maker accepts, signs, and sets invoice or Stripe Pre-Auth.",
  },
  {
    id: "commercial",
    label: "Commercial",
    shortLabel: "Commercial",
    mails: "Proposal → agreement → billing",
    detail: "Search the prospect from a request, or type a walk-in for retail, medical, gym, warehouse. Same accept → sign → pay motion as office.",
  },
  {
    id: "property_manager",
    label: "Property Manager",
    shortLabel: "PM",
    mails: "PM onboarding — agreement + payment",
    detail: "Start here. Type the company and units, set standing rates, and send. No request or walkthrough.",
  },
];

export function isProposalSendFlow(raw: string | null | undefined): raw is ProposalSendFlow {
  return !!raw && (PROPOSAL_SEND_FLOWS as readonly string[]).includes(raw);
}

export function proposalSendFlowDef(id: ProposalSendFlow): ProposalSendFlowDef {
  return PROPOSAL_SEND_FLOW_DEFS.find((f) => f.id === id) || PROPOSAL_SEND_FLOW_DEFS[2];
}

export interface StrOfferPropertyInput {
  nickname: string;
  address: string;
  turnoverDollars: number | null;
}

export function strOfferRequirements(input: {
  hostName: string;
  email: string;
  properties: StrOfferPropertyInput[];
}): string[] {
  const out: string[] = [];
  if (!input.hostName.trim()) out.push("Host name");
  if (!isValidProposalEmail(input.email)) out.push("Host email");
  if (!input.properties.length) out.push("At least one property");
  for (const property of input.properties) {
    const name = property.nickname.trim() || property.address.trim() || "Property";
    if (!property.address.trim()) out.push(`${name} still needs an address`);
    if (!property.turnoverDollars || property.turnoverDollars <= 0) {
      out.push(`${name} still needs a turnover rate`);
    }
  }
  return out;
}

export interface PmOfferUnitInput {
  nickname: string;
  address: string;
  priced: boolean;
}

export function pmOfferRequirements(input: {
  companyName: string;
  contactName: string;
  email: string;
  units: PmOfferUnitInput[];
}): string[] {
  const out: string[] = [];
  if (!input.companyName.trim()) out.push("Company name");
  if (!input.contactName.trim()) out.push("Contact name");
  if (!isValidProposalEmail(input.email)) out.push("Contact email");
  if (!input.units.length) out.push("At least one unit");
  for (const unit of input.units) {
    const name = unit.nickname.trim() || unit.address.trim() || "Unit";
    if (!unit.address.trim()) out.push(`${name} still needs an address`);
    if (!unit.priced) out.push(`${name} still needs standing rates (or enough detail to auto-price)`);
  }
  return out;
}
