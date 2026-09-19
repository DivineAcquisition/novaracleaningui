// ─── STR public landing: estimate + typical/unusual CTA ────────────────────
//
// PURE module (client-safe). try.novaracleaning.com/str is an acquisition
// front door for Airbnb/STR hosts — not the rental-property /portfolio page
// and not a second rate table. Quotes come from Host Partnership Agreement
// Part Two (src/lib/host-onboarding/rates.ts). Typical listings Claim into
// existing host onboarding; unusual ones Book a Call.

import {
  HOST_QUOTE_LOCK_HOURS,
  computeTurnoverQuote,
  formatDollarRange,
  type HostTurnoverQuote,
} from "@/lib/host-onboarding/rates";

export const STR_PATH = "/str";
export const STR_ORIGIN = "https://try.novaracleaning.com";
export const STR_URL = `${STR_ORIGIN}${STR_PATH}`;

export const MAX_LANDING_LISTINGS = 12;
/** "A small number of listings" — above this, Book a Call. */
export const MAX_TYPICAL_LISTINGS = 4;
/** Ordinary bath count. 5+ baths is treated as an unusually large home. */
export const MAX_TYPICAL_BATHROOMS = 4;

/** Existing discovery-call calendar — same 15-minute slot as the rest of intake. */
export const STR_CAL_LINK = "malik-sannie-clwphb/15min";
export const STR_CAL_ORIGIN = "https://app.cal.com";
export const STR_CAL_NAMESPACE = "15min";

export const LANDING_PROPERTY_TAG = "str-landing";

export const ESTIMATE_DISCLAIMER =
  "This is an estimate, not a final per-turnover rate. Rates follow the Host " +
  "Partnership Agreement Property & Rate Schedule (base + linen + restock by " +
  "bedroom band). The number you claim is locked for 48 hours and confirmed " +
  "on the rate-schedule page at onboarding.";

/** Agreement §5.2 — the Host confirms the schedule; the Host does not set the rate. */
export const COMPANY_SETS_RATES =
  "Novara sets this rate from the Host Partnership Agreement Property & Rate " +
  "Schedule (Section 5.2). You confirm the schedule at onboarding; you do not " +
  "set, negotiate, or edit the number.";

/**
 * Agreement §5.3 — required whenever an introductory rate is shown.
 * The calculator does not currently run an intro rate; keep this next to any
 * intro figure so the standard-rate-after-period disclosure is never omitted.
 */
export const INTRO_RATE_ACTIVE = false;
export const INTRO_RATE_DISCLOSURE =
  "If an introductory rate is shown, the standard Part Two rate applies " +
  "automatically after the introductory period.";

export type ClaimEntityType = "individual" | "entity";

export function parseClaimEntity(body: Record<string, unknown>):
  | { ok: true; entityType: ClaimEntityType; entityName: string | null }
  | { ok: false; message: string } {
  const raw = String(body.entityType ?? body.entity_type ?? "")
    .trim()
    .toLowerCase();
  if (raw !== "individual" && raw !== "entity") {
    return {
      ok: false,
      message: "Are you signing as an individual or a business entity?",
    };
  }
  const entityName = String(body.entityName ?? body.entity_name ?? "").trim().slice(0, 200);
  if (raw === "entity" && entityName.length < 2) {
    return { ok: false, message: "Add the business entity name." };
  }
  return {
    ok: true,
    entityType: raw,
    entityName: raw === "entity" ? entityName : null,
  };
}

export const VALUE_STACK = [
  {
    key: "vetted",
    title: "Vetted, background-checked cleaners",
    body: "Every cleaner on a turnover has been screened. You're not posting in a group chat and hoping someone shows.",
  },
  {
    key: "tracked",
    title: "Reliability tracked",
    body: "Unreliable cleaners lose access to jobs over time. The people on your calendar are the ones who keep showing up.",
  },
  {
    key: "backup",
    title: "Backup coverage if a cleaner can't make it",
    body: "The turnover still happens on time. That's the difference — not just that we clean Airbnbs.",
  },
  {
    key: "photos",
    title: "Before-and-after photos on every turnover",
    body: "A record of the property as we left it, sent after every visit — useful when a guest review doesn't match the house.",
  },
  {
    key: "window",
    title: "Timed to checkout and check-in",
    body: "The window is the guest calendar, not a generic Tuesday morning route. Same-day turnovers are the job.",
  },
  {
    key: "guarantee",
    title: "The Spotless Guarantee",
    body: "If work is missed, tell us within 24 hours of the visit — or before the next guest if that is sooner. We return to correct covered items at no additional charge when the unit is accessible.",
  },
] as const;

export type StrMode = "uniform" | "mixed";
export type StrCta = "claim" | "book_call";

export interface StrListingInput {
  label?: string | null;
  address?: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  linen: boolean;
  restock: boolean;
  flaggedNonStandard?: boolean;
}

export interface StrEstimateInput {
  mode: StrMode;
  listingCount?: number;
  average?: {
    bedrooms: number | null;
    bathrooms: number | null;
    linen: boolean;
    restock: boolean;
  };
  listings?: StrListingInput[];
  flaggedAtypical?: boolean;
}

export interface StrListingQuote extends StrListingInput {
  quote: HostTurnoverQuote;
}

export interface StrCtaReason {
  reason: string;
  message: string;
}

export interface StrEstimateResult {
  ok: boolean;
  cta: StrCta;
  estimate: true;
  disclaimer: string;
  listingCount: number;
  listings: StrListingQuote[];
  min: number;
  max: number;
  claimed: number;
  lockHours: number;
  reasons: StrCtaReason[];
}

function bedsOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function bathsOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function expandStrListings(input: StrEstimateInput): StrListingInput[] {
  if (input.mode === "mixed") {
    return (input.listings || []).slice(0, MAX_LANDING_LISTINGS).map((l, i) => ({
      label: String(l.label || "").trim().slice(0, 80) || `Listing ${i + 1}`,
      address: String(l.address || "").trim().slice(0, 200) || null,
      bedrooms: bedsOrNull(l.bedrooms),
      bathrooms: bathsOrNull(l.bathrooms),
      linen: l.linen === true,
      restock: l.restock === true,
      flaggedNonStandard: !!l.flaggedNonStandard || !!input.flaggedAtypical,
    }));
  }

  const count = Math.min(MAX_LANDING_LISTINGS, Math.max(0, Math.floor(Number(input.listingCount) || 0)));
  const avg = input.average || { bedrooms: null, bathrooms: null, linen: false, restock: false };
  const out: StrListingInput[] = [];
  for (let i = 0; i < count; i++) {
    const typed = (input.listings || [])[i];
    out.push({
      label: String(typed?.label || "").trim().slice(0, 80) || `Listing ${i + 1}`,
      address: String(typed?.address || "").trim().slice(0, 200) || null,
      bedrooms: typed?.bedrooms != null ? bedsOrNull(typed.bedrooms) : bedsOrNull(avg.bedrooms),
      bathrooms: typed?.bathrooms != null ? bathsOrNull(typed.bathrooms) : bathsOrNull(avg.bathrooms),
      linen: typed?.linen ?? avg.linen,
      restock: typed?.restock ?? avg.restock,
      flaggedNonStandard: !!typed?.flaggedNonStandard || !!input.flaggedAtypical,
    });
  }
  return out;
}

export function strCtaFor(
  listings: StrListingInput[],
  opts?: { flaggedAtypical?: boolean },
): { cta: StrCta; reasons: StrCtaReason[] } {
  const reasons: StrCtaReason[] = [];
  if (opts?.flaggedAtypical || listings.some((l) => l.flaggedNonStandard)) {
    reasons.push({
      reason: "flagged_atypical",
      message: "This isn't a standard STR home — we'll set the rate on a call.",
    });
  }
  if (listings.length > MAX_TYPICAL_LISTINGS) {
    reasons.push({
      reason: "listing_count",
      message: `${listings.length} listings is more than we auto-onboard. Book a call and we'll set the schedule.`,
    });
  }
  if (listings.length === 0) {
    reasons.push({
      reason: "empty",
      message: "Add at least one listing to see a rate.",
    });
  }
  for (const listing of listings) {
    const q = computeTurnoverQuote({
      bedrooms: listing.bedrooms,
      linen: listing.linen,
      restock: listing.restock,
    });
    if (q.needsQuote) {
      reasons.push({
        reason: "outside_bands",
        message: `${listing.label || "A listing"} is 5+ bedrooms — the schedule quotes those instead of auto-pricing.`,
      });
    } else if (!q.ok) {
      reasons.push({
        reason: "missing_size",
        message: `${listing.label || "A listing"} needs a bedroom count before we can price it.`,
      });
    }
    if (listing.bathrooms != null && listing.bathrooms > MAX_TYPICAL_BATHROOMS) {
      reasons.push({
        reason: "outside_bands",
        message: `${listing.label || "A listing"} has an unusual bathroom count — we'll set the rate on a call.`,
      });
    }
  }
  return { cta: reasons.length ? "book_call" : "claim", reasons };
}

export function estimateStrLanding(input: StrEstimateInput): StrEstimateResult {
  const listings = expandStrListings(input);
  const split = strCtaFor(listings, { flaggedAtypical: input.flaggedAtypical });
  const quoted: StrListingQuote[] = listings.map((l) => ({
    ...l,
    quote: computeTurnoverQuote({
      bedrooms: l.bedrooms,
      linen: l.linen,
      restock: l.restock,
    }),
  }));
  const priced = quoted.filter((l) => l.quote.ok);
  const min = priced.reduce((s, l) => s + l.quote.min, 0);
  const max = priced.reduce((s, l) => s + l.quote.max, 0);
  const claimed = priced.reduce((s, l) => s + l.quote.claimed, 0);
  return {
    ok: priced.length > 0 && priced.length === quoted.length,
    cta: split.cta,
    estimate: true,
    disclaimer: ESTIMATE_DISCLAIMER,
    listingCount: listings.length,
    listings: quoted,
    min,
    max,
    claimed,
    lockHours: HOST_QUOTE_LOCK_HOURS,
    reasons: split.reasons,
  };
}

export function formatListingRange(result: StrEstimateResult): string {
  if (!result.ok || result.min <= 0) return "—";
  if (result.listingCount <= 1) return formatDollarRange(result.min, result.max);
  return `${formatDollarRange(result.min, result.max)} total · ${formatDollarRange(
    Math.round(result.min / result.listingCount),
    Math.round(result.max / result.listingCount),
  )} per turnover`;
}

export { formatDollarRange, HOST_QUOTE_LOCK_HOURS };
