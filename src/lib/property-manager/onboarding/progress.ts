// ─── Derived property-manager onboarding progress ──────────────────────────
//
// PURE module, mirroring the host pattern: the session table stores facts
// (signed_at, decisions, billing_configured_at, portal_provisioned_at) and the
// page the manager sees is computed from them. A reopened link, a second
// device, and the admin queue therefore cannot disagree about where someone is.
//
// Three pages, same shape as Host, one difference: Page 3 is Billing → Portal.
// Portal access is provisioned inside that page rather than being a fourth
// step, so the session ends on a confirmation with a link, not on a handoff
// the manager has to wait for.

import type { PmBillingMethod } from "./agreement";

export type PmOnboardingStep = "legal" | "registry" | "billing" | "done";

export interface PmProgressStep {
  key: PmOnboardingStep;
  label: string;
  done: boolean;
}

export interface UnitDecision {
  unitId: string;
  decision: "confirmed" | "flagged";
}

export interface PmOnboardingProgress {
  ok: boolean;
  current_step: PmOnboardingStep;
  complete: boolean;
  signed: boolean;
  registry_ready: boolean;
  billing_ready: boolean;
  portal_ready: boolean;
  steps: PmProgressStep[];
}

export const PM_ONBOARDING_STEPS: PmProgressStep[] = [
  { key: "legal", label: "Legal & Signature", done: false },
  { key: "registry", label: "Unit Registry & Rates", done: false },
  { key: "billing", label: "Billing & Portal", done: false },
];

/**
 * Page 2 is done when every unit in the snapshot has been decided.
 *
 * A flag counts as a decision. Flagging a unit raises it with our team; it
 * does not hold the manager on Page 2 waiting for an answer, because the rest
 * of their portfolio is fine and the point of this session is to finish it.
 */
export function registryReady(snapshotUnitIds: string[], decisions: UnitDecision[]): boolean {
  if (snapshotUnitIds.length === 0) return false;
  const byId = new Map(decisions.map((d) => [d.unitId, d.decision]));
  return snapshotUnitIds.every((id) => {
    const d = byId.get(id);
    return d === "confirmed" || d === "flagged";
  });
}


/**
 * Invoiced accounts have no card to capture, so billing is ready as soon as
 * the manager confirms the billing contact and terms. Auto-Pay needs a
 * payment method actually on file. Either way the signature gates everything.
 */
export function billingReady(input: {
  billingMethod: PmBillingMethod | string | null;
  billingConfirmed: boolean;
  paymentMethodOnFile: boolean;
}): boolean {
  if (!input.billingConfirmed) return false;
  const method = String(input.billingMethod || "");
  if (method === "invoiced") return true;
  if (method === "auto_pay") return !!input.paymentMethodOnFile;
  return false;
}

export function derivePmOnboardingProgress(input: {
  signed: boolean;
  snapshotUnitIds: string[];
  decisions: UnitDecision[];
  billingMethod: PmBillingMethod | string | null;
  billingConfirmed: boolean;
  paymentMethodOnFile: boolean;
  portalReady: boolean;
}): PmOnboardingProgress {
  const signed = !!input.signed;
  const registry = signed && registryReady(input.snapshotUnitIds, input.decisions);
  const billing =
    signed &&
    billingReady({
      billingMethod: input.billingMethod,
      billingConfirmed: input.billingConfirmed,
      paymentMethodOnFile: input.paymentMethodOnFile,
    });
  const portal = signed && !!input.portalReady;
  // Page 3 covers both halves — billing configured AND portal provisioned.
  const billingPageDone = billing && portal;


  const current: PmOnboardingStep = !signed
    ? "legal"
    : !registry
      ? "registry"
      : !billingPageDone
        ? "billing"
        : "done";

  return {
    ok: true,
    current_step: current,
    complete: signed && registry && billing && portal,
    signed,
    registry_ready: registry,
    billing_ready: billing,
    portal_ready: portal,
    steps: [
      { key: "legal", label: "Legal & Signature", done: signed },
      { key: "registry", label: "Unit Registry & Rates", done: registry },
      { key: "billing", label: "Billing & Portal", done: billingPageDone },
    ],
  };
}

export function sessionIsStalled(input: {
  status: string;
  sentAt: string | null;
  complete: boolean;
  lastActivityAt: string | null;
  stalledAfterHours: number;
  nowMs?: number;
}): boolean {
  if (input.status !== "active") return false;
  if (!input.sentAt) return false;
  if (input.complete) return false;
  if (!input.lastActivityAt) return false;
  const windowMs = Math.max(1, input.stalledAfterHours) * 3600_000;
  const now = input.nowMs ?? Date.now();
  return now - new Date(input.lastActivityAt).getTime() > windowMs;
}
