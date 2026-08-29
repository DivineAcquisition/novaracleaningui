// ─── The consolidated onboarding session ───────────────────────────────────
//
// One token, one continuous visit: pricing review → signature → billing →
// portal login → status. Resolution, progress and the payload the client
// renders from all live here.
//
// The session is a DELIVERY wrapper. It does not decide whether an account may
// dispatch, it does not hold a second copy of whether billing is configured,
// and it cannot mark a step done that the underlying record disagrees with —
// commercial_onboarding_progress() reads the real proposal, agreement, billing
// profile and portal link every time it is asked.

import { AGREEMENT_COLS, PROPOSAL_COLS, PROPOSAL_SITE_COLS } from "@/lib/commercial-agreement-server";
import { estimatedMonthlyCents, VALUE_STACK, type ProposalSite } from "@/lib/commercial-proposal";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

const COMMERCIAL_ORIGIN =
  process.env.NEXT_PUBLIC_COMMERCIAL_ORIGIN ||
  process.env.COMMERCIAL_ORIGIN ||
  "https://commercial.novaracleaning.com";

const PARTNER_ORIGIN =
  process.env.NEXT_PUBLIC_PARTNER_ORIGIN ||
  process.env.PARTNER_ORIGIN ||
  "https://partner.novaracleaning.com";

/** The one link a commercial client is ever sent during onboarding. */
export function onboardingUrl(token: string): string {
  return `${COMMERCIAL_ORIGIN.replace(/\/+$/, "")}/onboarding/${token}`;
}

export function portalUrl(): string {
  return PARTNER_ORIGIN.replace(/\/+$/, "");
}

export const SESSION_COLS = `
  id, business_account_id, proposal_id, agreement_id, token, expires_at,
  billing_method, recipient_name, recipient_email, recipient_phone, status,
  sent_at, send_count, first_viewed_at, last_viewed_at, view_count,
  last_activity_at, last_completed_step, completed_at, created_by_name, created_at
`;

export type SessionStep = "pricing" | "agreement" | "billing" | "portal" | "done" | "paused";

export interface Resolved {
  ok: boolean;
  status: number;
  reason: string;
  message: string;
  session: Row | null;
}

function refuse(status: number, reason: string, message: string): Resolved {
  return { ok: false, status, reason, message, session: null };
}

/**
 * Resolve an onboarding link.
 *
 * A COMPLETED session still resolves. The client may be coming back to read
 * the checklist, open the portal, or send us a document weeks later, and
 * "invalid link" is a poor answer to someone who did everything we asked.
 * What a completed session cannot do is re-run a step — the actions check for
 * that themselves.
 */
export async function resolveSession(supabase: Admin, token: string): Promise<Resolved> {
  if (!token || token.length < 32) {
    return refuse(404, "invalid", "This onboarding link isn't valid.");
  }

  const { data } = await supabase
    .from("commercial_onboarding_sessions")
    .select(SESSION_COLS)
    .eq("token", token)
    .maybeSingle();
  const session = (data || null) as Row | null;

  if (!session) {
    return refuse(
      404,
      "invalid",
      "This onboarding link is no longer valid. If you've already finished, you're all set — " +
        "nothing else is needed.",
    );
  }

  const status = String(session.status || "");
  if (status === "superseded") {
    return refuse(
      410,
      "superseded",
      "A newer version of this onboarding has been sent. Please use the most recent email.",
    );
  }
  if (status === "cancelled") {
    return refuse(410, "cancelled", "This onboarding was cancelled. Reply to us if that's a surprise.");
  }

  const expires = session.expires_at ? new Date(String(session.expires_at)).getTime() : 0;
  if (status === "active" && expires && expires < Date.now()) {
    return refuse(
      410,
      "expired",
      "This onboarding link has expired. Reply to the email and we'll send a fresh one.",
    );
  }

  return { ok: true, status: 200, reason: "ok", message: "", session };
}

export interface Progress {
  ok: boolean;
  current_step: SessionStep;
  paused_for_changes: boolean;
  complete: boolean;
  billing_method: "auto_pay" | "invoiced";
  steps: Array<{ key: string; label: string; done: boolean }>;
  compliance: Row | null;
  billing: Row | null;
}

export async function loadProgress(supabase: Admin, sessionId: string): Promise<Progress> {
  const { data } = await supabase.rpc("commercial_onboarding_progress", { p_session_id: sessionId });
  return (data || {
    ok: false,
    current_step: "pricing",
    paused_for_changes: false,
    complete: false,
    billing_method: "invoiced",
    steps: [],
    compliance: null,
    billing: null,
  }) as Progress;
}

/**
 * Anything the client actually DID. Views deliberately don't count: a signer
 * who keeps reopening the link without moving is exactly the case the stall
 * window is meant to surface.
 */
export async function touchActivity(
  supabase: Admin,
  sessionId: string,
  step?: string,
): Promise<void> {
  await supabase
    .from("commercial_onboarding_sessions")
    .update({
      last_activity_at: new Date().toISOString(),
      ...(step ? { last_completed_step: step } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

/**
 * Close the session once every step is done — and only then. The link is
 * retired at the same moment, the same retire-on-completion pattern the
 * proposal and agreement links use.
 */
export async function closeIfComplete(
  supabase: Admin,
  session: Row,
  progress: Progress,
): Promise<boolean> {
  if (!progress.complete || session.status !== "active") return false;
  await supabase
    .from("commercial_onboarding_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id as string);

  await supabase.from("events").insert({
    event_type: "commercial.onboarding.completed",
    source: "commercial-onboarding",
    summary: `Commercial onboarding completed for account ${String(session.business_account_id)}.`,
    data: {
      account_id: session.business_account_id,
      session_id: session.id,
      billing_method: session.billing_method,
    },
  });
  return true;
}

export interface SessionPayload {
  session: {
    id: string;
    status: string;
    billingMethod: string;
    recipientName: string | null;
    expiresAt: string | null;
    completedAt: string | null;
  };
  progress: Progress;
  account: Row | null;
  proposal: Row | null;
  sites: ProposalSite[];
  agreement: Row | null;
  billing: Row | null;
  billingProfile: Row | null;
  valueStack: typeof VALUE_STACK;
  portalUrl: string;
  submissions: Row[];
}

/**
 * Everything the client's page needs, in one read.
 *
 * The page renders from `progress.current_step`, so a reopened link lands on
 * the right step without the browser remembering anything — the resumability
 * requirement is satisfied by the server, not by local state that a different
 * device or a cleared cache would lose.
 */
export async function sessionPayload(supabase: Admin, session: Row): Promise<SessionPayload> {
  const accountId = String(session.business_account_id);

  const [progress, accountRes, proposalRes, agreementRes, billingRes, profileRes, subsRes] =
    await Promise.all([
      loadProgress(supabase, String(session.id)),
      supabase
        .from("business_accounts")
        .select(
          "id, business_name, contact_name, email, phone, address, city, state, zip_code, " +
            "preferred_billing_method, portal_user_id, portal_created_at, requires_coi_on_file",
        )
        .eq("id", accountId)
        .maybeSingle(),
      session.proposal_id
        ? supabase.from("commercial_proposals").select(PROPOSAL_COLS).eq("id", session.proposal_id).maybeSingle()
        : Promise.resolve({ data: null }),
      session.agreement_id
        ? supabase
            .from("commercial_agreements")
            .select(`${AGREEMENT_COLS}, exhibit_a_sites`)
            .eq("id", session.agreement_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc("commercial_billing_state", { p_account_id: accountId }),
      supabase
        .from("commercial_billing_profiles")
        .select("*")
        .eq("business_account_id", accountId)
        .maybeSingle(),
      supabase
        .from("commercial_onboarding_submissions")
        .select("id, kind, site_nickname, site_address, document_name, note, status, submitted_at")
        .eq("business_account_id", accountId)
        .order("submitted_at", { ascending: false })
        .limit(25),
    ]);

  const proposal = (proposalRes?.data || null) as Row | null;
  const agreement = (agreementRes?.data || null) as Row | null;

  // Exhibit A is frozen onto the agreement once it exists; before that the
  // proposal's snapshot rows are what was offered. Never live business_sites —
  // a site edited after the proposal went out must not silently change what
  // the client is looking at.
  let sites: ProposalSite[] = [];
  if (agreement?.exhibit_a_sites) {
    sites = (agreement.exhibit_a_sites as ProposalSite[]) || [];
  } else if (proposal?.id) {
    const { data } = await supabase
      .from("commercial_proposal_sites")
      .select(PROPOSAL_SITE_COLS)
      .eq("proposal_id", proposal.id)
      .order("sort_order", { ascending: true });
    sites = (data || []) as ProposalSite[];
  }

  return {
    session: {
      id: String(session.id),
      status: String(session.status),
      billingMethod: String(session.billing_method),
      recipientName: (session.recipient_name as string) || null,
      expiresAt: (session.expires_at as string) || null,
      completedAt: (session.completed_at as string) || null,
    },
    progress,
    account: (accountRes?.data || null) as Row | null,
    proposal: proposal
      ? {
          id: proposal.id,
          version: proposal.version,
          status: proposal.status,
          proposedFrequency: proposal.proposed_frequency,
          term: proposal.term,
          invoiceCycle: proposal.invoice_cycle,
          netTerms: proposal.net_terms,
          coverNote: proposal.cover_note,
          totalPerVisitCents: proposal.total_per_visit_cents,
          estimatedMonthlyCents: estimatedMonthlyCents(sites),
          changeRequestNote: proposal.change_request_note,
        }
      : null,
    sites,
    agreement: agreement
      ? {
          id: agreement.id,
          status: agreement.status,
          term: agreement.term,
          billingMethod: agreement.billing_method,
          invoiceCycle: agreement.invoice_cycle,
          netTerms: agreement.net_terms,
          exhibitAText: agreement.exhibit_a_text,
          totalPerVisitCents: agreement.total_per_visit_cents,
          signerName: agreement.signer_name,
          signerEmail: agreement.signer_email,
          signerTitle: agreement.signer_title,
          signedAt: agreement.signed_at,
          signedByName: agreement.signed_by_name,
          countersignedAt: agreement.countersigned_at,
          countersignedByName: agreement.countersigned_by_name,
        }
      : null,
    billing: (billingRes?.data || null) as Row | null,
    billingProfile: (profileRes?.data || null) as Row | null,
    valueStack: VALUE_STACK,
    portalUrl: portalUrl(),
    submissions: (subsRes?.data || []) as Row[],
  };
}
