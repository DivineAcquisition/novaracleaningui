// ─── Derived host-onboarding progress ──────────────────────────────────────
//
// The session table stores facts (signed_at, payment_option, items). The step
// the host sees is computed from those facts so a reopened link, a second
// device, or an admin view cannot disagree with what actually happened.
//
// Signature on Page 1 gates Pages 2 and 3. Nothing on those pages is treated
// as binding — or reachable — until that signature exists.

import type { PaymentOptionKey } from "./agreement";

export type HostOnboardingStep = "legal" | "rates" | "payment" | "done";

export interface HostProgressStep {
  key: HostOnboardingStep;
  label: string;
  done: boolean;
}

export interface PropertyDecision {
  propertyId: string;
  decision: "confirmed" | "flagged";
}

export interface HostOnboardingProgress {
  ok: boolean;
  current_step: HostOnboardingStep;
  complete: boolean;
  signed: boolean;
  rates_ready: boolean;
  payment_ready: boolean;
  portal_ready: boolean;
  pay_after_enabled: boolean;
  steps: HostProgressStep[];
}

export const HOST_ONBOARDING_STEPS: HostProgressStep[] = [
  { key: "legal", label: "Legal & Signature", done: false },
  { key: "rates", label: "Property & Rate Schedule", done: false },
  { key: "payment", label: "Payment Setup", done: false },
];

export function ratesReady(snapshotPropertyIds: string[], decisions: PropertyDecision[]): boolean {
  if (snapshotPropertyIds.length === 0) return false;
  const byId = new Map(decisions.map((d) => [d.propertyId, d.decision]));
  return snapshotPropertyIds.every((id) => {
    const d = byId.get(id);
    return d === "confirmed" || d === "flagged";
  });
}

/**
 * A host cannot skip ahead. Unsigned sessions stay on legal even if a
 * payment method or portal login already exists from an earlier visit.
 */
export function deriveHostOnboardingProgress(input: {
  signed: boolean;
  snapshotPropertyIds: string[];
  decisions: PropertyDecision[];
  paymentOption: PaymentOptionKey | string | null;
  paymentMethodOnFile: boolean;
  portalReady: boolean;
  payAfterEnabled?: boolean;
}): HostOnboardingProgress {
  const signed = !!input.signed;
  const rates = signed && ratesReady(input.snapshotPropertyIds, input.decisions);
  const payment =
    signed &&
    !!input.paymentOption &&
    ["full", "split", "pay_after"].includes(String(input.paymentOption)) &&
    !!input.paymentMethodOnFile;
  const portal = signed && !!input.portalReady;
  const paymentPageDone = payment && portal;

  const current: HostOnboardingStep = !signed
    ? "legal"
    : !rates
      ? "rates"
      : !paymentPageDone
        ? "payment"
        : "done";

  return {
    ok: true,
    current_step: current,
    complete: signed && rates && payment && portal,
    signed,
    rates_ready: rates,
    payment_ready: payment,
    portal_ready: portal,
    pay_after_enabled: !!input.payAfterEnabled,
    steps: [
      { key: "legal", label: "Legal & Signature", done: signed },
      { key: "rates", label: "Property & Rate Schedule", done: rates },
      { key: "payment", label: "Payment Setup", done: paymentPageDone },
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
