// ─── STR host landing: instant quote + Claim / Book a Call ─────────────────
//
// PURE module (client-safe). The /str page is the self-serve front door for
// short-term-rental hosts. Copy, the typical/unusual CTA split, and claim
// validation live here so the page, the APIs, and
// `npm run str-claim:verify` cannot disagree.
//
// Typical properties Claim This Rate straight into the EXISTING tokenized
// host onboarding session (Legal → Rates → Payment). Unusual ones Book a
// Call. Nothing here is a parallel pricing model: every rate comes from
// `host-onboarding/rate-bands`, which is Part Two.

import {
  MAX_SELF_SERVE_PROPERTIES,
  TOO_MANY_PROPERTIES_MESSAGE,
  quoteProperty,
  type PropertyQuote,
} from "@/lib/host-onboarding/rate-bands";
import type { EntityType } from "@/lib/host-onboarding/types";

export const STR_PATH = "/str";
export const STR_ORIGIN = "https://try.novaracleaning.com";
export const STR_URL = `${STR_ORIGIN}${STR_PATH}`;

/** Same integrity window the rest of intake uses. */
export const STR_QUOTE_LOCK_HOURS = 48;

/** Marks properties minted from this page so a re-claim updates, not duplicates. */
export const LANDING_PROPERTY_TAG = "str-landing";

/** Existing discovery-call calendar — the same 15-minute slot as the rest of intake. */
export const STR_CAL_LINK = "malik-sannie-clwphb/15min";
export const STR_CAL_ORIGIN = "https://app.cal.com";
export const STR_CAL_NAMESPACE = "str-15min";

export const HERO_HEADLINE =
  "Guest-ready turnover cleaning for your short-term rental — priced in seconds, not after a sales call.";

export const ESTIMATE_DISCLAIMER =
  "This rate comes from the Property & Rate Schedule reference bands in Part Two " +
  "of the Host Partnership Agreement — the same table you'll sign. It is set by " +
  "Novara from the bedroom count, bathroom count, and whether linen and " +
  "restocking are included. The rate you claim is held for 48 hours and confirmed " +
  "on the rate schedule page before you sign.";

export const VALUE_STACK = [
  {
    key: "per_property",
    title: "A rate per property, set once",
    body: "Section 5.1 — each property has its own per-turnover rate. No account-level blended number, and no re-quoting every turnover.",
  },
  {
    key: "photos",
    title: "Photo documentation on every turnover",
    body: "Every visit is documented against the turnover checklist, so you can see the property as we left it before your next guest arrives.",
  },
  {
    key: "reclean",
    title: "24-hour reclean window",
    body: "Section 9 — if something covered is missed, tell us within 24 hours and we come back and correct it at no additional charge.",
  },
  {
    key: "self_serve",
    title: "Book, cancel, and reschedule yourself",
    body: "Your host portal handles turnovers, payment history, and documents. No phone tag to change a date.",
  },
] as const;

export const ENTITY_QUESTION = "Are you signing as an individual or a business entity?";

export const ENTITY_CHOICES: Array<{ value: EntityType; label: string; hint: string }> = [
  {
    value: "individual",
    label: "An individual",
    hint: "You are signing personally, in your own name.",
  },
  {
    value: "entity",
    label: "A business entity",
    hint: "An LLC, corporation, or partnership signs. A personal guarantee is part of signing.",
  },
];

/**
 * Why the entity question can't be skipped: it decides whether the Personal
 * Guarantee block is presented at signature. Guessing it either shows a
 * legally irrelevant form to an individual host or loses a required
 * guarantee signature for an entity host.
 */
export const ENTITY_QUESTION_REQUIRED_MESSAGE =
  "Select whether you're signing as an individual or a business entity — this " +
  "determines what you're asked to sign.";

/**
 * "incomplete" means the visitor simply hasn't finished typing — it is NOT a
 * verdict. Keeping it distinct stops a half-entered property from flashing
 * "Book a Call" at someone whose property is perfectly typical.
 */
export type StrCta = "claim" | "book_call" | "incomplete";

export interface StrPropertyInput {
  nickname?: string | null;
  address: string;
  bedrooms: number | null;
  bathrooms: number | null;
  linen?: boolean;
  restock?: boolean;
  /** The host told us the property is non-standard. Same flag the registry honors. */
  flaggedNonStandard?: boolean;
}

export interface StrPropertyEstimate {
  index: number;
  label: string;
  address: string;
  bedrooms: number | null;
  bathrooms: number | null;
  linen: boolean;
  restock: boolean;
  quote: PropertyQuote;
}

export interface StrEstimateResult {
  ok: boolean;
  cta: StrCta;
  estimate: true;
  disclaimer: string;
  companySetsRates: string;
  introDisclosure: string | null;
  propertyCount: number;
  properties: StrPropertyEstimate[];
  /** Sum of the quotable properties' standard rates, per turnover of each. */
  totalPerTurnover: number | null;
  lockHours: number;
  reasons: Array<{ reason: string; message: string }>;
}

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseStrProperties(raw: unknown): StrPropertyInput[] {
  const rows = Array.isArray(raw) ? raw : [];
  // One over the cap, so "too many" is detected rather than silently trimmed.
  return rows.slice(0, MAX_SELF_SERVE_PROPERTIES + 1).map((row) => {
    const p = (row || {}) as Record<string, unknown>;
    return {
      nickname: clip(p.nickname, 80) || null,
      address: clip(p.address, 300),
      bedrooms: numOrNull(p.bedrooms),
      bathrooms: numOrNull(p.bathrooms),
      linen: p.linen === true,
      restock: p.restock === true,
      flaggedNonStandard: p.flaggedNonStandard === true,
    };
  });
}

/**
 * Typical properties claim; unusual ones book a call. "Unusual" is Part
 * Two's own boundary (5+ BR is a quote, not a band) plus an unusually large
 * property count — not a cutoff invented for this page.
 */
export function estimateStr(
  properties: StrPropertyInput[],
  introDisclosureText: string | null = null,
): StrEstimateResult {
  const reasons: StrEstimateResult["reasons"] = [];
  const seen = new Set<string>();

  const estimates: StrPropertyEstimate[] = properties.map((p, i) => {
    const quote = quoteProperty({
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      linen: p.linen,
      restock: p.restock,
    });
    if (p.flaggedNonStandard && !seen.has("flagged_non_standard")) {
      seen.add("flagged_non_standard");
      reasons.push({
        reason: "flagged_non_standard",
        message:
          "You flagged a property as non-standard, so a person prices it rather than " +
          "the calculator.",
      });
    }
    if (!quote.quotable && quote.reason && quote.reason !== "missing_bedrooms") {
      if (!seen.has(quote.reason)) {
        seen.add(quote.reason);
        reasons.push({ reason: quote.reason, message: quote.message || "This property needs review." });
      }
    }
    return {
      index: i,
      label: p.nickname || p.address || `Property ${i + 1}`,
      address: p.address,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      linen: !!p.linen,
      restock: !!p.restock,
      quote,
    };
  });

  if (properties.length > MAX_SELF_SERVE_PROPERTIES) {
    reasons.push({ reason: "too_many_properties", message: TOO_MANY_PROPERTIES_MESSAGE });
  }

  const complete = estimates.filter((e) => e.quote.reason !== "missing_bedrooms");
  const anyIncomplete = estimates.length === 0 || estimates.some((e) => e.quote.reason === "missing_bedrooms");
  const anyFlagged = properties.some((p) => p.flaggedNonStandard);
  const tooMany = properties.length > MAX_SELF_SERVE_PROPERTIES;

  // An unusual property is a verdict and wins even while another row is still
  // being typed; otherwise an unfinished row just means "not ready yet".
  const anyUnusual = anyFlagged || tooMany || complete.some((e) => !e.quote.quotable);
  const cta: StrCta = anyUnusual ? "book_call" : anyIncomplete ? "incomplete" : "claim";

  const total =
    cta === "claim" ? complete.reduce((sum, e) => sum + (e.quote.standardRate || 0), 0) : null;

  return {
    ok: cta === "claim",
    cta,
    estimate: true,
    disclaimer: ESTIMATE_DISCLAIMER,
    companySetsRates:
      "Rates are set by Novara from the Part Two reference bands. You confirm the " +
      "schedule when you sign; you do not set or negotiate a rate here.",
    introDisclosure: introDisclosureText,
    propertyCount: properties.length,
    properties: estimates,
    totalPerTurnover: total,
    lockHours: STR_QUOTE_LOCK_HOURS,
    reasons,
  };
}

// ─── Claim contact (name, email, phone, entity type) ───────────────────────

export interface StrClaimContact {
  fullName: string;
  email: string;
  phone: string;
  entityType: EntityType | null;
  entityName: string | null;
}

export function parseClaimContact(body: Record<string, unknown>): StrClaimContact {
  const raw = clip(body.entityType, 20);
  return {
    fullName: clip(body.fullName ?? body.name, 120),
    email: clip(body.email, 200).toLowerCase(),
    phone: clip(body.phone, 40),
    entityType: raw === "individual" || raw === "entity" ? (raw as EntityType) : null,
    entityName: clip(body.entityName, 160) || null,
  };
}

/**
 * Validated identically on the page and on the server. The entity branch is
 * enforced here, not just hidden in the UI.
 */
export function claimContactError(c: StrClaimContact): string | null {
  if (c.fullName.length < 2) return "Enter your full name.";
  if (!/.+@.+\..+/.test(c.email)) return "Enter a valid email address.";
  if (c.phone.replace(/\D/g, "").length < 10) return "Enter a valid phone number.";
  if (c.entityType !== "individual" && c.entityType !== "entity") {
    return ENTITY_QUESTION_REQUIRED_MESSAGE;
  }
  if (c.entityType === "entity" && !c.entityName) {
    return "Enter the business entity's legal name.";
  }
  return null;
}

// Defined in the Agreement module (the host-onboarding domain owns it); the
// landing re-exports so the page and the claim API share one definition.
export { requiresPersonalGuarantee } from "@/lib/host-onboarding/agreement";
