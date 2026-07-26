// ─── Scope adjustments — shared rules, pricing basis, and customer copy ───
//
// A scope adjustment is a documented price increase applied when the job that
// was actually performed differs materially from the one that was booked. The
// two rules that make it defensible live here:
//
//   1. The amount comes out of the existing pricing engine. We never invent a
//      multiplier — the increase is the engine's own delta between what was
//      booked and what was actually delivered (a higher service tier, a larger
//      sqft band, or both).
//   2. The customer message leads with objective, verifiable reasons. Reasons
//      marked internal-only (occupancy) are recorded on the record but never
//      appear in customer-facing copy.
//
// Used by the admin UI (suggestion + live message preview) and by the API
// route (which recomputes both server-side rather than trusting the client).

import {
  calculatePrice,
  SERVICE_TIER_PRICING,
  type ServiceType,
  type ZoneId,
} from "@/lib/pricing";

/** Zone B is the operational baseline; bookings do not carry a zone. */
export const DEFAULT_ZONE: ZoneId = "B";

/**
 * Statuses where an adjustment still makes sense: the job is active, the
 * cleaner has finished and it is awaiting review, or it completed recently
 * and final billing has not closed. Adjusting a cancelled job is meaningless.
 */
export const SCOPE_ADJUSTABLE_STATUSES = [
  "confirmed",
  "assigned",
  "in_progress",
  "pending_review",
  "completed",
] as const;

/** Jobs the customer should ideally hear about while the crew is still there. */
export const ACTIVE_JOB_STATUSES = ["assigned", "in_progress", "pending_review"] as const;

export function isScopeAdjustable(status: string | null | undefined): boolean {
  return (SCOPE_ADJUSTABLE_STATUSES as readonly string[]).includes(String(status || ""));
}

export function isJobStillActive(status: string | null | undefined): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(String(status || ""));
}

export interface ScopeReason {
  code: string;
  label: string;
  customer_phrase: string;
  internal_hint: string | null;
  customer_facing: boolean;
  suggests_service_type: string | null;
  service_label_override: string | null;
  sort_order: number;
  active: boolean;
}

export interface ScopeSuggestionInput {
  homeSizeId: string | null;
  addOns: string[];
  membershipPlan: string | null;
  usesCredit: boolean;
  originalServiceType: string | null;
  /** Reclassified tier. Defaults to the original — i.e. no reclassification. */
  adjustedServiceType?: string | null;
  /** Reclassified sqft band, for "larger than booked". Defaults to original. */
  adjustedHomeSizeId?: string | null;
  /** What the customer is actually on the hook for today, in cents. */
  originalPriceCents: number;
  zone?: ZoneId;
}

export interface ScopeSuggestion {
  /** Suggested new total for the booking, in cents. */
  suggestedPriceCents: number;
  /** The engine's increase over the booked scope, in cents. */
  suggestedDeltaCents: number;
  /** True when the engine has nothing to say (nothing was reclassified). */
  unpriced: boolean;
  /** Provenance, stored on the record so any number can be traced back. */
  basis: {
    zone: ZoneId;
    membershipPlan: string;
    usesCredit: boolean;
    addOns: string[];
    fromServiceType: string | null;
    toServiceType: string | null;
    fromHomeSizeId: string | null;
    toHomeSizeId: string | null;
    bookedScopeTotalCents: number;
    deliveredScopeTotalCents: number;
    originalPriceCents: number;
  };
}

const toCents = (dollars: number): number => Math.round(dollars * 100);

/**
 * Price the job as booked and as actually delivered, then apply the engine's
 * difference to what the customer is really paying. Working from the delta
 * (rather than replacing the price with a fresh quote) keeps member rates,
 * acquisition discounts, and wallet credit intact — the customer is charged
 * for the extra scope, not re-quoted from scratch.
 */
export function suggestScopeAdjustment(input: ScopeSuggestionInput): ScopeSuggestion {
  const zone = input.zone || DEFAULT_ZONE;
  const membershipPlan = input.membershipPlan || "none";
  const addOns = input.addOns || [];
  const fromType = (input.originalServiceType || "standard") as ServiceType;
  const toType = (input.adjustedServiceType || input.originalServiceType || "standard") as ServiceType;
  const fromSize = input.homeSizeId || "";
  const toSize = input.adjustedHomeSizeId || input.homeSizeId || "";

  const booked = calculatePrice(fromSize, fromType, addOns, membershipPlan, input.usesCredit, zone);
  const delivered = calculatePrice(toSize, toType, addOns, membershipPlan, input.usesCredit, zone);

  const bookedCents = toCents(booked.total);
  const deliveredCents = toCents(delivered.total);
  const deltaCents = Math.max(0, deliveredCents - bookedCents);
  const unpriced = deltaCents === 0;

  return {
    suggestedPriceCents: input.originalPriceCents + deltaCents,
    suggestedDeltaCents: deltaCents,
    unpriced,
    basis: {
      zone,
      membershipPlan,
      usesCredit: input.usesCredit,
      addOns,
      fromServiceType: input.originalServiceType || null,
      toServiceType: toType,
      fromHomeSizeId: input.homeSizeId || null,
      toHomeSizeId: toSize || null,
      bookedScopeTotalCents: bookedCents,
      deliveredScopeTotalCents: deliveredCents,
      originalPriceCents: input.originalPriceCents,
    },
  };
}

/**
 * Customer-facing name for the reclassified service. A reason may override it
 * where the tier name alone undersells the work (post-event prices as Deep but
 * reads better as "Post-Event Deep Clean").
 */
export function serviceLabelFor(
  serviceType: string | null | undefined,
  reasons: ScopeReason[],
): string {
  const override = reasons.find(
    (r) => r.customer_facing && r.service_label_override && r.suggests_service_type === serviceType,
  );
  if (override?.service_label_override) return override.service_label_override;
  const tier = SERVICE_TIER_PRICING[(serviceType || "standard") as ServiceType];
  return tier?.label || "Deep Clean";
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface DraftMessageInput {
  firstName?: string | null;
  reasons: ScopeReason[];
  selectedCodes: string[];
  adjustedServiceType: string | null;
  adjustedPriceCents: number;
  /** Service date, used to say "today's clean" vs naming the date. */
  serviceDate?: string | null;
  hasPhotoEvidence: boolean;
}

/**
 * Draft the justification the customer receives. Editable before send, but the
 * default is written to stand on its own: objective reasons first, the
 * agreement as the basis, the reclassified service and new rate stated plainly,
 * and the photo record referenced. Never accusatory, and never led by the
 * occupancy reason.
 */
export function draftJustificationMessage(input: DraftMessageInput): string {
  const selected = input.reasons.filter((r) => input.selectedCodes.includes(r.code));
  const objective = selected.filter((r) => r.customer_facing);

  const phrases = objective.map((r) => r.customer_phrase);
  const lead = phrases.length
    ? capitalize(joinPhrases(phrases))
    : "The job required work beyond what the booked service covers";

  const greeting = input.firstName ? `Hi ${input.firstName} — ` : "";
  const occasion = isToday(input.serviceDate)
    ? "an update on today's clean."
    : "an update on your recent clean.";

  const serviceLabel = serviceLabelFor(input.adjustedServiceType, selected);
  const price = `$${(input.adjustedPriceCents / 100).toFixed(2)}`;

  const evidence = input.hasPhotoEvidence
    ? " Our team did a thorough job and the before/after photos are on file."
    : " Our team did a thorough job on it.";

  return (
    `${greeting}${occasion} ${lead}. ` +
    `Per our service agreement, which covers additional work beyond the original booking scope, ` +
    `work at this level is classified as a ${serviceLabel}, so the rate adjusts to ${price}.` +
    `${evidence} Thank you for understanding.`
  );
}

function isToday(serviceDate: string | null | undefined): boolean {
  if (!serviceDate) return false;
  return String(serviceDate).slice(0, 10) === new Date().toISOString().slice(0, 10);
}

/**
 * Short internal summary of the reasons, including the internal-only ones —
 * this is what shows on the QC record and in reporting.
 */
export function summarizeReasons(reasons: ScopeReason[], selectedCodes: string[]): string {
  const labels = reasons.filter((r) => selectedCodes.includes(r.code)).map((r) => r.label);
  return labels.length ? labels.join(" · ") : selectedCodes.join(" · ");
}
