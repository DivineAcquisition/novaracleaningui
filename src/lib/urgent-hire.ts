// ─── Urgent Hire — shared settings, copy, and qualification helpers ──────────
//
// Last-resort coverage: admin broadcasts a premium first-job offer to
// pipeline applicants (Screening-Passed or later, not yet Active) who are
// in radius. Background check is deliberately NOT required on this path.
// Signed agreement, payout setup, and a valid supply checklist still are.
//
// This module is the source of truth for tunables and copy. The edge
// function mirrors the pieces it needs in supabase/functions/_shared/urgent-hire.ts.

import {
  SUPPLY_READY_PERCENT,
  neededSupplyItems,
  scoreSupplyInventory,
  type SupplyInventory,
} from "@/lib/cleaner-supplies";

export const URGENT_HIRE_SETTINGS_KEY = "urgent_hire_settings";
export const URGENT_HIRE_PORTAL_BASE = "https://contractor.novaracleaning.com";

/** Pipeline stages that count as Screening-Passed or later, not yet Active. */
export const URGENT_HIRE_ELIGIBLE_STAGES = ["screening", "onboarding", "agreement_signed"] as const;
export const URGENT_HIRE_EXCLUDED_STAGES = ["applicant", "hold", "rejected", "withdrawn", "active"] as const;

export interface UrgentHireSettings {
  radius_miles: number;
  pay_percent: number;
  first_job_only: boolean;
  fill_window_minutes: number;
  checklist_freshness_days: number;
}

export const URGENT_HIRE_DEFAULTS: UrgentHireSettings = {
  radius_miles: 25,
  pay_percent: 45,
  first_job_only: true,
  fill_window_minutes: 90,
  checklist_freshness_days: 30,
};

export function parseUrgentHireSettings(raw: unknown): UrgentHireSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    radius_miles: num(src.radius_miles, URGENT_HIRE_DEFAULTS.radius_miles, 5, 80),
    pay_percent: num(src.pay_percent, URGENT_HIRE_DEFAULTS.pay_percent, 20, 60),
    first_job_only: src.first_job_only === false ? false : true,
    fill_window_minutes: num(
      src.fill_window_minutes,
      URGENT_HIRE_DEFAULTS.fill_window_minutes,
      15,
      24 * 60,
    ),
    checklist_freshness_days: num(
      src.checklist_freshness_days,
      URGENT_HIRE_DEFAULTS.checklist_freshness_days,
      1,
      365,
    ),
  };
}

export function urgentHirePayCents(jobValueCents: number, payPercent: number): number {
  const value = Math.max(0, Math.round(Number(jobValueCents) || 0));
  const pct = Math.max(0, Number(payPercent) || 0);
  return Math.round((value * pct) / 100);
}

export function isUrgentHirePipelineStage(stage: string | null | undefined): boolean {
  const s = String(stage || "").toLowerCase();
  return (URGENT_HIRE_ELIGIBLE_STAGES as readonly string[]).includes(s);
}

export function isDeclinedPipelineStage(stage: string | null | undefined): boolean {
  const s = String(stage || "").toLowerCase();
  return s === "rejected" || s === "withdrawn";
}

/** Screening bar for this pathway: valid photo ID and own vehicle both passed. */
export function screeningQualifiersPass(answers: unknown): boolean {
  const bag = answers && typeof answers === "object" ? (answers as Record<string, unknown>) : {};
  const qualifiers = (bag.qualifiers && typeof bag.qualifiers === "object"
    ? bag.qualifiers
    : {}) as Record<string, unknown>;
  return qualifiers.photo_id === "pass" && qualifiers.own_car === "pass";
}

export function supplyChecklistFresh(
  submittedAt: string | null | undefined,
  freshnessDays: number,
  nowMs = Date.now(),
): boolean {
  if (!submittedAt) return false;
  const at = new Date(submittedAt).getTime();
  if (!Number.isFinite(at)) return false;
  const windowMs = Math.max(1, freshnessDays) * 24 * 60 * 60 * 1000;
  return nowMs - at <= windowMs;
}

export function supplyChecklistValid(opts: {
  inventory: SupplyInventory | null | undefined;
  submittedAt: string | null | undefined;
  freshnessDays: number;
  nowMs?: number;
}): { ready: boolean; fresh: boolean; valid: boolean; percent: number } {
  const score = scoreSupplyInventory(opts.inventory);
  const fresh = supplyChecklistFresh(opts.submittedAt, opts.freshnessDays, opts.nowMs);
  return {
    ready: score.ready,
    fresh,
    valid: score.ready && fresh,
    percent: score.percent,
  };
}

export function payoutsReady(cleaner: {
  payouts_enabled?: boolean | null;
  ob_payouts_setup?: boolean | null;
  stripe_account_id?: string | null;
}): boolean {
  return Boolean(
    cleaner.payouts_enabled ||
      cleaner.ob_payouts_setup ||
      (cleaner.stripe_account_id && String(cleaner.stripe_account_id).trim()),
  );
}

export type UrgentHireRemainingStep = "supplies" | "agreement" | "payout";

export function remainingUrgentHireSteps(opts: {
  checklistValid: boolean;
  agreementSigned: boolean;
  payoutsReady: boolean;
}): UrgentHireRemainingStep[] {
  const steps: UrgentHireRemainingStep[] = [];
  if (!opts.checklistValid) steps.push("supplies");
  if (!opts.agreementSigned) steps.push("agreement");
  if (!opts.payoutsReady) steps.push("payout");
  return steps;
}

export function urgentHireOfferUrl(token: string): string {
  return `${URGENT_HIRE_PORTAL_BASE}/cleaner/urgent-hire/${encodeURIComponent(token)}`;
}

export function stepReturnQuery(offerToken: string): string {
  return `uh=${encodeURIComponent(offerToken)}`;
}

export interface UrgentHireOfferCopy {
  serviceType: string;
  dateLabel: string;
  timeWindow: string;
  zone: string;
  payPercent: number;
  payDollars: string;
  firstJobOnly: boolean;
  offerUrl: string;
  needsChecklist: boolean;
}

export function firstJobOnlySentence(firstJobOnly: boolean, payPercent: number): string {
  if (firstJobOnly) {
    return `This ${payPercent}% rate applies to your first job only; standard tier rates apply after.`;
  }
  return `This job pays ${payPercent}% of the job value.`;
}

export function buildUrgentHireSms(copy: UrgentHireOfferCopy): string {
  const when = copy.timeWindow
    ? `${copy.dateLabel} · ${copy.timeWindow}`
    : copy.dateLabel;
  const firstJob = firstJobOnlySentence(copy.firstJobOnly, copy.payPercent);
  const gate = copy.needsChecklist
    ? "Accepting requires finishing remaining steps first (supply checklist, agreement, payout setup) — the job goes to whoever finishes and accepts soonest."
    : "Accepting requires a signed agreement and payout setup if you haven't finished them — the job goes to whoever finishes and accepts soonest.";
  return (
    `Novara — Urgent Hire\n\n` +
    `${copy.serviceType}\n` +
    `${when}\n` +
    `Area: ${copy.zone}\n` +
    `Your pay: $${copy.payDollars} (${copy.payPercent}% of job value)\n` +
    `${firstJob}\n\n` +
    `${gate}\n\n` +
    `${copy.offerUrl}`
  );
}

export function neededSupplyCount(): number {
  return neededSupplyItems().length;
}

export function supplyReadyPercent(): number {
  return SUPPLY_READY_PERCENT;
}
