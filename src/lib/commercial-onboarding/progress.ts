// ─── Derived commercial-onboarding progress ────────────────────────────────
//
// Three pages, same facts the SQL function commercial_onboarding_progress()
// reads: pricing accepted, agreement signed, billing configured, portal
// provisioned. Portal is not its own page — Page 3 (Billing) concludes with
// portal access, matching the host payment page.

export type CommercialOnboardingStep = "pricing" | "agreement" | "billing" | "done" | "paused";

export interface CommercialProgressStep {
  key: "pricing" | "agreement" | "billing";
  label: string;
  done: boolean;
}

export interface CommercialOnboardingProgress {
  ok: boolean;
  current_step: CommercialOnboardingStep;
  paused_for_changes: boolean;
  complete: boolean;
  billing_configured: boolean;
  portal_ready: boolean;
  billing_method: "auto_pay" | "invoiced";
  steps: CommercialProgressStep[];
}

export function billingStepLabel(method: "auto_pay" | "invoiced"): string {
  return method === "auto_pay"
    ? "Billing setup (Stripe Pre-Auth) and portal access"
    : "Billing setup (Invoice) and portal access";
}

/**
 * Mirror of commercial_onboarding_progress(). Keep this in lock-step with the
 * SQL function — the UI tests and the verify script read this, the live page
 * reads the RPC.
 */
export function deriveCommercialOnboardingProgress(input: {
  proposalStatus?: string | null;
  hasAgreement?: boolean;
  agreementStatus?: string | null;
  billingConfigured?: boolean;
  portalReady?: boolean;
  billingMethod?: "auto_pay" | "invoiced";
}): CommercialOnboardingProgress {
  const method = input.billingMethod === "auto_pay" ? "auto_pay" : "invoiced";
  const paused = input.proposalStatus === "changes_requested";
  const pricing =
    input.proposalStatus === "accepted" || !!input.hasAgreement || input.agreementStatus === "signed";
  const signed = input.agreementStatus === "signed";
  const billed = !!input.billingConfigured;
  const portal = !!input.portalReady;
  // Auto-Pay: the agreement is not complete until the pre-auth hold lands.
  // Invoiced accounts finish the agreement on signature, then confirm billing contact.
  const agreementDone = signed && (method === "invoiced" || billed);
  const complete = pricing && signed && billed && portal && agreementDone;

  const current: CommercialOnboardingStep = paused
    ? "paused"
    : !pricing
      ? "pricing"
      : !signed
        ? "agreement"
        : !complete
          ? "billing"
          : "done";

  return {
    ok: true,
    current_step: current,
    paused_for_changes: paused,
    complete,
    billing_configured: billed,
    portal_ready: portal,
    billing_method: method,
    steps: [
      { key: "pricing", label: "Pricing & Terms", done: pricing },
      { key: "agreement", label: "Agreement", done: agreementDone },
      { key: "billing", label: billingStepLabel(method), done: billed && portal },
    ],
  };
}
