// Localhost-only payloads so the three commercial-onboarding pages can be
// opened without a live session. Production tokens never hit this.

import { buildProposalExhibitA, estimatedMonthlyCents, VALUE_STACK, type ProposalSite } from "@/lib/commercial-proposal";
import { requestIsLocal } from "@/lib/partner-portal/origins";
import { deriveCommercialOnboardingProgress } from "./progress";

export const COMMERCIAL_ONBOARDING_PREVIEW_TOKENS = {
  "preview-commercial": "auto_pay",
  "preview-commercial-invoiced": "invoiced",
} as const;

export type CommercialOnboardingPreviewToken = keyof typeof COMMERCIAL_ONBOARDING_PREVIEW_TOKENS;

export function commercialOnboardingPreviewMethod(
  token: string,
  billingQuery?: string | null,
): "auto_pay" | "invoiced" | null {
  const fromToken = COMMERCIAL_ONBOARDING_PREVIEW_TOKENS[token as CommercialOnboardingPreviewToken];
  if (!fromToken) return null;
  if (billingQuery === "invoiced") return "invoiced";
  if (billingQuery === "auto_pay") return "auto_pay";
  return fromToken;
}

export function isCommercialOnboardingPreviewToken(token: string): boolean {
  return token in COMMERCIAL_ONBOARDING_PREVIEW_TOKENS;
}

export function isLocalCommercialOnboardingPreview(req: Request, token: string): boolean {
  return isCommercialOnboardingPreviewToken(token) && requestIsLocal(req);
}

type PreviewMem = {
  accepted: boolean;
  changeNote: string | null;
  signed: boolean;
  billed: boolean;
  portal: boolean;
  submissions: Array<Record<string, unknown>>;
};

const previewMem: PreviewMem = {
  accepted: false,
  changeNote: null,
  signed: false,
  billed: false,
  portal: false,
  submissions: [],
};

export function resetCommercialOnboardingPreview(): void {
  previewMem.accepted = false;
  previewMem.changeNote = null;
  previewMem.signed = false;
  previewMem.billed = false;
  previewMem.portal = false;
  previewMem.submissions = [];
}

const SITES: ProposalSite[] = [
  {
    id: "preview-s1",
    business_site_id: "preview-site-1",
    nickname: "Harbor East office",
    address: "1000 Lancaster St, Baltimore, MD 21202",
    facility_type: "office",
    scope_level: "standard",
    sqft: 4200,
    crew_size: 3,
    service_window_start: "18:00",
    service_window_end: "22:00",
    frequency: "weekly",
    per_visit_price_cents: 18500,
    price_source: "walkthrough",
  },
  {
    id: "preview-s2",
    business_site_id: "preview-site-2",
    nickname: "Canton suite",
    address: "3600 Boston St, Baltimore, MD 21224",
    facility_type: "office",
    scope_level: "light",
    sqft: 1100,
    crew_size: 2,
    service_window_start: "18:00",
    service_window_end: "21:00",
    frequency: "weekly",
    per_visit_price_cents: 10000,
    price_source: "walkthrough",
  },
];

function clip(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

function handoffUrl(method: "auto_pay" | "invoiced"): string {
  return method === "invoiced"
    ? "/partner?preview=commercial&billing=invoiced"
    : "/partner/enter/preview-commercial";
}

export function applyCommercialOnboardingPreviewAction(
  token: string,
  action: string,
  body: Record<string, unknown>,
  billingQuery?: string | null,
): { ok: boolean; status: number; message?: string; outcome?: string; url?: string; handoffUrl?: string; portalUrl?: string } {
  const method = commercialOnboardingPreviewMethod(token, billingQuery);
  if (!method) return { ok: false, status: 404, message: "This onboarding link isn't valid." };

  if (action === "submit_info") {
    const kind = ["site_request", "document", "note"].includes(String(body.kind)) ? String(body.kind) : "note";
    if (kind === "site_request" && clip(body.siteAddress, 300).length < 5) {
      return { ok: false, status: 400, message: "Add the address of the site you'd like us to look at." };
    }
    previewMem.submissions.unshift({
      id: `preview-sub-${Date.now()}`,
      kind,
      site_nickname: clip(body.siteNickname, 120) || null,
      site_address: clip(body.siteAddress, 300) || null,
      document_name: clip(body.documentName, 200) || null,
      note: clip(body.note, 4000) || null,
      status: "received",
      submitted_at: new Date().toISOString(),
    });
    return {
      ok: true,
      status: 200,
      outcome: "submitted",
      message:
        kind === "site_request"
          ? "Thanks — that's with your account manager. A new site needs its own walkthrough before we can price it, and they'll be in touch to arrange one."
          : "Thanks — that's with your account manager.",
    };
  }

  if (action === "request_changes") {
    if (previewMem.accepted || previewMem.signed) {
      return { ok: false, status: 409, message: "Changes can only be requested before the agreement is signed." };
    }
    const note = clip(body.note, 4000);
    if (note.length < 5) {
      return { ok: false, status: 400, message: "Tell us what to change and we'll send a revised proposal." };
    }
    previewMem.changeNote = note;
    return { ok: true, status: 200, outcome: "changes_requested", message: "Your account manager has the request." };
  }

  if (action === "accept_pricing") {
    if (previewMem.changeNote) {
      return { ok: false, status: 409, message: "This proposal is paused while we revise it." };
    }
    if (previewMem.accepted) {
      return { ok: false, status: 409, message: "This proposal has already been accepted." };
    }
    if (clip(body.name, 120).length < 2) {
      return { ok: false, status: 400, message: "Please enter your name to record who accepted the proposal." };
    }
    previewMem.accepted = true;
    return {
      ok: true,
      status: 200,
      outcome: "accepted",
      message: "Accepted. Your services agreement is ready to sign — it's on the next step.",
    };
  }

  if (action === "sign") {
    if (!previewMem.accepted) {
      return { ok: false, status: 409, message: "Review and accept the pricing before signing." };
    }
    if (clip(body.signerName, 120).length < 2) {
      return { ok: false, status: 400, message: "Please enter your full legal name to sign." };
    }
    if (body.agreedToTerms !== true) {
      return { ok: false, status: 400, message: "Please confirm you've read and agree to the agreement." };
    }
    previewMem.signed = true;
    return {
      ok: true,
      status: 200,
      outcome: "signed",
      message:
        method === "auto_pay"
          ? "Signed. Next: a verification hold via Stripe Pre-Auth — nothing is charged now."
          : "Signed. Next: confirm where your invoices should go.",
    };
  }

  if (action === "setup_billing") {
    if (!previewMem.signed) {
      return { ok: false, status: 409, message: "Billing is set up after the agreement is signed." };
    }
    if (method === "invoiced") {
      const email = clip(body.billingContactEmail, 200);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { ok: false, status: 400, message: "Enter the billing email invoices should go to." };
      }
    }
    previewMem.billed = true;
    previewMem.portal = true;
    const url = handoffUrl(method);
    return {
      ok: true,
      status: 200,
      outcome: "billing_configured",
      message: "Billing is configured. Your partner portal is ready.",
      handoffUrl: url,
      portalUrl: url,
    };
  }

  if (action === "billing_status") {
    if (previewMem.signed) previewMem.billed = true;
    if (previewMem.billed) previewMem.portal = true;
    return { ok: true, status: 200, outcome: previewMem.billed ? "billing_ready" : "billing_pending" };
  }

  if (action === "create_portal") {
    if (!previewMem.billed) {
      return { ok: false, status: 409, message: "Finish billing setup first — your portal opens as soon as that's done." };
    }
    previewMem.portal = true;
    const url = handoffUrl(method);
    return {
      ok: true,
      status: 200,
      outcome: "portal_created",
      message: "Your portal is ready — no password needed.",
      handoffUrl: url,
      portalUrl: url,
    };
  }

  return { ok: false, status: 400, message: `Unknown action "${action}".` };
}

export function commercialOnboardingPreviewPayload(
  token: string,
  step?: string,
  billingQuery?: string | null,
) {
  const method = commercialOnboardingPreviewMethod(token, billingQuery) || "auto_pay";

  if (step === "pricing") resetCommercialOnboardingPreview();
  if (step === "paused") {
    resetCommercialOnboardingPreview();
    previewMem.changeNote = "Could we look at a twice-weekly cadence for Harbor East?";
  }
  if (step === "agreement") {
    previewMem.accepted = true;
    previewMem.changeNote = null;
    previewMem.signed = false;
    previewMem.billed = false;
    previewMem.portal = false;
  }
  if (step === "billing") {
    previewMem.accepted = true;
    previewMem.changeNote = null;
    previewMem.signed = true;
    previewMem.billed = false;
    previewMem.portal = false;
  }
  if (step === "done") {
    previewMem.accepted = true;
    previewMem.changeNote = null;
    previewMem.signed = true;
    previewMem.billed = true;
    previewMem.portal = true;
  }

  const exhibit = buildProposalExhibitA(SITES);
  const progress = deriveCommercialOnboardingProgress({
    proposalStatus: previewMem.changeNote ? "changes_requested" : previewMem.accepted ? "accepted" : "sent",
    hasAgreement: previewMem.accepted,
    agreementStatus: previewMem.signed ? "signed" : previewMem.accepted ? "pending" : null,
    billingConfigured: previewMem.billed,
    portalReady: previewMem.portal,
    billingMethod: method,
  });

  const portal = previewMem.portal ? handoffUrl(method) : "https://partners.novaracleaning.com";

  return {
    ok: true,
    preview: true,
    session: {
      id: "preview-session",
      status: progress.complete ? "completed" : "active",
      billingMethod: method,
      recipientName: "Nadia Okonkwo",
      expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      completedAt: progress.complete ? new Date().toISOString() : null,
    },
    progress: {
      ...progress,
      compliance: progress.complete ? { blockers: ["current COI delivery"] } : { blockers: [] },
      billing: { configured: previewMem.billed, method },
    },
    account: {
      id: "preview-account",
      business_name: "Harbor East Partners",
      contact_name: "Nadia Okonkwo",
      email: "nadia@harboreast.example",
      phone: "410-555-0142",
      address: "1000 Lancaster St",
      city: "Baltimore",
      state: "MD",
      zip_code: "21202",
      preferred_billing_method: method,
      portal_user_id: previewMem.portal ? "preview-portal" : null,
      portal_created_at: previewMem.portal ? new Date().toISOString() : null,
      requires_coi_on_file: true,
    },
    proposal: {
      id: "preview-proposal",
      version: 1,
      status: previewMem.changeNote ? "changes_requested" : previewMem.accepted ? "accepted" : "sent",
      proposedFrequency: "weekly",
      term: "month_to_month",
      invoiceCycle: "monthly",
      netTerms: "net_15",
      coverNote: "Weekly evening service at both Baltimore locations. Rates are Company-set from the walkthrough.",
      totalPerVisitCents: exhibit.totalPerVisitCents,
      estimatedMonthlyCents: estimatedMonthlyCents(SITES),
      changeRequestNote: previewMem.changeNote,
    },
    sites: SITES,
    agreement: previewMem.accepted
      ? {
          id: "preview-agreement",
          status: previewMem.signed ? "signed" : "pending",
          term: "month_to_month",
          billingMethod: method,
          invoiceCycle: "monthly",
          netTerms: "net_15",
          exhibitAText: exhibit.text,
          totalPerVisitCents: exhibit.totalPerVisitCents,
          signerName: "Nadia Okonkwo",
          signerEmail: "nadia@harboreast.example",
          signerTitle: "Director of Operations",
          signedAt: previewMem.signed ? new Date().toISOString() : null,
          signedByName: previewMem.signed ? "Nadia Okonkwo" : null,
          countersignedAt: previewMem.signed ? new Date().toISOString() : null,
          countersignedByName: previewMem.signed ? "Novara Cleaning" : null,
        }
      : null,
    billing: { configured: previewMem.billed, method },
    billingProfile: previewMem.billed
      ? {
          billing_method: method,
          billing_contact_name: "Nadia Okonkwo",
          billing_contact_email: "nadia@harboreast.example",
          invoice_cycle: "monthly",
          net_terms: "net_15",
        }
      : null,
    valueStack: VALUE_STACK,
    portalUrl: portal,
    handoffUrl: previewMem.portal ? portal : undefined,
    submissions: previewMem.submissions,
  };
}
