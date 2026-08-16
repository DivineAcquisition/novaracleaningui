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
  ADD_ONS,
  calculatePrice,
  SCOPE_REASON_ADD_ONS,
  SERVICE_TIER_PRICING,
  type AddOnId,
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
  /** Add-ons actually performed. Defaults to the booked set. */
  adjustedAddOns?: string[] | null;
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
    adjustedAddOns: string[];
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
  const adjustedAddOns = input.adjustedAddOns || addOns;
  const fromType = (input.originalServiceType || "standard") as ServiceType;
  const toType = (input.adjustedServiceType || input.originalServiceType || "standard") as ServiceType;
  const fromSize = input.homeSizeId || "";
  const toSize = input.adjustedHomeSizeId || input.homeSizeId || "";

  const booked = calculatePrice(fromSize, fromType, addOns, membershipPlan, input.usesCredit, zone);
  const delivered = calculatePrice(toSize, toType, adjustedAddOns, membershipPlan, input.usesCredit, zone);

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
      adjustedAddOns,
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

export type ScopeReasonPriceKind = "addon" | "tier" | "open";

export interface ScopeReasonPricePreview {
  kind: ScopeReasonPriceKind;
  /** Extra the customer is billed for this reason, in cents. Null = set on the form. */
  cents: number | null;
}

/**
 * Dollar amount shown next to a justification reason. Catalog add-ons use the
 * add-on price; reasons that reclassify the service use the engine's delta
 * for that tier. Unpriced reasons (size band, occupancy) are set below.
 */
export function scopeReasonPricePreview(
  reason: ScopeReason,
  input: ScopeSuggestionInput,
): ScopeReasonPricePreview {
  const addonId = SCOPE_REASON_ADD_ONS[reason.code];
  if (addonId) {
    const price = ADD_ONS[addonId as AddOnId]?.price;
    return {
      kind: "addon",
      cents: typeof price === "number" ? Math.round(price * 100) : null,
    };
  }
  if (reason.suggests_service_type) {
    const suggestion = suggestScopeAdjustment({
      ...input,
      adjustedServiceType: reason.suggests_service_type,
      adjustedHomeSizeId: input.homeSizeId,
      adjustedAddOns: input.addOns,
    });
    return { kind: "tier", cents: suggestion.suggestedDeltaCents };
  }
  return { kind: "open", cents: null };
}

export function formatScopeReasonPrice(preview: ScopeReasonPricePreview): string {
  if (preview.cents == null) return "set below";
  if (preview.cents <= 0) return preview.kind === "tier" ? "no extra" : "$0";
  const dollars = `$${(preview.cents / 100).toFixed(preview.cents % 100 === 0 ? 0 : 2)}`;
  return preview.kind === "addon" ? dollars : `+${dollars}`;
}

export interface DraftMessageInput {
  firstName?: string | null;
  reasons: ScopeReason[];
  selectedCodes: string[];
  adjustedServiceType: string | null;
  adjustedPriceCents: number;
  /** Booked / current total, so we can name the extra in the billing sentence. */
  originalPriceCents?: number;
  /** Service date, used to say "today's clean" vs naming the date. */
  serviceDate?: string | null;
  hasPhotoEvidence: boolean;
  /** Already-completed jobs are charged when the adjustment is applied. */
  chargeAt?: "completion" | "now";
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
  const extraCents =
    input.originalPriceCents != null
      ? Math.max(0, input.adjustedPriceCents - input.originalPriceCents)
      : 0;
  const extra = extraCents > 0 ? `$${(extraCents / 100).toFixed(2)}` : "";
  const billing = extra
    ? input.chargeAt === "now"
      ? ` The additional ${extra} is charged to the card on file now that this clean is complete.`
      : ` The additional ${extra} will be charged to the card on file when this clean is completed.`
    : "";

  const evidence = input.hasPhotoEvidence
    ? " Our team did a thorough job and the before/after photos are on file."
    : " Our team did a thorough job on it.";

  return (
    `${greeting}${occasion} ${lead}. ` +
    `Per our service agreement, which covers additional work beyond the original booking scope, ` +
    `work at this level is classified as a ${serviceLabel}, so the rate adjusts to ${price}.` +
    `${billing}` +
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
