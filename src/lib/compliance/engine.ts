// Behavior for booking-portal compliance. No I/O. Callers persist the records
// this module describes.

import {
  SEEDED_WORDING,
  wordingByKind,
  type WordingKind,
  type WordingStatus,
  type WordingVersion,
} from "./wording";

export type AcceptanceKind = Exclude<WordingKind, "cookie_banner" | "privacy_summary">;

export type Surface =
  | "residential_checkout"
  | "residential_signature"
  | "pay_page"
  | "membership_pay"
  | "membership_offer"
  | "host_signup"
  | "host_sign"
  | "property_manager_sign"
  | "commercial_sign"
  | "str_claim";

export type Relationship = "residential" | "str_host" | "property_manager" | "commercial";

export interface ChargeContext {
  dueNowLabel: string;
  dueNowWhen: string;
  balanceLabel?: string | null;
  balanceWhen?: string | null;
  amountBasis: string;
  savedFor: string;
}

export interface MembershipContext {
  pricePerVisit: string;
  frequency: string;
  firstChargeLabel: string;
  firstChargeWhen: string;
  nextChargeWhen: string;
}

export interface AcceptanceContext {
  relationship: Relationship;
  propertyLabel?: string | null;
  phone?: string | null;
  textsRequired?: boolean;
  includeCard?: boolean;
  includeMembership?: boolean;
  /** When false, the signature step must collect policies that checkout did not. */
  policiesAlreadyAccepted?: boolean;
  charge?: ChargeContext | null;
  membership?: MembershipContext | null;
}

export interface RenderedAcceptance {
  kind: AcceptanceKind;
  required: boolean;
  title: string;
  wordingShown: string;
  versionId: string;
  version: number;
  status: WordingStatus;
  feedsDispute: boolean;
  links: Array<{ label: string; href: string }>;
}

export interface AcceptanceRecord {
  id: string;
  kind: AcceptanceKind;
  action: "accepted" | "withdrawn";
  wordingVersionId: string;
  wordingVersion: number;
  wordingStatus: WordingStatus;
  wordingShown: string;
  acceptedAt: string;
  timeZone: string;
  deviceTimeZone: string | null;
  ip: string;
  userAgent: string;
  personName: string | null;
  email: string | null;
  phone: string | null;
  bookingId: string | null;
  agreementId: string | null;
  chargeId: string | null;
  relationship: string | null;
  propertyLabel: string | null;
  amountBasis: string | null;
  surface: Surface;
}

/** Terms, policies, card authorization, and signature-related acceptances. */
const DISPUTE_KINDS = new Set<AcceptanceKind>([
  "terms",
  "refund_policy",
  "cancellation_policy",
  "card_authorization",
  "membership_terms",
  "service_agreement",
  "disclaimer",
  "electronic_consent",
]);

const OPTIONAL_KINDS = new Set<AcceptanceKind>(["sms_service", "sms_promo", "email_marketing"]);

export function feedsDispute(kind: AcceptanceKind): boolean {
  return DISPUTE_KINDS.has(kind);
}

function authoritySentence(relationship: Relationship): string {
  switch (relationship) {
    case "str_host":
      return "I am the host, or I have permission from the owner, to authorize entry and cleaning of this property.";
    case "property_manager":
      return "I am booking for the owner or resident, and I have permission to authorize entry and cleaning of this property or unit.";
    case "commercial":
      return "I am authorized to sign for this business and to authorize entry and cleaning of this site.";
    default:
      return "I am the owner of this home, or I have permission to authorize entry and cleaning of this property.";
  }
}

export interface WordingTokens {
  [key: string]: string;
}

export function tokensFor(ctx: AcceptanceContext): WordingTokens {
  const charge = ctx.charge;
  const balanceSentence = charge?.balanceLabel
    ? `A later charge of ${charge.balanceLabel} is scheduled ${charge.balanceWhen || "after the cleaning"}.`
    : "No later balance is scheduled from this step.";
  const membership = ctx.membership;
  return {
    dueNowLabel: charge?.dueNowLabel || "the amount shown on this page",
    dueNowWhen: charge?.dueNowWhen || "when I submit payment",
    balanceSentence,
    amountBasis: charge?.amountBasis || "the price shown on this page for this service and home",
    savedFor: charge?.savedFor || "to collect the balance for this booking and future visits I book",
    pricePerVisit: membership?.pricePerVisit || "the price per visit shown",
    frequency: membership?.frequency || "the billing frequency shown",
    firstChargeLabel: membership?.firstChargeLabel || "the first amount shown",
    firstChargeWhen: membership?.firstChargeWhen || "when I start the plan",
    nextChargeWhen: membership?.nextChargeWhen || "on the next billing date shown",
    phone: ctx.phone?.trim() || "the mobile number I provided",
    property: ctx.propertyLabel?.trim() || "the property on this booking",
    authoritySentence: authoritySentence(ctx.relationship),
    textsRequiredSentence: ctx.textsRequired
      ? " Texts are used to coordinate this service. If I leave this box unchecked, Novara Cleaning will use email instead wherever it can."
      : "",
  };
}

export function fillTemplate(body: string, tokens: WordingTokens): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => tokens[key] ?? "");
}

export function extractLinks(text: string): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    links.push({ label: match[1], href: match[2] });
  }
  return links;
}

/** Customer-facing text with the markdown links left in place for the renderer. */
export function plainWording(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)");
}

const SURFACE_KINDS: Record<Surface, AcceptanceKind[]> = {
  residential_checkout: [
    "terms",
    "refund_policy",
    "cancellation_policy",
    "disclaimer",
    "card_authorization",
    "authority_to_book",
    "photos_recordings",
    "sms_service",
    "sms_promo",
    "email_marketing",
  ],
  residential_signature: ["electronic_consent"],
  pay_page: [
    "service_agreement",
    "terms",
    "refund_policy",
    "cancellation_policy",
    "disclaimer",
    "card_authorization",
    "authority_to_book",
    "photos_recordings",
    "electronic_consent",
    "sms_service",
    "sms_promo",
    "email_marketing",
  ],
  membership_pay: [
    "membership_terms",
    "terms",
    "refund_policy",
    "cancellation_policy",
    "disclaimer",
    "card_authorization",
    "authority_to_book",
    "photos_recordings",
    "electronic_consent",
    "sms_service",
    "sms_promo",
    "email_marketing",
  ],
  membership_offer: ["membership_terms"],
  host_signup: ["terms", "authority_to_book", "electronic_consent", "sms_service", "email_marketing"],
  host_sign: ["card_authorization", "authority_to_book", "electronic_consent", "sms_service", "email_marketing"],
  property_manager_sign: ["card_authorization", "authority_to_book", "electronic_consent", "sms_service", "email_marketing"],
  commercial_sign: ["card_authorization", "authority_to_book", "electronic_consent", "sms_service", "email_marketing"],
  str_claim: ["terms", "authority_to_book", "electronic_consent", "sms_service", "email_marketing"],
};

function requiredOnSurface(kind: AcceptanceKind, ctx: AcceptanceContext, surface: Surface): boolean {
  if (OPTIONAL_KINDS.has(kind)) {
    return false;
  }
  if (kind === "card_authorization" && ctx.includeCard === false) return false;
  if (kind === "membership_terms") return ctx.includeMembership !== false;
  if (surface === "residential_signature" && kind !== "electronic_consent") {
    return ctx.policiesAlreadyAccepted !== true;
  }
  return true;
}

export function acceptancesForSurface(
  surface: Surface,
  ctx: AcceptanceContext,
  versions: WordingVersion[] = SEEDED_WORDING,
): RenderedAcceptance[] {
  const tokens = tokensFor(ctx);
  const kinds = [...SURFACE_KINDS[surface]];
  if (surface === "residential_checkout" && ctx.includeMembership) {
    kinds.splice(4, 0, "membership_terms");
  }
  if (surface === "residential_signature" && ctx.policiesAlreadyAccepted !== true) {
    const extra: AcceptanceKind[] = [
      "terms",
      "refund_policy",
      "cancellation_policy",
      "disclaimer",
      "service_agreement",
      "card_authorization",
      "authority_to_book",
      "photos_recordings",
      "sms_service",
      "sms_promo",
      "email_marketing",
    ];
    if (ctx.includeMembership) extra.splice(4, 0, "membership_terms");
    kinds.unshift(...extra);
  }
  const seen = new Set<AcceptanceKind>();
  const items: RenderedAcceptance[] = [];
  for (const kind of kinds) {
    if (seen.has(kind)) continue;
    if (kind === "card_authorization" && ctx.includeCard === false) continue;
    seen.add(kind);
    const wording = wordingByKind(versions, kind);
    if (!wording) continue;
    const wordingShown = fillTemplate(wording.body, tokens).replace(/\s+\./g, ".").trim();
    items.push({
      kind,
      required: requiredOnSurface(kind, ctx, surface),
      title: wording.title,
      wordingShown,
      versionId: wording.id,
      version: wording.version,
      status: wording.status,
      feedsDispute: feedsDispute(kind),
      links: extractLinks(wordingShown),
    });
  }
  return items;
}

export function acceptanceGate(
  items: RenderedAcceptance[],
  checked: Partial<Record<AcceptanceKind, boolean>>,
): { ready: boolean; missing: AcceptanceKind[] } {
  const missing = items.filter((item) => item.required && checked[item.kind] !== true).map((item) => item.kind);
  return { ready: missing.length === 0, missing };
}

export function legacyAgreementFlags(checked: Partial<Record<AcceptanceKind, boolean>>): {
  terms: boolean;
  disclaimer: boolean;
  refund: boolean;
  serviceAgreement: boolean;
} {
  return {
    terms: checked.terms === true,
    disclaimer: checked.disclaimer === true,
    refund: checked.refund_policy === true,
    serviceAgreement: checked.service_agreement === true || checked.membership_terms === true,
  };
}

export interface NewAcceptanceInput {
  item: RenderedAcceptance;
  surface: Surface;
  acceptedAt: string;
  timeZone: string;
  deviceTimeZone?: string | null;
  ip: string;
  userAgent: string;
  personName?: string | null;
  email?: string | null;
  phone?: string | null;
  bookingId?: string | null;
  agreementId?: string | null;
  chargeId?: string | null;
  relationship?: string | null;
  propertyLabel?: string | null;
  amountBasis?: string | null;
  action?: "accepted" | "withdrawn";
}

export function buildAcceptanceRecord(input: NewAcceptanceInput, id: string): AcceptanceRecord {
  return {
    id,
    kind: input.item.kind,
    action: input.action || "accepted",
    wordingVersionId: input.item.versionId,
    wordingVersion: input.item.version,
    wordingStatus: input.item.status,
    wordingShown: input.item.wordingShown,
    acceptedAt: input.acceptedAt,
    timeZone: input.timeZone,
    deviceTimeZone: input.deviceTimeZone ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
    personName: input.personName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    bookingId: input.bookingId ?? null,
    agreementId: input.agreementId ?? null,
    chargeId: input.chargeId ?? null,
    relationship: input.relationship ?? null,
    propertyLabel: input.propertyLabel ?? null,
    amountBasis: input.item.kind === "card_authorization" ? input.amountBasis ?? null : input.amountBasis ?? null,
    surface: input.surface,
  };
}

export function disputeAcknowledgments(records: AcceptanceRecord[]): Array<{ label: string; accepted: boolean }> {
  return records
    .filter((row) => row.action === "accepted" && feedsDispute(row.kind))
    .map((row) => ({
      label: `${row.kind} ${row.wordingVersionId}: ${plainWording(row.wordingShown)}`,
      accepted: true,
    }));
}

export function policySnapshotFrom(records: AcceptanceRecord[]): {
  effectiveOn: string;
  acceptedVersionRecorded: boolean;
  clauses: Array<{ text: string; cite: string }>;
} | null {
  const rows = records.filter(
    (row) =>
      row.action === "accepted" &&
      (row.kind === "refund_policy" || row.kind === "cancellation_policy" || row.kind === "terms"),
  );
  if (!rows.length) return null;
  return {
    effectiveOn: rows[0].acceptedAt.slice(0, 10),
    acceptedVersionRecorded: true,
    clauses: rows.map((row) => ({
      text: plainWording(row.wordingShown),
      cite: row.wordingVersionId,
    })),
  };
}

export function liveDraftAcceptances(records: AcceptanceRecord[]): AcceptanceRecord[] {
  return records.filter((row) => row.action === "accepted" && row.wordingStatus === "draft");
}

export function phoneDigits(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCELSMS", "END", "QUIT"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export function smsKeyword(message: string | null | undefined): "stop" | "help" | "start" | null {
  const token = String(message || "").trim().toUpperCase();
  if (STOP_WORDS.has(token)) return "stop";
  if (HELP_WORDS.has(token)) return "help";
  if (token === "START" || token === "UNSTOP") return "start";
  return null;
}

export const SMS_HELP_REPLY =
  "Novara Cleaning: Help is available at hello@novaracleaning.com or (844) 735-2070. Reply STOP to opt out of texts.";

export const SMS_STOP_REPLY =
  "Novara Cleaning: You have been opted out of texts. Reply START to opt back in. Help? Call (844) 735-2070.";

export interface PriceLine {
  label: string;
  amount: number;
  kind: "base" | "addon" | "fee" | "discount" | "tax" | "due_now" | "due_later";
}

export interface PriceBreakdownInput {
  base: number;
  addOns?: number;
  sameDayFee?: number;
  discounts?: number;
  taxRate?: number;
  taxApplies?: boolean;
  dueNow: number;
  dueLater?: number;
  dueLaterWhen?: string | null;
}

export function buildPriceBreakdown(input: PriceBreakdownInput): {
  lines: PriceLine[];
  total: number;
  dueNow: number;
  dueLater: number;
  dueLaterWhen: string | null;
  tax: number;
} {
  const base = roundMoney(input.base);
  const addOns = roundMoney(input.addOns || 0);
  const sameDayFee = roundMoney(input.sameDayFee || 0);
  const discounts = roundMoney(input.discounts || 0);
  const beforeTax = roundMoney(base + addOns + sameDayFee - discounts);
  const tax = input.taxApplies && (input.taxRate || 0) > 0
    ? roundMoney(beforeTax * (input.taxRate || 0))
    : 0;
  const total = roundMoney(beforeTax + tax);
  const lines: PriceLine[] = [
    { label: "Base price", amount: base, kind: "base" },
  ];
  if (addOns) lines.push({ label: "Add-ons", amount: addOns, kind: "addon" });
  if (sameDayFee) lines.push({ label: "Same-day fee", amount: sameDayFee, kind: "fee" });
  if (discounts) lines.push({ label: "Discounts", amount: -Math.abs(discounts), kind: "discount" });
  if (tax) lines.push({ label: "Tax", amount: tax, kind: "tax" });
  lines.push({ label: "Due now", amount: roundMoney(input.dueNow), kind: "due_now" });
  const dueLater = roundMoney(input.dueLater || 0);
  if (dueLater) {
    lines.push({
      label: input.dueLaterWhen ? `Balance due ${input.dueLaterWhen}` : "Balance due later",
      amount: dueLater,
      kind: "due_later",
    });
  }
  return {
    lines,
    total,
    dueNow: roundMoney(input.dueNow),
    dueLater,
    dueLaterWhen: input.dueLaterWhen || null,
    tax,
  };
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * A strikethrough price is allowed only when both numbers come from the
 * pricing rules for this service and home, and the list price is the real
 * regular price those rules charge when the discount does not apply.
 */
export function strikethroughPrice(input: {
  listPrice: number;
  finalPrice: number;
  source: "pricing_rules" | "manual";
}): { show: boolean; listPrice: number; finalPrice: number; percent: number | null } {
  const listPrice = roundMoney(input.listPrice);
  const finalPrice = roundMoney(input.finalPrice);
  if (input.source !== "pricing_rules" || !(listPrice > 0) || !(finalPrice > 0) || finalPrice >= listPrice) {
    return { show: false, listPrice, finalPrice, percent: null };
  }
  return {
    show: true,
    listPrice,
    finalPrice,
    percent: Math.round((1 - finalPrice / listPrice) * 100),
  };
}

export function savingsPercentFromRules(listPrice: number, finalPrice: number): number | null {
  return strikethroughPrice({ listPrice, finalPrice, source: "pricing_rules" }).percent;
}

export interface UrgencyConfig {
  label: string;
  capacityRemaining?: number | null;
  endsAt?: string | null;
}

export function urgencyVisible(config: UrgencyConfig | null | undefined, now: Date): boolean {
  if (!config) return false;
  const hasCapacity = typeof config.capacityRemaining === "number";
  const hasEnd = Boolean(config.endsAt);
  if (!hasCapacity && !hasEnd) return false;
  if (hasCapacity && (config.capacityRemaining as number) <= 0) return false;
  if (hasEnd && new Date(String(config.endsAt)).getTime() <= now.getTime()) return false;
  return true;
}

export interface CookieChoice {
  id: string;
  essential: true;
  analytics: boolean;
  advertising: boolean;
  gpc: boolean;
  source: "accept" | "decline" | "custom" | "gpc";
  bannerVersion: string;
  chosenAt: string;
  timeZone: string;
}

export function cookieChoice(input: {
  id: string;
  analytics: boolean;
  advertising: boolean;
  gpc?: boolean;
  source: CookieChoice["source"];
  bannerVersion: string;
  chosenAt: string;
  timeZone?: string;
}): CookieChoice {
  const gpc = input.gpc === true;
  const declinedByGpc = gpc && input.source !== "accept" && input.source !== "custom";
  return {
    id: input.id,
    essential: true,
    analytics: declinedByGpc ? false : input.analytics === true,
    advertising: declinedByGpc ? false : input.advertising === true,
    gpc,
    source: declinedByGpc ? "gpc" : input.source,
    bannerVersion: input.bannerVersion,
    chosenAt: input.chosenAt,
    timeZone: input.timeZone || "UTC",
  };
}

export function trackersAllowed(choice: { analytics: boolean; advertising: boolean } | null): { analytics: boolean; advertising: boolean } {
  if (!choice) return { analytics: false, advertising: false };
  return {
    analytics: choice.analytics === true,
    advertising: choice.advertising === true,
  };
}

const TRACKING_EVENTS = new Set(["booking_started", "booking_completed", "PageView"]);

export function sanitizeTrackingEvent(
  event: string,
  params: Record<string, unknown> | undefined,
): { event: string; params: Record<string, unknown>; blocked: boolean } {
  const blob = JSON.stringify(params || {});
  const personal = /gate\s*code|alarm|lockbox|@[a-z0-9.-]+\.[a-z]{2,}|\b\d{1,6}\s+[A-Za-z0-9.'-]+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct)\b/i.test(blob);
  if (personal) return { event: "booking_started", params: {}, blocked: true };
  const safe: Record<string, unknown> = {};
  if (typeof params?.value === "number" && Number.isFinite(params.value)) safe.value = params.value;
  if (params?.currency === "USD") safe.currency = "USD";
  return {
    event: TRACKING_EVENTS.has(event) ? event : "booking_started",
    params: safe,
    blocked: false,
  };
}

const ACCESS_LINE = /\b((?:gate|alarm|door|lockbox|keypad|entry|access|garage)\s*(?:code|pin)?|key\s*location|hide-?a-?key)\b[^.\n]{0,80}/gi;

export function textHasAccessSecret(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b(gate|alarm|lockbox|keypad)\b|\bcode\s*[:#-]?\s*[A-Za-z0-9]{3,}|\bkey\s*location\b|\bACCESS:/i.test(text);
}

export function redactAccessText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(ACCESS_LINE, (match) => {
      const label = match.match(/^(gate|alarm|door|lockbox|keypad|entry|access|garage|key\s*location|hide-?a-?key)/i);
      return `${label ? label[0] : "Access"} [removed]`;
    })
    .replace(/\bcode\s*[:#-]?\s*[A-Za-z0-9#*]{3,}/gi, "code [removed]");
}

export function accessReveal(input: {
  notes: string | null;
  serviceDate: string | null;
  now: number;
  retentionDays: number;
  openDispute: boolean;
  role: "cleaner" | "admin";
}): { text: string | null; masked: boolean; reason: string } {
  const notes = input.notes?.trim() || "";
  if (!notes) return { text: null, masked: false, reason: "none" };
  const sensitive = textHasAccessSecret(notes);
  if (!sensitive && input.role === "admin" && !input.openDispute) {
    return { text: notes, masked: false, reason: "not_sensitive" };
  }
  if (input.openDispute && input.role === "admin") {
    return { text: notes, masked: false, reason: "open_dispute" };
  }
  const day = input.serviceDate ? Date.parse(`${input.serviceDate.slice(0, 10)}T12:00:00`) : NaN;
  if (!Number.isFinite(day)) {
    if (input.role === "admin") return { text: notes, masked: false, reason: "admin_no_date" };
    return { text: "Access details unlock 48 hours before the visit.", masked: true, reason: "too_early" };
  }
  const retentionMs = Math.max(1, input.retentionDays) * 86400000;
  if (input.now > day + retentionMs) {
    return { text: "Access details were removed after the retention period.", masked: true, reason: "retained" };
  }
  const unlockAt = day - 48 * 3600_000;
  const cleanerRelock = day + 48 * 3600_000;
  if (input.role === "cleaner") {
    if (input.now < unlockAt || input.now > cleanerRelock) {
      return {
        text: input.now < unlockAt
          ? "Access details unlock 48 hours before the visit."
          : "Access details were hidden after the visit.",
        masked: true,
        reason: input.now < unlockAt ? "too_early" : "after_visit",
      };
    }
  }
  return { text: notes, masked: false, reason: "window" };
}

export function cancellationConfirmation(input: {
  now: Date;
  nextServiceDate?: string | null;
  unpaidBalanceCents?: number | null;
}): { effectiveOn: string; finalChargeCents: number; subject: string; text: string } {
  const effectiveOn = input.now.toISOString().slice(0, 10);
  const finalChargeCents = Math.max(0, Math.round(input.unpaidBalanceCents || 0));
  const visit = input.nextServiceDate
    ? ` The visit already on the calendar for ${input.nextServiceDate} is the last one unless you skip it.`
    : " No further visits will be scheduled.";
  const charge = finalChargeCents > 0
    ? ` A final charge of $${(finalChargeCents / 100).toFixed(2)} is still due.`
    : " There is no further automatic charge.";
  const text =
    `Your Novara Cleaning membership is canceled effective ${effectiveOn}.` +
    visit +
    charge +
    " You can book a one-time clean whenever you want.";
  return {
    effectiveOn,
    finalChargeCents,
    subject: "Your Novara Cleaning membership is canceled",
    text,
  };
}

export function priceChangeMayApply(input: {
  noticeDays: number;
  notifiedAt: string | null;
  effectiveAt: string;
  now: string;
}): { allowed: boolean; reason: string } {
  if (!input.noticeDays || input.noticeDays <= 0) {
    return {
      allowed: false,
      reason: "The auto-renewal notice period is not configured. Flagged for counsel before a price change can take effect.",
    };
  }
  if (!input.notifiedAt) {
    return { allowed: false, reason: "The customer has not been emailed about this price change." };
  }
  const notified = Date.parse(input.notifiedAt);
  const effective = Date.parse(input.effectiveAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(notified) || !Number.isFinite(effective)) {
    return { allowed: false, reason: "The notice dates are incomplete." };
  }
  const neededMs = input.noticeDays * 86400000;
  if (effective - notified < neededMs) {
    return { allowed: false, reason: `Notice must be at least ${input.noticeDays} days before the new price.` };
  }
  if (Number.isFinite(now) && now < effective) {
    return { allowed: false, reason: "The new price is not effective yet." };
  }
  return { allowed: true, reason: "The notice window has passed." };
}

export interface ComplianceSettings {
  salesTaxEnabled: boolean;
  salesTaxRate: number;
  salesTaxLabel: string;
  salesTaxByService: Array<{ serviceType: string; jurisdiction: string; applies: boolean; rate: number }>;
  autoRenewalNoticeDays: { MD: number; VA: number; DC: number };
  autoRenewalReminderDays: number;
  autoRenewalCounselFlag: boolean;
  licenseLine: string;
  accessRetentionDays: number;
  dataRequestDueDays: number;
  breachContacts: Array<{ name: string; email: string; role: string }>;
  breachProcedure: string;
  urgency: UrgencyConfig | null;
}

export const DEFAULT_SETTINGS: ComplianceSettings = {
  salesTaxEnabled: false,
  salesTaxRate: 0,
  salesTaxLabel: "",
  salesTaxByService: [
    { serviceType: "residential", jurisdiction: "MD", applies: false, rate: 0 },
    { serviceType: "residential", jurisdiction: "VA", applies: false, rate: 0 },
    { serviceType: "residential", jurisdiction: "DC", applies: false, rate: 0 },
    { serviceType: "commercial", jurisdiction: "MD", applies: false, rate: 0 },
    { serviceType: "commercial", jurisdiction: "VA", applies: false, rate: 0 },
    { serviceType: "commercial", jurisdiction: "DC", applies: false, rate: 0 },
  ],
  autoRenewalNoticeDays: { MD: 0, VA: 0, DC: 0 },
  autoRenewalReminderDays: 0,
  autoRenewalCounselFlag: true,
  licenseLine: "",
  accessRetentionDays: 14,
  dataRequestDueDays: 45,
  breachContacts: [],
  breachProcedure:
    "When a breach is suspected, the owner notifies the contacts on this list, preserves the affected records, and uses the portal list of affected people and data categories. Do not email access codes while investigating. This procedure is a draft until counsel reviews it.",
  urgency: null,
};

export function taxFor(settings: ComplianceSettings, serviceType: string, jurisdiction: string): {
  applies: boolean;
  rate: number;
  label: string;
} {
  if (!settings.salesTaxEnabled) return { applies: false, rate: 0, label: "" };
  const row = settings.salesTaxByService.find(
    (item) => item.serviceType === serviceType && item.jurisdiction === jurisdiction && item.applies,
  );
  if (!row || row.rate <= 0) return { applies: false, rate: 0, label: settings.salesTaxLabel };
  return { applies: true, rate: row.rate, label: settings.salesTaxLabel || "Tax" };
}

export interface ApprovedClaim {
  id: string;
  text: string;
  scope: "company" | "people_sent";
  live: boolean;
  counselNote?: string;
}

export const APPROVED_CLAIMS: ApprovedClaim[] = [
  { id: "insured", text: "Insured", scope: "company", live: true },
  {
    id: "background_checked_sent",
    text: "Cleaners we send are background-checked",
    scope: "people_sent",
    live: true,
  },
  {
    id: "google_guaranteed",
    text: "Google Guaranteed",
    scope: "company",
    live: true,
    counselNote: "Confirm the Google Guaranteed badge is still active.",
  },
  {
    id: "reclean",
    text: "48-hour re-clean if you are not satisfied",
    scope: "company",
    live: true,
  },
];

export function claimIsApproved(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return APPROVED_CLAIMS.some((claim) => claim.live && claim.text.toLowerCase() === normalized);
}

export interface DataRequest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  kind: "access" | "correct" | "delete";
  details: string;
  status: "open" | "in_progress" | "done";
  dueOn: string;
  retainedBecause: string | null;
  log: Array<{ at: string; action: string; note: string }>;
  createdAt: string;
}

export function openDataRequest(input: {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  kind: DataRequest["kind"];
  details: string;
  now: Date;
  dueDays: number;
}): DataRequest {
  const due = new Date(input.now.getTime());
  due.setUTCDate(due.getUTCDate() + Math.max(1, input.dueDays));
  const at = input.now.toISOString();
  return {
    id: input.id,
    name: input.name.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim() || null,
    kind: input.kind,
    details: input.details.trim(),
    status: "open",
    dueOn: due.toISOString().slice(0, 10),
    retainedBecause: null,
    log: [{ at, action: "opened", note: "Request received." }],
    createdAt: at,
  };
}

export function appendDataRequestLog(
  request: DataRequest,
  entry: { at: string; action: string; note: string; status?: DataRequest["status"]; retainedBecause?: string | null },
): DataRequest {
  return {
    ...request,
    status: entry.status || request.status,
    retainedBecause: entry.retainedBecause === undefined ? request.retainedBecause : entry.retainedBecause,
    log: [...request.log, { at: entry.at, action: entry.action, note: entry.note }],
  };
}

export interface AuditFinding {
  area: string;
  found: string;
  gap: string;
  fix: string;
}

export const AUDIT_FINDINGS: AuditFinding[] = [
  {
    area: "Acceptances",
    found: "Checkout said “by paying you agree” with no checkbox. The details page then stored terms, disclaimer, refund, and the service agreement as all true on one signature. The pay page had three boxes, but terms and the refund policy shared one box, and refund was stored as true by default. Host signup used one bundled agreement checkbox. Nothing stored the exact wording version.",
    gap: "Bundled and implied consent, no wording snapshot, marketing not separated.",
    fix: "Each acceptance is its own unchecked box. The wording version, time, IP, and device are stored and cannot be edited.",
  },
  {
    area: "Text messages",
    found: "STOP and HELP are handled on inbound texts. Opt-out updated a cleaner record and failed when the number was not a cleaner. Booking pages did not ask for text consent. Promotional and service texts were not separate.",
    gap: "Customer STOP did not always suppress the number. No booking consent record.",
    fix: "Service and promotional consent are separate optional boxes. STOP suppresses the number immediately and writes a withdrawal.",
  },
  {
    area: "Cards and memberships",
    found: "Deposits, pay-after balances, and memberships save a card in Stripe. The only authorization text was the bundled pay line. Memberships said “cancel anytime” on checkout. The manage link could pause, skip, and change dates. It could not cancel or open the card page.",
    gap: "No express card authorization. Cancellation was not as easy as signup.",
    fix: "Card authorization states the amount basis, timing, and how to cancel. Membership terms sit beside the start button. Cancel and change-card are on the membership page, and cancellation emails a confirmation.",
  },
  {
    area: "Prices and claims",
    found: "Checkout showed a service total, same-day fee, amount due now, and balance. It did not itemize base, add-ons, discounts, and tax. The offer page said “25% off” and “save 34%” as typed copy. Pricing rules are 15% off standard, 25% off deep, and half off the standard portion of a combo. “Insured & bonded” was shown. No “limited spots” element was configured.",
    gap: "Typed discounts and an unapproved “bonded” claim.",
    fix: "Strikethrough, savings, and offer copy come from the pricing rules. Urgency renders only while a real capacity or end date is true. Claims use the approved list.",
  },
  {
    area: "Tracking",
    found: "Every page loaded Google Ads (AW-17623293005) and the Meta pixel (1641726577181415), including a noscript pixel, before any choice. The pixel helpers could send a ZIP code. No session-replay or heatmap tool is installed. UTM capture is first-party.",
    gap: "Advertising tags loaded without consent and could receive extra fields.",
    fix: "Optional tags stay unloaded until that category is accepted. Global Privacy Control is a decline. Events are booking started or booking completed, plus amount, with no name, address, or access details.",
  },
  {
    area: "Access details",
    found: "Gate codes and access notes are stored in plain text on the booking and on property-manager units. The cleaner portal already hid notes that contained “ACCESS:” or “code:” outside a 48-hour window. Other notes stayed visible. Calendar sync copied access notes into the appointment description. Dispute packets copy message text as written.",
    gap: "Codes could leave the portal in calendar notes, texts, and dispute files, and views were not logged.",
    fix: "Sensitive notes are time-scoped, removed after the retention period unless a dispute is open, stripped from texts, calendar notes, and dispute packets, and every reveal is logged.",
  },
  {
    area: "Privacy and accessibility",
    found: "Footers link to novaracleaning.com/privacy and /terms. Those pages are not in this app, so they cannot be checked against Stripe, messaging, or ad platforms. There was no request queue. Several errors were a single toast. The signature pad had no keyboard alternative.",
    gap: "Policy text may not match the system. No data-request log. Signature blocked keyboard-only booking.",
    fix: "A draft privacy summary is stored for counsel. Requests enter a queue with a due date and a log. Errors name the field. A typed signature is available.",
  },
];

export const ACCESSIBILITY_PLAN: Array<{ item: string; status: "fixed" | "remaining"; note: string }> = [
  { item: "Checkbox labels", status: "fixed", note: "Each acceptance label is the full wording, tied to the checkbox." },
  { item: "Errors name the field", status: "fixed", note: "A missing acceptance says which box to check. Property details name the empty field." },
  { item: "Keyboard signature", status: "fixed", note: "The signature pad accepts a typed signature as well as a drawing." },
  { item: "Visible focus", status: "fixed", note: "Acceptance, cookie, and footer controls use a visible focus ring." },
  { item: "Contrast of marketing art", status: "remaining", note: "Gradient price text should be checked against WCAG 2.1 AA with a contrast tool before release." },
  { item: "Full keyboard pass of every partner form", status: "remaining", note: "Host, property-manager, and commercial forms need a manual keyboard pass on a phone-sized screen before release." },
];
