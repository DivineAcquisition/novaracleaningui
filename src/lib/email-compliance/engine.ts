// Email type, footer, consent, and send checks.
//
// One business-identity record builds every footer. A template has exactly
// one type. The type picks the sender, the footer, whether an unsubscribe
// is required, and which content rules apply. Nothing here is a legal
// constant: addresses, sentences, claims, categories, and retention are
// settings the owner can change. Defaults are the starting values from the
// agreements. Clearing the postal address blocks marketing.

export const EMAIL_TYPES = [
  "customer_service",
  "customer_marketing",
  "agreement_account",
  "contractor_operational",
  "contractor_tax",
  "internal_admin",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

export const MARKETING_TYPE: EmailType = "customer_marketing";

export const SERVICE_LIKE: EmailType[] = [
  "customer_service",
  "agreement_account",
  "contractor_operational",
  "contractor_tax",
  "internal_admin",
];

export type MarketingStatus = "subscribed" | "unsubscribed" | "not_asked";

export type ConsentSource =
  | "booking_form"
  | "lead_form"
  | "import"
  | "manual"
  | "preference_page"
  | "unsubscribe_link"
  | "bounce"
  | "complaint"
  | "unknown";

export type SuppressionReason = "unsubscribe" | "bounce" | "complaint";

export type ConsentActor = "contact" | "admin" | "system";

export interface PostalAddress {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface SenderIdentity {
  displayName: string;
  address: string;
  replyTo: string;
}

export interface StreamIdentity extends SenderIdentity {
  /** Resend (or other) stream key. Service and marketing must differ. */
  streamKey: string;
}

export interface MarketingCategory {
  id: string;
  label: string;
}

export interface BusinessIdentity {
  legalName: string;
  brandName: string;
  mailingAddress: PostalAddress;
  supportEmail: string;
  phone: string;
  website: string;
  privacyUrl: string;
  termsUrl: string;
  refundPolicyUrl: string;
  cancellationPolicyUrl: string;
  refundsEmail: string;
  publicOrigin: string;
  /** Empty until the owner supplies a license or registration the business must show. */
  licenseLine: string;
  retentionMonths: number;
  /** Unsubscribe is honored immediately and never later than this many business days. */
  unsubscribeHonorBusinessDays: number;
  monitoredInboxes: string[];
  marketingCategories: MarketingCategory[];
  why: Record<EmailType, string>;
  contractorOnBehalf: string;
  contractorRelationshipLine: string;
  payoutTaxLine: string;
  taxDocumentLine: string;
  paperCopyLine: string;
  withdrawConsentLine: string;
  serviceSafetyLine: string;
  recordKeptLine: string;
  refundQuestionsLine: string;
  partnerGovernsLine: string;
  marketingStopLine: string;
  service: StreamIdentity;
  billing: StreamIdentity;
  marketing: StreamIdentity;
  contractor: SenderIdentity;
  internal: SenderIdentity;
}

export interface ApprovedClaim {
  id: string;
  phrase: string;
  basis: string;
  /** When true, the template must include requiredWording so the claim is only as broad as the truth. */
  conditional: boolean;
  requiredWording: string;
  active: boolean;
}

export interface ConsentRecord {
  status: MarketingStatus;
  source: ConsentSource | string;
  sourceNote: string;
  consentBasis: string;
  categories: Record<string, boolean> | null;
  at: string | null;
}

export interface CatalogEntry {
  key: string;
  name: string;
  where: string;
  /** How it was sent before this layer. */
  senderBefore: string;
  replyToBefore: string;
  footerBefore: string;
  unsubscribeBefore: boolean;
  promotionalBefore: boolean;
  plainTextBefore: boolean;
  assignedType: EmailType;
  /** Owner still needs to confirm the type. Until then it sends as customer_service with no promotional content. */
  ownerDecisionNeeded: boolean;
  /** This repository does not render the message, so the footer cannot be stamped here. */
  external: boolean;
  /** True when this send calls the shared sender, so the footer and checks actually run. */
  routed: boolean;
  changed: string;
}

export interface CheckItem {
  id: string;
  label: string;
  pass: boolean;
  blocking: boolean;
  detail: string;
}

export interface PrepareInput {
  declaredType?: string | null;
  templateKey?: string | null;
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  identity?: Partial<BusinessIdentity> | null;
  claims?: ApprovedClaim[] | null;
  consent?: ConsentRecord | null;
  suppressed?: boolean;
  suppressionReason?: string | null;
  category?: string | null;
  unsubscribeUrl?: string | null;
  preferencesUrl?: string | null;
  oneClickUrl?: string | null;
  adminAcknowledged?: boolean;
  /** Admin-approved offer that sits below the service message, clearly separate. Default is none. */
  separatedOfferHtml?: string | null;
  /** Offer terms printed in the marketing footer. Taken from the body when omitted. */
  offerTerms?: string | null;
  taxYear?: string | null;
  mode?: "save" | "send";
  testSend?: boolean;
  contractorRelationship?: "active" | "offboarded" | null;
  taxElectronicConsentAt?: string | null;
  staffRecipient?: boolean;
  personalFrom?: { displayName?: string; address?: string; replyTo?: string } | null;
  isReply?: boolean;
  now?: string | null;
}

export interface FooterBundle {
  versionKey: string;
  html: string;
  darkHtml: string;
  text: string;
}

export interface PrepareResult {
  type: EmailType;
  mismatch: string | null;
  unclear: boolean;
  decision: "send" | "block";
  blockReasons: string[];
  warnings: string[];
  checklist: CheckItem[];
  from: string;
  replyTo: string;
  stream: "service" | "billing" | "marketing";
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  footer: FooterBundle;
  promotional: boolean;
  promoRemoved: boolean;
  smsUnchanged: true;
  includeInDispute: boolean;
}

export interface DeliveryRecord {
  contactEmail: string;
  emailType: EmailType;
  templateKey: string | null;
  sender: string;
  replyTo: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  footerVersion: string;
  footerHtml: string;
  stream: "service" | "billing" | "marketing";
  sentAt: string;
  testSend: boolean;
}

export interface EvidenceExcerpt {
  channel: "email";
  direction: "novara";
  body: string;
  source: "email_delivery_log";
  at: string;
}

const EMPTY_ADDRESS: PostalAddress = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "US",
};

export const DEFAULT_BUSINESS_IDENTITY: BusinessIdentity = {
  legalName: "Novara Cleaning LLC",
  brandName: "NovaraCleaning",
  mailingAddress: {
    line1: "7404 Executive Place",
    line2: "",
    city: "Lanham",
    region: "MD",
    postalCode: "20706",
    country: "US",
  },
  supportEmail: "support@novaracleaning.com",
  phone: "(844) 735-2070",
  website: "https://novaracleaning.com",
  privacyUrl: "https://novaracleaning.com/privacy",
  termsUrl: "https://novaracleaning.com/terms",
  refundPolicyUrl: "https://novaracleaning.com/refund-policy",
  cancellationPolicyUrl: "https://novaracleaning.com/cancellation-policy",
  refundsEmail: "refunds@novaracleaning.com",
  publicOrigin: "https://app.novaracleaning.com",
  licenseLine: "",
  retentionMonths: 24,
  unsubscribeHonorBusinessDays: 10,
  monitoredInboxes: [
    "support@novaracleaning.com",
    "billing@novaracleaning.com",
    "refunds@novaracleaning.com",
    "operations@novaracleaning.com",
    "ops@novaracleaning.com",
  ],
  marketingCategories: [
    { id: "offers", label: "Offers and seasonal specials" },
    { id: "news", label: "Tips and news" },
    { id: "reactivation", label: "Reactivation" },
    { id: "referrals", label: "Referral offers" },
  ],
  why: {
    customer_service: "You are receiving this service message because of your booking or account with {{brand}}.",
    customer_marketing: "You are receiving this promotional email because {{reason}}.",
    agreement_account: "You are receiving this service message because of your booking or account with {{brand}}.",
    contractor_operational: "This message relates to your independent contractor relationship with {{legal}} under your Independent Contractor Agreement.",
    contractor_tax: "This message relates to your independent contractor relationship with {{legal}} under your Independent Contractor Agreement.",
    internal_admin: "Novara internal system notification. Not for customers or contractors.",
  },
  contractorOnBehalf: "{{contractor}}, on behalf of {{legal}}",
  contractorRelationshipLine: "This message relates to your independent contractor relationship with {{legal}} under your Independent Contractor Agreement.",
  payoutTaxLine: "No taxes were withheld from this payment. You are responsible for your own taxes.",
  taxDocumentLine: "Your Form 1099-NEC for {{taxYear}} is available through the secure link in this email. You are receiving it electronically because you consented on {{consentDate}}. {{paperCopy}} {{withdraw}} If anything looks wrong, reply within {{correctionDays}} days. This email does not include your full taxpayer ID.",
  paperCopyLine: "To request a paper copy, reply to this email.",
  withdrawConsentLine: "To withdraw your consent, reply to this email.",
  serviceSafetyLine: "We will never ask for your full card number, or for gate or alarm codes, by email.",
  recordKeptLine: "A copy of this message is kept in your account record.",
  refundQuestionsLine: "Refund questions: {{refunds}}",
  partnerGovernsLine: "Your agreement with {{legal}} governs this account.",
  marketingStopLine: "Unsubscribing stops promotional emails only. We will still send booking, payment and account messages.",
  service: {
    displayName: "Novara Cleaning",
    address: "support@novaracleaning.com",
    replyTo: "support@novaracleaning.com",
    streamKey: "service",
  },
  billing: {
    displayName: "Novara Cleaning",
    address: "billing@novaracleaning.com",
    replyTo: "billing@novaracleaning.com",
    streamKey: "billing",
  },
  marketing: {
    displayName: "Novara Cleaning",
    address: "hello@novaracleaning.com",
    replyTo: "hello@novaracleaning.com",
    streamKey: "marketing",
  },
  contractor: {
    displayName: "NVC Operations",
    address: "operations@novaracleaning.com",
    replyTo: "operations@novaracleaning.com",
  },
  internal: {
    displayName: "NovaraCleaning",
    address: "ops@novaracleaning.com",
    replyTo: "ops@novaracleaning.com",
  },
};

/** DNS observed 2026-10-15. Not a certification. The owner confirms this in the sending provider. */
export const DOMAIN_AUTH_OBSERVED = {
  observedOn: "2026-10-15",
  apexSpf: "v=spf1 include:dc-aa8e722993._spfm.novaracleaning.com ~all",
  apexSpfIncludes: "v=spf1 include:_spf.google.com ~all",
  sendSubdomainSpf: "v=spf1 include:amazonses.com ~all",
  sendSubdomainMx: "feedback-smtp.us-east-1.amazonses.com",
  resendDkimSelectorPresent: true,
  dmarcRecords: [
    "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;",
    "v=DMARC1; p=none;",
  ],
  fromDomainInCode: "novaracleaning.com",
  marketingAndServiceShareOneResendKey: true,
};

export const SETUP_TASKS = [
  "Confirm 7404 Executive Place, Lanham, MD 20706 is the postal address where Novara Cleaning LLC receives mail. Clearing it blocks marketing. Service mail still sends.",
  "Authenticate a marketing subdomain that is separate from the service From domain, then save it as the marketing sender. Apex SPF authorizes Google, not Amazon SES. send.novaracleaning.com authorizes Amazon SES. Resend DKIM is published at resend._domainkey.novaracleaning.com. Two DMARC records are published at once, which is not a valid policy.",
  "Confirm support@novaracleaning.com, billing@novaracleaning.com, and operations@novaracleaning.com are monitored. Customer mail replies to support@. The inbound mailbox webhook records those replies in the conversation history. Mail to hello@ is not auto-recorded.",
  "Point GoHighLevel workflows, campaigns, and any reactivation tool at the marketing-allowed check before they send. Those sends are not in this repository, so this app cannot stamp their footers until they move here or call the check.",
    "DocuSeal sends agreement emails from its own system. Classify those templates in DocuSeal as agreement messages and keep promotional content out of them.",
    "Approve each offer you still want to send (5% off on the second cart reminder, $30 on the new-customer reminder, 50% off on the video testimonial) on the claims list with a basis. Marketing that uses a claim that is not approved cannot be sent.",
  "Migma hosts the remote HTML for some booking and cart messages. This app replaces the footer at send time. Remove any footer baked into the Migma document so the type footer is the only one.",
];

const PROMO_RE = [
  /\d+\s*%\s*off/i,
  /\bsave\s+\$\s?\d+/i,
  /\bexclusive discounts?\b/i,
  /\blimited spots\b/i,
  /\bspecial offer\b/i,
  /\bpromo(?:tional| code)\b/i,
  /\bnew-customer discount\b/i,
  /\brefer(?:ral)?\b[^.\n]{0,48}\b(?:off|bonus|reward|\$\s?\d+)/i,
  /\bcomplete your booking in the next\b/i,
  /\bdon't miss out\b/i,
];

const RECEIPT_RE = /New Customer Discount:|Membership Savings:|Pay in Full Discount:|Total Savings:|Amount Paid:|Deposit Paid:/;

const OFFER_TERMS_RE = /expir|first[- ]time|one per|household|new customers only|valid through|valid for|days after|applied at checkout/i;

const CLAIM_DETECTORS: Array<{ id: string; label: string; re: RegExp }> = [
  { id: "licensed", label: "licensed", re: /\blicensed\b/i },
  { id: "insured", label: "insured", re: /\binsured\b/i },
  { id: "background_checked", label: "background-checked", re: /\bbackground[-\s]?checked\b/i },
  { id: "guarantee", label: "guarantee", re: /\bguarantee(?:d)?\b/i },
  { id: "limited_spots", label: "limited spots", re: /\blimited spots\b/i },
  { id: "savings_percent", label: "savings percentage", re: /\b(?:save\s+)?\d+\s*%\s*(?:off|savings)\b/i },
  { id: "customers_served", label: "number of customers served", re: /\b\d[\d,]+\+?\s+customers\b/i },
];

const CONTRACTOR_FORBIDDEN_RE = /\b(employees?|pay stubs?|human resources|\bhr\b|w-2|wage statement|on payroll)\b/i;

const URGENCY_RE = /\b(act now|limited spots|last chance!?|final notice|urgent!?|don't miss out)\b/i;

const FAKE_SUBJECT_RE = /^\s*(re|fw|fwd)\s*:/i;

const SHORTENER_RE = /bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly/i;

const TESTIMONIAL_QUOTE_RE = /[“"][^"”]{40,}[”"]/;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}

export function normalizeEmail(value: string | null | undefined): string {
  return textOf(value).trim().toLowerCase();
}

export function emailDomain(value: string | null | undefined): string {
  const raw = textOf(value);
  const inside = raw.match(/<([^>]+)>/);
  const address = normalizeEmail(inside ? inside[1] : raw);
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1) : "";
}

export function formatFrom(sender: { displayName: string; address: string }): string {
  const name = sender.displayName.trim();
  const address = sender.address.trim();
  if (!address) return name;
  if (!name) return address;
  return `${name} <${address}>`;
}

export function hasMailingAddress(address: PostalAddress | null | undefined): boolean {
  if (!address) return false;
  return Boolean(address.line1.trim() && address.city.trim() && address.region.trim() && address.postalCode.trim());
}

export function formatAddress(address: PostalAddress): string {
  const line2 = address.line2.trim();
  const cityLine = [address.city, address.region, address.postalCode].map((p) => p.trim()).filter(Boolean).join(", ").replace(/, ([A-Z]{2}),/, ", $1 ");
  const country = address.country.trim();
  const showCountry = country && !/^us(a)?$/i.test(country);
  return [address.line1.trim(), line2, cityLine, showCountry ? country : ""].filter(Boolean).join(", ");
}

function mergeSender<T extends SenderIdentity>(base: T, raw: unknown): T {
  const v = asObject(raw);
  return {
    ...base,
    displayName: textOf(v.displayName || v.display_name || base.displayName),
    address: textOf(v.address || base.address),
    replyTo: textOf(v.replyTo || v.reply_to || base.replyTo),
    ...("streamKey" in base
      ? { streamKey: textOf(v.streamKey || v.stream_key || (base as StreamIdentity).streamKey) }
      : {}),
  };
}

export function mergeBusinessIdentity(raw: unknown): BusinessIdentity {
  const v = asObject(raw);
  const base = DEFAULT_BUSINESS_IDENTITY;
  const storedLegal = textOf(v.legalName || v.legal_name);
  const legacyUnset = !storedLegal || storedLegal === "NovaraCleaning";
  const addressProvided = v.mailingAddress != null || v.mailing_address != null;
  const address = asObject(v.mailingAddress || v.mailing_address);
  const useStartingAddress = !addressProvided || (!textOf(address.line1).trim() && legacyUnset);
  const whyIn = asObject(v.why);
  const why = { ...base.why };
  for (const type of EMAIL_TYPES) {
    const next = textOf(whyIn[type]);
    if (next.trim()) why[type] = next;
  }
  const categories = Array.isArray(v.marketingCategories || v.marketing_categories)
    ? (v.marketingCategories || v.marketing_categories) as unknown[]
    : base.marketingCategories;
  const monitored = Array.isArray(v.monitoredInboxes || v.monitored_inboxes)
    ? (v.monitoredInboxes || v.monitored_inboxes) as unknown[]
    : base.monitoredInboxes;
  const retention = Number(v.retentionMonths ?? v.retention_months);
  const honor = Number(v.unsubscribeHonorBusinessDays ?? v.unsubscribe_honor_business_days);
  return {
    ...base,
    legalName: storedLegal && storedLegal !== "NovaraCleaning" ? storedLegal : base.legalName,
    brandName: textOf(v.brandName || v.brand_name) && !(legacyUnset && textOf(v.brandName || v.brand_name) === "Novara Cleaning")
      ? textOf(v.brandName || v.brand_name)
      : base.brandName,
    mailingAddress: useStartingAddress ? { ...base.mailingAddress } : {
      line1: textOf(address.line1),
      line2: textOf(address.line2),
      city: textOf(address.city),
      region: textOf(address.region),
      postalCode: textOf(address.postalCode || address.postal_code),
      country: textOf(address.country || base.mailingAddress.country),
    },
    supportEmail: textOf(v.supportEmail || v.support_email || base.supportEmail),
    phone: textOf(v.phone || base.phone),
    website: textOf(v.website || base.website),
    privacyUrl: textOf(v.privacyUrl || v.privacy_url || base.privacyUrl),
    termsUrl: textOf(v.termsUrl || v.terms_url || base.termsUrl),
    refundPolicyUrl: textOf(v.refundPolicyUrl || v.refund_policy_url || base.refundPolicyUrl),
    cancellationPolicyUrl: textOf(v.cancellationPolicyUrl || v.cancellation_policy_url || base.cancellationPolicyUrl),
    refundsEmail: textOf(v.refundsEmail || v.refunds_email || base.refundsEmail),
    publicOrigin: textOf(v.publicOrigin || v.public_origin || base.publicOrigin).replace(/\/+$/, ""),
    licenseLine: textOf(v.licenseLine ?? v.license_line ?? ""),
    retentionMonths: Number.isFinite(retention) && retention > 0 ? Math.round(retention) : base.retentionMonths,
    unsubscribeHonorBusinessDays: Number.isFinite(honor) && honor > 0 ? Math.round(honor) : base.unsubscribeHonorBusinessDays,
    monitoredInboxes: monitored.map((item) => normalizeEmail(textOf(item))).filter(Boolean),
    marketingCategories: categories
      .map((item) => {
        const row = asObject(item);
        const id = textOf(row.id).trim();
        const label = textOf(row.label).trim();
        return id && label ? { id, label } : null;
      })
      .filter((item): item is MarketingCategory => Boolean(item)),
    why,
    contractorOnBehalf: textOf(v.contractorOnBehalf || v.contractor_on_behalf || base.contractorOnBehalf),
    contractorRelationshipLine: textOf(v.contractorRelationshipLine || v.contractor_relationship_line || base.contractorRelationshipLine),
    payoutTaxLine: textOf(v.payoutTaxLine || v.payout_tax_line || base.payoutTaxLine),
    taxDocumentLine: textOf(v.taxDocumentLine || v.tax_document_line || base.taxDocumentLine),
    paperCopyLine: textOf(v.paperCopyLine || v.paper_copy_line || base.paperCopyLine),
    withdrawConsentLine: textOf(v.withdrawConsentLine || v.withdraw_consent_line || base.withdrawConsentLine),
    serviceSafetyLine: textOf(v.serviceSafetyLine || v.service_safety_line || base.serviceSafetyLine),
    recordKeptLine: textOf(v.recordKeptLine || v.record_kept_line || base.recordKeptLine),
    refundQuestionsLine: textOf(v.refundQuestionsLine || v.refund_questions_line || base.refundQuestionsLine),
    partnerGovernsLine: textOf(v.partnerGovernsLine || v.partner_governs_line || base.partnerGovernsLine),
    marketingStopLine: textOf(v.marketingStopLine || v.marketing_stop_line || base.marketingStopLine),
    service: legacyHelloIsSupport(mergeSender(base.service, v.service)),
    billing: mergeSender(base.billing, v.billing),
    marketing: mergeSender(base.marketing, v.marketing),
    contractor: mergeSender(base.contractor, v.contractor),
    internal: mergeSender(base.internal, v.internal),
  };
}

export function fillTemplate(sentence: string, identity: BusinessIdentity, extra: Record<string, string> = {}): string {
  const host = identity.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return sentence
    .replace(/\{\{brand\}\}/g, identity.brandName || identity.legalName)
    .replace(/\{\{legal\}\}/g, identity.legalName || identity.brandName)
    .replace(/\{\{contractor\}\}/g, identity.contractor.displayName)
    .replace(/\{\{refunds\}\}/g, identity.refundsEmail)
    .replace(/\{\{reason\}\}/g, extra.reason || `you signed up at ${host}`)
    .replace(/\{\{taxYear\}\}/g, extra.taxYear || "")
    .replace(/\{\{consentDate\}\}/g, extra.consentDate || "")
    .replace(/\{\{paperCopy\}\}/g, extra.paperCopy || identity.paperCopyLine)
    .replace(/\{\{withdraw\}\}/g, extra.withdraw || identity.withdrawConsentLine)
    .replace(/\{\{correctionDays\}\}/g, extra.correctionDays || String(identity.unsubscribeHonorBusinessDays));
}

function versionKey(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fv_${(h >>> 0).toString(16)}_${input.length}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function marketingStreamReady(identity: BusinessIdentity): boolean {
  const marketing = normalizeEmail(identity.marketing.address);
  const service = normalizeEmail(identity.service.address);
  const billing = normalizeEmail(identity.billing.address);
  return Boolean(
    marketing &&
    marketing !== service &&
    marketing !== billing &&
    identity.marketing.streamKey !== identity.service.streamKey,
  );
}

/** Receipts, invoices, deposits, and membership charges. */
export const BILLING_TEMPLATE_KEYS = new Set([
  "booking_payment_receipt",
  "credit_allocated",
  "credit_expiry",
  "pending_deposit",
  "membership_welcome",
  "membership_renewal",
  "membership_cancelled",
  "membership_benefits",
  "addon_email",
  "overdue_booking",
]);

export type MailboxRole = "support" | "billing" | "marketing" | "operations" | "internal";

export function mailboxRole(type: EmailType, templateKey?: string | null, subject?: string | null): MailboxRole {
  if (type === "contractor_operational" || type === "contractor_tax") return "operations";
  if (type === "internal_admin") return "internal";
  if (type === "customer_marketing") return "marketing";
  const key = textOf(templateKey);
  const aboutMoney = BILLING_TEMPLATE_KEYS.has(key) || /\b(receipt|invoice|payment|deposit|billing|refund)\b/i.test(textOf(subject));
  if (aboutMoney) return "billing";
  return "support";
}

function legacyHelloIsSupport<T extends SenderIdentity>(sender: T): T {
  if (normalizeEmail(sender.address) !== "hello@novaracleaning.com") return sender;
  return { ...sender, address: "support@novaracleaning.com", replyTo: "support@novaracleaning.com" };
}

export function replyIsMonitored(identity: BusinessIdentity, replyTo: string): boolean {
  const address = normalizeEmail(replyTo.match(/<([^>]+)>/)?.[1] || replyTo);
  return identity.monitoredInboxes.includes(address);
}

export interface FooterModel {
  lines: string[];
  links: Array<{ href: string; label: string; prominent?: boolean }>;
  after: string[];
}

export interface FooterContext {
  templateKey?: string | null;
  reason?: string | null;
  offerTerms?: string | null;
  taxYear?: string | null;
  consentDate?: string | null;
}

const REFUND_TEMPLATE_KEYS = new Set(["credit_allocated", "credit_expiry"]);
const PAYOUT_TEMPLATE_KEYS = new Set(["contractor_payout", "contractor_payment_summary", "contractor_final_payment"]);
const PARTNER_TEMPLATE_KEYS = new Set(["partner_service", "partner_agreement", "commercial_account"]);

export function marketingReason(identity: BusinessIdentity, consent?: ConsentRecord | null): string {
  const host = identity.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (consent?.source === "booking_form") return `you booked with ${identity.brandName}`;
  if (consent?.source === "lead_form") return "you requested a quote";
  if (consent?.source === "import" && consent.sourceNote.trim()) return consent.sourceNote.trim();
  return `you signed up at ${host}`;
}

function extractOfferTerms(value: string): string {
  const text = visibleText(value);
  const match = text.match(/(?:new customers only|first[- ]time customers only|one per household|standard clean only)[^.\n]{0,120}/i);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

export function footerModel(
  identity: BusinessIdentity,
  type: EmailType,
  urls: { unsubscribe?: string | null; preferences?: string | null; withdraw?: string | null },
  ctx: FooterContext = {},
): FooterModel {
  const brand = identity.brandName || identity.legalName || "NovaraCleaning";
  const legal = identity.legalName || brand;
  const address = hasMailingAddress(identity.mailingAddress) ? formatAddress(identity.mailingAddress) : "";
  const key = textOf(ctx.templateKey);
  const lines: string[] = [];
  const links: FooterModel["links"] = [];
  const after: string[] = [];
  const extra = {
    reason: ctx.reason || marketingReason(identity, null),
    taxYear: ctx.taxYear || "",
    consentDate: ctx.consentDate || "",
    paperCopy: identity.paperCopyLine,
    withdraw: identity.withdrawConsentLine,
    correctionDays: String(identity.unsubscribeHonorBusinessDays),
  };

  if (type === "internal_admin") {
    lines.push(fillTemplate(identity.why.internal_admin, identity, extra));
    return { lines, links, after };
  }

  if (type === "contractor_operational" || type === "contractor_tax") {
    lines.push(fillTemplate(identity.contractorOnBehalf, identity, extra));
    const place = [address, identity.contractor.address].filter(Boolean).join(" | ");
    if (place) lines.push(place);
    if (identity.licenseLine.trim()) lines.push(identity.licenseLine.trim());
    lines.push(fillTemplate(identity.contractorRelationshipLine, identity, extra));
    if (PAYOUT_TEMPLATE_KEYS.has(key)) lines.push(fillTemplate(identity.payoutTaxLine, identity, extra));
    if (type === "contractor_tax") {
      lines.push(fillTemplate(identity.taxDocumentLine, identity, extra));
      if (urls.withdraw) links.push({ href: urls.withdraw, label: "Withdraw electronic tax-form consent" });
    }
    if (identity.privacyUrl) links.push({ href: identity.privacyUrl, label: "Privacy Policy" });
    return { lines, links, after };
  }

  lines.push(`${brand} | ${legal}`);
  const support = [identity.supportEmail, identity.phone].filter(Boolean).join(" ");
  if (type === "customer_marketing") {
    if (address) lines.push(address);
    if (support) lines.push(support);
  } else {
    const combined = [address, support].filter(Boolean).join(" | ");
    if (combined) lines.push(combined);
  }
  if (identity.licenseLine.trim()) lines.push(identity.licenseLine.trim());
  lines.push(fillTemplate(identity.why[type] || "", identity, extra));

  if (type === "customer_marketing") {
    if (urls.unsubscribe) links.push({ href: urls.unsubscribe, label: "Unsubscribe", prominent: true });
    if (urls.preferences) links.push({ href: urls.preferences, label: "Email preferences" });
  }
  if (identity.privacyUrl) links.push({ href: identity.privacyUrl, label: "Privacy Policy" });
  if (identity.termsUrl) links.push({ href: identity.termsUrl, label: "Terms" });
  if (type !== "customer_marketing" && identity.refundPolicyUrl) {
    links.push({ href: identity.refundPolicyUrl, label: "Refund Policy" });
  }
  if (type !== "customer_marketing" && identity.cancellationPolicyUrl) {
    links.push({ href: identity.cancellationPolicyUrl, label: "Cancellation Policy" });
  }

  if (type === "customer_marketing") {
    after.push(fillTemplate(identity.marketingStopLine, identity, extra));
    const terms = textOf(ctx.offerTerms).trim();
    if (terms) after.push(`Offer terms: ${terms}`);
  } else {
    after.push(fillTemplate(identity.serviceSafetyLine, identity, extra));
  }
  if (type === "agreement_account" || REFUND_TEMPLATE_KEYS.has(key)) {
    after.push(fillTemplate(identity.recordKeptLine, identity, extra));
  }
  if (REFUND_TEMPLATE_KEYS.has(key)) after.push(fillTemplate(identity.refundQuestionsLine, identity, extra));
  if (PARTNER_TEMPLATE_KEYS.has(key)) after.push(fillTemplate(identity.partnerGovernsLine, identity, extra));
  return { lines, links, after };
}

function renderFooter(model: FooterModel, theme: "light" | "dark"): string {
  const dark = theme === "dark";
  const bg = dark ? "#18181b" : "#2a2a2e";
  const fg = dark ? "#e4e4e7" : "#c8c8d0";
  const brand = dark ? "#ddd6fe" : "#ddd6fe";
  const lineHtml = model.lines.map((line, index) => {
    const color = index === 0 ? brand : fg;
    const weight = index === 0 ? "600" : "400";
    const size = index === 0 ? "14px" : "13px";
    return `<p style="margin:0 0 6px;font-family:Inter,Arial,sans-serif;font-size:${size};line-height:1.5;font-weight:${weight};color:${color};">${escapeHtml(line)}</p>`;
  }).join("");
  const linkHtml = model.links.map((item) => {
    const style = item.prominent
      ? `color:${brand};font-size:15px;font-weight:700;text-decoration:underline;`
      : `color:${brand};font-size:13px;text-decoration:underline;`;
    return `<a class="novara-footer-link" href="${escapeHtml(item.href)}" style="${style}">${escapeHtml(item.label)} (${escapeHtml(item.href)})</a>`;
  }).join("<br/>");
  const afterHtml = model.after.map((line) =>
    `<p style="margin:8px 0 0;font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.5;color:${fg};">${escapeHtml(line)}</p>`,
  ).join("");
  return `<table role="presentation" class="novara-footer" data-novara-footer="1" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${bg};border-top:1px solid ${dark ? "#3f3f46" : "#e4e4e7"};">
  <tr><td style="padding:16px 8px 8px;font-family:Inter,Arial,sans-serif;">
    ${lineHtml}
    ${linkHtml ? `<p style="margin:8px 0 0;">${linkHtml}</p>` : ""}
    ${afterHtml}
  </td></tr>
</table>`;
}

export function buildFooter(
  identity: BusinessIdentity,
  type: EmailType,
  urls: { unsubscribe?: string | null; preferences?: string | null; withdraw?: string | null },
  ctx: FooterContext = {},
): FooterBundle {
  const model = footerModel(identity, type, urls, ctx);
  const html = `<!--NOVARA_FOOTER_START--><style>@media (prefers-color-scheme: dark){.novara-footer{background:#18181b !important;}.novara-footer p{color:#e4e4e7 !important;}.novara-footer a{color:#ddd6fe !important;}}</style>${renderFooter(model, "light")}<!--NOVARA_FOOTER_END-->`;
  const darkHtml = renderFooter(model, "dark");
  const text = [
    ...model.lines,
    ...model.links.map((item) => `${item.label}: ${item.href}`),
    ...model.after,
  ].join("\n");
  const versionKeySource = `${type}\n${text}\n${identity.legalName}\n${formatAddress(identity.mailingAddress)}`;
  return { versionKey: versionKey(versionKeySource), html, darkHtml, text };
}

export function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h1|h2|h3)>/gi, "\n")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label} (${href})`)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function isPromotional(value: string): boolean {
  const text = visibleText(value)
    .replace(/New Customer Discount:[^\n]*/g, "")
    .replace(/Membership Savings:[^\n]*/g, "")
    .replace(/Pay in Full Discount:[^\n]*/g, "")
    .replace(/Total Savings:[^\n]*/g, "");
  return PROMO_RE.some((re) => re.test(text));
}

export function promotionalExceptReceipt(value: string): boolean {
  return isPromotional(value);
}

function stripPromoBlocks(html: string): { html: string; removed: boolean } {
  let removed = false;
  const next = html.replace(/<(p|li|div|td|h1|h2|h3)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    const text = visibleText(block);
    if (RECEIPT_RE.test(text) && !/\d+\s*%\s*off|exclusive discount|limited spots|save\s+\$/i.test(text)) return block;
    if (!PROMO_RE.some((re) => re.test(text))) return block;
    removed = true;
    return "";
  });
  return { html: next, removed };
}

export function maskSensitive(value: string): { value: string; masked: boolean } {
  let masked = false;
  const apply = (input: string, re: RegExp, replacer: (match: string) => string) => input.replace(re, (match) => {
    masked = true;
    return replacer(match);
  });
  let next = value;
  next = apply(next, /\b\d{3}-\d{2}-\d{4}\b/g, () => "***-**-****");
  next = apply(next, /\b\d{2}-\d{7}\b/g, () => "**-*******");
  next = apply(next, /\b(?:\d{4}[-\s]?){3}\d{3,4}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return `****${digits.slice(-4)}`;
  });
  next = apply(next, /\b(?:tr|po|acct|py)_[A-Za-z0-9]{6,}\b/g, (match) => {
    const prefix = match.slice(0, match.indexOf("_") + 1);
    return `${prefix}…${match.slice(-4)}`;
  });
  return { value: next, masked };
}

export function detectedClaims(value: string): Array<{ id: string; label: string }> {
  const text = visibleText(value);
  return CLAIM_DETECTORS.filter((item) => item.re.test(text)).map(({ id, label }) => ({ id, label }));
}

export function unapprovedClaims(value: string, claims: ApprovedClaim[]): Array<{ id: string; label: string }> {
  const active = claims.filter((claim) => claim.active && claim.phrase.trim() && claim.basis.trim());
  return detectedClaims(value).filter((found) => {
    const match = active.find((claim) => claim.id === found.id || claim.phrase.toLowerCase() === found.label.toLowerCase() || visibleText(value).toLowerCase().includes(claim.phrase.toLowerCase()));
    if (!match) return true;
    if (match.conditional && match.requiredWording.trim() && !visibleText(value).toLowerCase().includes(match.requiredWording.toLowerCase())) return true;
    return false;
  });
}

export function offerMissingTerms(value: string): boolean {
  const text = visibleText(value);
  if (!/\d+\s*%\s*off|\bsave\s+\$\s?\d+|\blimited spots\b/i.test(text)) return false;
  const at = text.search(/\d+\s*%\s*off|\bsave\s+\$\s?\d+|\blimited spots\b/i);
  const window = text.slice(Math.max(0, at - 180), Math.min(text.length, at + 280));
  return !OFFER_TERMS_RE.test(window);
}

export function unattributedQuote(value: string): boolean {
  const text = visibleText(value);
  const match = text.match(TESTIMONIAL_QUOTE_RE);
  if (!match || match.index == null) return false;
  const after = text.slice(match.index, match.index + match[0].length + 80);
  return !/(with permission|—\s*[A-Z]|-\s*[A-Z][a-z]+)/.test(after);
}

export function isEmailType(value: string | null | undefined): value is EmailType {
  return EMAIL_TYPES.includes(value as EmailType);
}

export function catalogEntry(key: string | null | undefined): CatalogEntry | null {
  if (!key) return null;
  return EMAIL_CATALOG.find((entry) => entry.key === key) || null;
}

export function resolveEmailType(input: {
  declaredType?: string | null;
  templateKey?: string | null;
  html?: string | null;
  subject?: string | null;
}): { type: EmailType; mismatch: string | null; unclear: boolean } {
  const declared = textOf(input.declaredType).trim();
  const content = `${input.subject || ""}\n${input.html || ""}`;
  const promo = promotionalExceptReceipt(content);
  const entry = catalogEntry(input.templateKey);
  let type: EmailType = "customer_service";
  let unclear = false;
  let mismatch: string | null = null;

  if (declared === "review_request") {
    type = promo ? "customer_marketing" : "customer_service";
  } else if (declared === "recruiting_outreach") {
    type = "customer_marketing";
  } else if (declared === "recruiting_reply") {
    type = "contractor_operational";
  } else if (declared === "partner_marketing") {
    type = "customer_marketing";
  } else if (declared === "partner_service") {
    type = promo ? "customer_marketing" : "customer_service";
    if (promo) mismatch = "Partner mail that promotes something is a marketing email.";
  } else if (isEmailType(declared)) {
    type = declared;
  } else if (entry && !entry.ownerDecisionNeeded) {
    type = entry.assignedType;
  } else if (entry && entry.ownerDecisionNeeded) {
    type = "customer_service";
    unclear = true;
  } else if (promo) {
    type = "customer_marketing";
    unclear = !declared;
  } else {
    type = "customer_service";
    unclear = true;
  }

  const contentDecides = declared === "review_request"
    || /review|feedback|testimonial|booking_reminder/.test(entry?.key || "");
  if (contentDecides) {
    const resolved: EmailType = promo ? "customer_marketing" : "customer_service";
    if ((isEmailType(declared) && declared !== resolved) || (entry && entry.assignedType !== resolved)) {
      mismatch = promo
        ? "This message offers something, so it is a marketing email."
        : "This message only asks about a visit or a saved booking, so it is a service email.";
    }
    type = resolved;
  }

  if ((type === "customer_service" || type === "agreement_account" || type === "contractor_operational" || type === "contractor_tax") && promo && declared === "review_request") {
    type = "customer_marketing";
  }

  return { type, mismatch, unclear };
}

const LEGACY_AFTER_OFFBOARD = new Set(["contractor_payout", "contractor_payment_summary", "contractor_tax", "contractor_final_payment"]);

function item(id: string, label: string, pass: boolean, blocking: boolean, detail = ""): CheckItem {
  return { id, label, pass, blocking, detail };
}

export function evaluateEmail(input: PrepareInput): PrepareResult {
  const identity = mergeBusinessIdentity(input.identity || {});
  const claims = input.claims || [];
  const mode = input.mode || "send";
  const saving = mode === "save";
  const now = input.now || new Date().toISOString();
  const resolved = resolveEmailType(input);
  let type = resolved.type;
  const mismatch = resolved.mismatch;
  const unclear = resolved.unclear;
  if (unclear) type = "customer_service";

  const subjectIn = textOf(input.subject).trim();
  const originalHtml = textOf(input.html);
  const marketing = type === "customer_marketing";
  const contractor = type === "contractor_operational" || type === "contractor_tax";
  const serviceLike = !marketing;

  let html = originalHtml;
  let promoRemoved = false;
  if (serviceLike && !input.separatedOfferHtml && promotionalExceptReceipt(html)) {
    const stripped = stripPromoBlocks(html);
    html = stripped.html;
    promoRemoved = stripped.removed;
    if (promotionalExceptReceipt(html)) {
      html = html.replace(/[^<>]{0,240}(?:%\s*off|save\s+\$|exclusive discounts?|limited spots|special offer|promo(?:tional| code)|new-customer discount|don't miss out|complete your booking in the next)[^<>]{0,240}/gi, "");
      promoRemoved = true;
    }
  }
  if (input.separatedOfferHtml && input.adminAcknowledged && serviceLike) {
    html += `<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e4e4e7;font-family:Inter,Arial,sans-serif;font-size:13px;"><p style="margin:0 0 8px;font-weight:700;">Separate from this service message</p>${input.separatedOfferHtml}</div>`;
  }

  const maskedHtml = maskSensitive(html);
  const maskedSubject = maskSensitive(subjectIn);
  html = maskedHtml.value;
  const subject = maskedSubject.value;

  const urls = {
    unsubscribe: input.unsubscribeUrl || null,
    preferences: input.preferencesUrl || null,
    withdraw: input.preferencesUrl ? `${input.preferencesUrl}${input.preferencesUrl.includes("?") ? "&" : "?"}tax=1` : null,
  };
  const consentDate = input.taxElectronicConsentAt
    ? new Date(input.taxElectronicConsentAt).toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" })
    : "";
  const footer = buildFooter(identity, type, urls, {
    templateKey: input.templateKey,
    reason: marketingReason(identity, input.consent),
    offerTerms: textOf(input.offerTerms).trim() || (type === "customer_marketing" ? extractOfferTerms(html) : ""),
    taxYear: textOf(input.taxYear).trim() || String(new Date(input.now || Date.now()).getFullYear() - 1),
    consentDate,
  });
  html = applyEmailChrome(html);
  html = stampFooter(html, footer.html);
  if (marketing) {
    html = html.replace(/<!--NOVARA_FOOTER_START-->/, `${footer.html.includes("promotional") ? "" : ""}<!--NOVARA_FOOTER_START-->`);
  }
  const textBody = `${visibleText(html)}\n\n${footer.text}`.replace(/\n{3,}/g, "\n\n").trim();
  const maskedText = maskSensitive(textBody);

  const role = mailboxRole(type, input.templateKey, subject);
  const sender = chooseSender(identity, type, input.personalFrom, role);
  const stream: "service" | "billing" | "marketing" = role === "marketing" ? "marketing" : role === "billing" ? "billing" : "service";
  const headers: Record<string, string> = { "X-Novara-Stream": stream, "X-Novara-Email-Type": type };
  if (marketing && input.oneClickUrl) {
    headers["List-Unsubscribe"] = `<${input.oneClickUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const combined = `${subject}\n${html}\n${maskedText.value}`;
  const checklist: CheckItem[] = [];
  const addressOk = hasMailingAddress(identity.mailingAddress);

  checklist.push(item("type", "Exactly one email type", Boolean(type), true));
  checklist.push(item(
    "mailing_address",
    "Mailing address is present",
    addressOk,
    marketing,
    addressOk ? "" : "Marketing stays blocked until a postal address is saved.",
  ));

  if (marketing) {
    checklist.push(item("unsubscribe", "One-step unsubscribe link", Boolean(input.unsubscribeUrl), true));
    checklist.push(item("preferences", "Email preferences link", Boolean(input.preferencesUrl), true));
    checklist.push(item("promo_id", "Identified as a promotional message", /promotional (message|email)/i.test(combined), true));
    checklist.push(item("stream", "Marketing stream is separate from service", marketingStreamReady(identity), true, marketingStreamReady(identity) ? "" : "Set a marketing From address that is not the support or billing address."));
    const badClaims = unapprovedClaims(combined, claims);
    checklist.push(item("claims", "Claims are on the approved list", badClaims.length === 0, true, badClaims.map((c) => c.label).join(", ")));
    const missingTerms = offerMissingTerms(visibleText(originalHtml) + "\n" + visibleText(html));
    checklist.push(item("offer_terms", "Offer terms sit next to the offer", !missingTerms, missingTerms, missingTerms ? "State who qualifies and when it ends beside the offer." : ""));
    const consentOk = input.testSend || saving ? { ok: true, reason: "" } : canReceiveMarketing(input.consent || null, input.category || null, Boolean(input.suppressed));
    checklist.push(item("consent", "Consent or a recorded source is on file", consentOk.ok, !input.testSend && !saving, consentOk.reason));
    checklist.push(item("not_suppressed", "Address is not suppressed", input.testSend || saving || !input.suppressed, !input.testSend && !saving, input.suppressionReason || ""));
  } else {
    checklist.push(item("no_promo", "No promotional content", !promotionalExceptReceipt(html), mode === "save" && promotionalExceptReceipt(html) && !input.adminAcknowledged, promoRemoved ? "Promotional content was removed before sending." : ""));
    checklist.push(item("no_unsubscribe_required", "Service footer does not require an unsubscribe", !/Unsubscribe \(http/i.test(footer.text) || marketing, false));
  }

  if (type === "customer_service" || type === "agreement_account" || marketing) {
    const monitored = replyIsMonitored(identity, sender.replyTo);
    const noreply = /no-?reply|do-?not-?reply/i.test(`${sender.from} ${sender.replyTo}`);
    checklist.push(item("reply_to", "Replies reach a monitored inbox", monitored && !noreply, true, noreply ? "Do-not-reply addresses are not used." : sender.replyTo));
  }

  if (contractor) {
    checklist.push(item("contractor_sender", "Sender is the contractor operations identity", sender.from.includes(identity.contractor.address) && sender.from.includes(identity.contractor.displayName), true, sender.from));
    checklist.push(item("contractor_language", "Independent contractor language only", !CONTRACTOR_FORBIDDEN_RE.test(combined), true));
    const offboarded = input.contractorRelationship === "offboarded";
    const allowedAfter = type === "contractor_tax" || LEGACY_AFTER_OFFBOARD.has(textOf(input.templateKey));
    checklist.push(item("offboard", "After offboarding, only final pay and tax messages", saving || !offboarded || allowedAfter, !saving && offboarded && !allowedAfter));
  }

  if (type === "contractor_tax") {
    checklist.push(item("tax_consent", "Electronic tax delivery only with consent", saving || Boolean(input.taxElectronicConsentAt), !saving));
    checklist.push(item("paper_copy", "Paper-copy instructions are in the footer", footer.text.includes(identity.paperCopyLine), true));
    checklist.push(item("withdraw", "Withdrawal instructions are in the footer", footer.text.includes(identity.withdrawConsentLine), true));
  }

  if (type === "internal_admin") {
    const staff = input.staffRecipient !== undefined
      ? input.staffRecipient === true
      : catalogEntry(input.templateKey)?.assignedType === "internal_admin";
    checklist.push(item("staff_only", "Internal mail goes only to staff", saving || staff, !saving));
    checklist.push(item("no_marketing", "No marketing content", !promotionalExceptReceipt(html), true));
  }

  checklist.push(item("subject_honest", "Subject is not a fake reply or forward", input.isReply === true || !FAKE_SUBJECT_RE.test(subject), true));
  if (marketing) {
    checklist.push(item("no_false_urgency", "No misleading urgency", !URGENCY_RE.test(`${subject}\n${visibleText(originalHtml)}`), URGENCY_RE.test(`${subject}\n${visibleText(originalHtml)}`)));
  }
  checklist.push(item("no_shorteners", "Links are full, not shortened", !SHORTENER_RE.test(combined), true));
  checklist.push(item("no_full_ids", "No full card, payout, or taxpayer identifiers", !hasRawIdentifier(combined), true));
  checklist.push(item("plain_text", "Plain-text version includes the footer", maskedText.value.includes(footer.text.split("\n")[0] || "x"), true));
  const quoteProblem = unattributedQuote(originalHtml);
  checklist.push(item("quotes", "Quoted reviews are attributed or permission-based", !quoteProblem, marketing && quoteProblem));

  if (mismatch) {
    checklist.push(item("mismatch", "Declared type matches the content", false, false, mismatch));
  }

  const warnings = checklist.filter((row) => !row.pass && !row.blocking).map((row) => row.detail || row.label);
  if (promoRemoved) warnings.push("Promotional content was removed from this service message.");
  if (maskedHtml.masked || maskedSubject.masked || maskedText.masked) warnings.push("A full payment, payout, or taxpayer identifier was masked.");
  if (unclear) warnings.push("Type was unclear, so this sends as a service message with no promotional content until the owner assigns a type.");

  const ackNeeded = mode === "save" && serviceLike && checklist.some((row) => !row.pass && !row.blocking);
  if (ackNeeded && !input.adminAcknowledged) {
    checklist.push(item("admin_ack", "Admin acknowledged the service warning", false, true, "Service warnings must be acknowledged before the template is saved live."));
  }

  const blockReasons = checklist.filter((row) => row.blocking && !row.pass).map((row) => row.detail || row.label);
  const decision = blockReasons.length ? "block" : "send";

  return {
    type,
    mismatch,
    unclear,
    decision,
    blockReasons,
    warnings,
    checklist,
    from: sender.from,
    replyTo: sender.replyTo,
    stream,
    subject,
    html,
    text: maskedText.value,
    headers,
    footer,
    promotional: marketing,
    promoRemoved,
    smsUnchanged: true,
    includeInDispute: !input.testSend && decision === "send" && (type === "customer_service" || type === "agreement_account" || type === "customer_marketing"),
  };
}

function chooseSender(
  identity: BusinessIdentity,
  type: EmailType,
  personalFrom: { displayName?: string; address?: string; replyTo?: string } | null | undefined,
  role: MailboxRole,
): { from: string; replyTo: string } {
  if ((type === "agreement_account" || type === "customer_service") && personalFrom?.address?.trim()) {
    return {
      from: formatFrom({ displayName: personalFrom.displayName || identity.brandName, address: personalFrom.address }),
      replyTo: personalFrom.replyTo || personalFrom.address,
    };
  }
  const mailbox = role === "billing"
    ? identity.billing
    : role === "marketing"
      ? identity.marketing
      : role === "operations"
        ? identity.contractor
        : role === "internal"
          ? identity.internal
          : identity.service;
  return { from: formatFrom(mailbox), replyTo: mailbox.replyTo || mailbox.address };
}

function stampFooter(html: string, footerHtml: string): string {
  let next = html.replace(/<p\b[^>]*>[\s\S]*?Unsubscribe from partnership emails[\s\S]*?<\/p>/gi, "");
  next = next.replace(/<[^>]+>[^<]*All rights reserved\.?[^<]*<\/[^>]+>/gi, "");
  const commentSlot = /<!--NOVARA_FOOTER_START-->[\s\S]*?<!--NOVARA_FOOTER_END-->/;
  const textSlot = /NOVARA_FOOTER_START[\s\S]*?NOVARA_FOOTER_END/;
  if (commentSlot.test(next)) return next.replace(commentSlot, footerHtml);
  if (textSlot.test(next)) return next.replace(textSlot, footerHtml);
  if (/<\/body>/i.test(next)) return next.replace(/<\/body>/i, `${footerHtml}</body>`);
  return `${next}\n${footerHtml}`;
}

function hasRawIdentifier(value: string): boolean {
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) return true;
  if (/\b\d{2}-\d{7}\b/.test(value)) return true;
  if (/\b(?:\d{4}[-\s]?){3}\d{3,4}\b/.test(value)) return true;
  if (/\b(?:tr|po|acct|py)_[A-Za-z0-9]{10,}\b/.test(value)) return true;
  return false;
}

export function canReceiveMarketing(
  consent: ConsentRecord | null,
  category: string | null,
  suppressed: boolean,
): { ok: boolean; reason: string } {
  if (suppressed) return { ok: false, reason: "This address is on the suppression list." };
  if (!consent) return { ok: false, reason: "No marketing consent or source is on record." };
  if (consent.status === "unsubscribed") return { ok: false, reason: "This address is unsubscribed." };
  if (consent.status === "subscribed") {
    return categoryAllowed(consent, category);
  }
  if (consent.status === "not_asked") {
    if (!consent.source || consent.source === "unknown" || !consent.consentBasis.trim()) {
      return { ok: false, reason: "A source and a consent basis are required before marketing mail." };
    }
    if (consent.source === "import" && !consent.sourceNote.trim()) {
      return { ok: false, reason: "An imported list needs a source note before it can be mailed." };
    }
    return categoryAllowed(consent, category);
  }
  return { ok: false, reason: "Marketing status is not eligible." };
}

function categoryAllowed(consent: ConsentRecord, category: string | null): { ok: boolean; reason: string } {
  if (!category) return { ok: true, reason: "" };
  if (!consent.categories) return { ok: true, reason: "" };
  if (consent.categories[category] === false) return { ok: false, reason: `This person opted out of ${category}.` };
  return { ok: true, reason: "" };
}

export interface ConsentChange {
  ok: boolean;
  error: string;
  status: MarketingStatus;
  smsUnchanged: true;
}

export function applyConsentChange(input: {
  actor: ConsentActor;
  current: MarketingStatus;
  next: MarketingStatus;
  source: string;
}): ConsentChange {
  if (input.actor === "admin" && input.current === "unsubscribed" && input.next === "subscribed") {
    return { ok: false, error: "An admin cannot put an unsubscribed address back on the list. Only the person can resubscribe.", status: input.current, smsUnchanged: true };
  }
  if (input.actor === "admin" && input.next === "subscribed" && input.current !== "subscribed") {
    return { ok: false, error: "An admin cannot mark someone subscribed. Consent has to be their own action.", status: input.current, smsUnchanged: true };
  }
  if (input.actor !== "contact" && input.next === "subscribed") {
    return { ok: false, error: "Only the person can subscribe.", status: input.current, smsUnchanged: true };
  }
  return { ok: true, error: "", status: input.next, smsUnchanged: true };
}

export function retentionCutoff(nowIso: string, months: number): string {
  const now = new Date(nowIso);
  const copy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  copy.setUTCMonth(copy.getUTCMonth() - Math.max(1, Math.round(months || 24)));
  return copy.toISOString();
}

export function toDeliveryRecord(result: PrepareResult, meta: { to: string; templateKey?: string | null; sentAt?: string | null; testSend?: boolean }): DeliveryRecord {
  return {
    contactEmail: normalizeEmail(meta.to),
    emailType: result.type,
    templateKey: meta.templateKey || null,
    sender: result.from,
    replyTo: result.replyTo,
    recipient: normalizeEmail(meta.to),
    subject: result.subject,
    html: result.html,
    text: result.text,
    footerVersion: result.footer.versionKey,
    footerHtml: result.footer.html,
    stream: result.stream,
    sentAt: meta.sentAt || new Date().toISOString(),
    testSend: Boolean(meta.testSend),
  };
}

export function asEvidenceExcerpt(record: DeliveryRecord): EvidenceExcerpt | null {
  if (record.testSend) return null;
  if (record.emailType === "internal_admin" || record.emailType === "contractor_operational" || record.emailType === "contractor_tax") return null;
  return {
    channel: "email",
    direction: "novara",
    body: record.text,
    source: "email_delivery_log",
    at: record.sentAt,
  };
}

export function previewFor(identity: BusinessIdentity, type: EmailType, urls?: { unsubscribe?: string; preferences?: string }): FooterBundle {
  return buildFooter(identity, type, {
    unsubscribe: urls?.unsubscribe || `${identity.publicOrigin}/email/unsubscribe?t=preview`,
    preferences: urls?.preferences || `${identity.publicOrigin}/email/preferences?t=preview`,
    withdraw: `${identity.publicOrigin}/email/preferences?t=preview&tax=1`,
  });
}

const ROUTED_KEYS = new Set([
  "booking_confirmation",
  "booking_payment_receipt",
  "booking_modification",
  "booking_cancellation",
  "booking_completion",
  "booking_photo_gallery",
  "booking_reminder",
  "abandoned_cart",
  "job_feedback",
  "testimonial_offer",
  "contractor_payout",
  "contractor_assignment",
  "contractor_invitation",
  "contractor_credentials",
  "contractor_tier",
  "contractor_reject",
  "contractor_engagement_end",
  "contractor_tax",
  "partner_service",
  "partner_agreement",
  "walkthrough_agent",
  "admin_one_off",
]);

function entry(partial: Omit<CatalogEntry, "routed">): CatalogEntry {
  return { ...partial, routed: ROUTED_KEYS.has(partial.key) };
}

export const EMAIL_CATALOG: CatalogEntry[] = [
  entry({ key: "booking_confirmation", name: "Booking confirmation", where: "send-booking-email / BookingConfirmation", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none (replies fall through to hello@)", footerBefore: "Copyright, website, account, contact, terms, privacy. No postal address.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer from business identity. Applied price savings stay. No unsubscribe." }),
  entry({ key: "booking_payment_receipt", name: "Payment receipt", where: "send-booking-email / PaymentReceipt", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared email layout, no postal address.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. No promotional content added." }),
  entry({ key: "booking_modification", name: "Booking modification", where: "send-booking-email / BookingModification", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared email layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "booking_cancellation", name: "Booking cancellation", where: "send-booking-email / BookingCancellation", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared email layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "booking_completion", name: "Completion thank-you", where: "send-booking-email / BookingThankYou", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared email layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "booking_photo_gallery", name: "Before and after photos", where: "send-booking-email", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Phone line only.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "booking_reminder", name: "Saved-booking reminder", where: "BookingReminder / send-booking-reminder-email", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared email layout. Copy says the person started a booking.", unsubscribeBefore: false, promotionalBefore: true, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "A reminder that offers $30 off or a new-customer discount is marketing and needs consent. A reminder with no offer stays a service message. The $30 variant now states the offer terms beside the offer." }),
  entry({ key: "abandoned_cart", name: "Abandoned cart", where: "send-abandoned-cart-email / AbandonedCartReminder / Migma", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Questions line and copyright. Migma remote HTML when configured.", unsubscribeBefore: false, promotionalBefore: true, plainTextBefore: false, assignedType: "customer_marketing", ownerDecisionNeeded: false, external: false, changed: "Marketing footer, separate stream, unsubscribe, and offer terms on the 5% line. Sends only with consent and a mailing address." }),
  entry({ key: "job_feedback", name: "Visit feedback request", where: "job-feedback-offer", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "None.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. A discount added later reclassifies it as marketing." }),
  entry({ key: "testimonial_offer", name: "Video testimonial offer", where: "testimonial-offer via admin-send-email", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Sign-off only.", unsubscribeBefore: false, promotionalBefore: true, plainTextBefore: false, assignedType: "customer_marketing", ownerDecisionNeeded: false, external: false, changed: "50% off makes this marketing. Offer terms added beside the offer. Blocked without consent, address, and unsubscribe." }),
  entry({ key: "membership_welcome", name: "Membership welcome", where: "send-membership-email / MembershipWelcome", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout plus a membership sentence.", unsubscribeBefore: false, promotionalBefore: true, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Removed the exclusive-discount line. Service footer." }),
  entry({ key: "membership_renewal", name: "Membership renewal", where: "MembershipRenewal", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "membership_cancelled", name: "Membership cancelled", where: "SubscriptionCancelled", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "membership_benefits", name: "Membership benefits", where: "send-membership-benefits", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Varies.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. Benefit claims must be on the approved list before they are used in marketing." }),
  entry({ key: "credit_allocated", name: "Credit allocated", where: "CreditAllocated", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "credit_expiry", name: "Credit expiry", where: "CreditExpiryWarning", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. This is an account notice, not a promotion." }),
  entry({ key: "waitlist_confirmation", name: "Waitlist confirmation", where: "add-to-waitlist / WaitlistConfirmation", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "reschedule_confirmation", name: "Reschedule confirmation", where: "reschedule-booking / RescheduleConfirmation", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "recurring_paused", name: "Recurring paused", where: "RecurringPaused", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "quote_customer", name: "Quote to customer", where: "create-quote / send-sales-quote-email / quote-dynamic-price", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline HTML, often no postal address.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. A discount in the quote email is flagged." }),
  entry({ key: "details_reminder", name: "Details reminder", where: "send-details-reminder", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "pending_deposit", name: "Pending deposit reminder", where: "pending-deposit-reminders / book-as-va", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. Payment mail, not a promotion." }),
  entry({ key: "overdue_booking", name: "Overdue booking notice", where: "escalate-overdue-bookings", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "cleaning_checklist", name: "Cleaning checklist", where: "send-cleaning-checklist", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "addon_email", name: "Add-on notice", where: "send-addon-email", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "lead_capture", name: "Lead capture mail", where: "send-lead-capture-webhook", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: true, external: false, changed: "Sends as a service message with promotional content removed until the owner assigns a type." }),
  entry({ key: "mailbox_ack", name: "Inbound mailbox acknowledgement", where: "inbound-mailbox-ack", senderBefore: "NovaraCleaning <hello@novaracleaning.com>", replyToBefore: "support@ or billing@", footerBefore: "Signature only. Copy is fixed and factual.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: true, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Copy unchanged. The acknowledgement is sent from the mailbox that received the message. The inbound message is stored in the conversation history." }),
  entry({ key: "contractor_payout", name: "Contractor payout", where: "PayoutConfirmation / send-cleaner-email", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Shared customer layout, no operations line.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "Contractor footer. Payout reference is masked. Independent-contractor wording. No unsubscribe while active." }),
  entry({ key: "contractor_assignment", name: "Contractor assignment", where: "CleanerAssignment / send-cleaner-email", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Shared layout or a short sign-off.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "Contractor footer. No unsubscribe." }),
  entry({ key: "contractor_invitation", name: "Contractor onboarding invite", where: "CleanerInvitation / talent onboarding email", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Short sign-off.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "Contractor footer. Replies to people who applied stay operational." }),
  entry({ key: "contractor_credentials", name: "Contractor credentials", where: "CleanerCredentials", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "Contractor footer." }),
  entry({ key: "contractor_verification", name: "Contractor verification code", where: "send-cleaner-verification-code", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "Contractor footer." }),
  entry({ key: "contractor_tier", name: "Contractor rate change", where: "CleanerTierPromotion", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Shared layout.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "Contractor footer. This is a rate notice, not customer marketing." }),
  entry({ key: "contractor_engagement_end", name: "Resignation or termination notice", where: "terminate-cleaner / engagement-end", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Letter sign-off.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: true, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "Contractor footer added. Wording stays the independent-contractor notice already in use." }),
  entry({ key: "contractor_reject", name: "Applicant reply", where: "talent reject-email", senderBefore: "NVC Operations <operations@novaracleaning.com>", replyToBefore: "operations@novaracleaning.com", footerBefore: "Short sign-off.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_operational", ownerDecisionNeeded: false, external: false, changed: "People who applied get the operational footer, not a marketing unsubscribe." }),
  entry({ key: "contractor_tax", name: "1099-NEC delivery", where: "nec-1099 email_copy", senderBefore: "Not emailed. Copy B and Copy C open inside the portal.", replyToBefore: "n/a", footerBefore: "None.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "contractor_tax", ownerDecisionNeeded: false, external: false, changed: "Electronic mail only after timestamped consent. Body has no taxpayer id. Paper-copy and withdrawal lines are in the footer. Without consent, the existing paper path is unchanged." }),
  entry({ key: "recruiting_outreach", name: "Recruiting broadcast", where: "Not a stored template. Outreach to people who did not apply.", senderBefore: "Not defined in the repository.", replyToBefore: "n/a", footerBefore: "None.", unsubscribeBefore: false, promotionalBefore: true, plainTextBefore: false, assignedType: "customer_marketing", ownerDecisionNeeded: false, external: false, changed: "Broadcasts follow marketing rules. Replies to applicants stay contractor operational." }),
  entry({ key: "partner_service", name: "Partner service and billing", where: "partnership_message_templates partner role", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "support@novaracleaning.com", footerBefore: "Some messages gained a transactional unsubscribe line.", unsubscribeBefore: true, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. Marketing unsubscribe no longer stops booking, billing, or agreement mail. A partner promotion uses the marketing type." }),
  entry({ key: "partner_agreement", name: "Partner agreement request", where: "host_onboarding_link, commercial_onboarding_link", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "support@novaracleaning.com", footerBefore: "Partnership footer.", unsubscribeBefore: true, promotionalBefore: false, plainTextBefore: false, assignedType: "agreement_account", ownerDecisionNeeded: false, external: false, changed: "Agreement footer, same as service. No promotional content." }),
  entry({ key: "walkthrough_agent", name: "Walkthrough assignment", where: "walkthrough_agent templates", senderBefore: "Novara Ops <ops@novaracleaning.com>", replyToBefore: "ops@novaracleaning.com", footerBefore: "None or partnership footer.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "internal_admin", ownerDecisionNeeded: false, external: false, changed: "Staff footer. Sender stays the ops address already configured for that role." }),
  entry({ key: "admin_internal_notice", name: "Internal admin notice", where: "partnership admin templates, capacity alert, weekly report, lead alerts, dispatch", senderBefore: "Novara Cleaning <ops@novaracleaning.com> or hello@", replyToBefore: "ops@ or none", footerBefore: "Minimal or none.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "internal_admin", ownerDecisionNeeded: false, external: false, changed: "Staff footer. No unsubscribe and no marketing." }),
  entry({ key: "auth_email", name: "Sign-in and portal links", where: "send-auth-email / send-partner-auth-email", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer." }),
  entry({ key: "va_onboarding", name: "VA onboarding", where: "api/va/onboarding", senderBefore: "Novara Team <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "internal_admin", ownerDecisionNeeded: false, external: false, changed: "Staff footer." }),
  entry({ key: "commercial_account", name: "Commercial account mail", where: "commercial-accounts actions", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: false, external: false, changed: "Service footer. A promotion in the same send is marketing." }),
  entry({ key: "ad_spend", name: "Ad spend form", where: "ad-spend server", senderBefore: "hello@novaracleaning.com", replyToBefore: "none", footerBefore: "Inline.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "internal_admin", ownerDecisionNeeded: false, external: false, changed: "Staff footer." }),
  entry({ key: "ghl_workflows", name: "GoHighLevel workflows and campaigns", where: "GoHighLevel, outside this repository", senderBefore: "Configured in GoHighLevel, not in this repo", replyToBefore: "Unknown here", footerBefore: "Unknown here. Not shared with Resend templates.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: true, external: true, changed: "Untyped until the owner assigns each workflow. They send as service mail with no promotional content only if they move through this app. Marketing from GHL must call the shared suppression check." }),
  entry({ key: "reactivation_platform", name: "Reactivation platform", where: "Not implemented. Weekly report cannot yet tell a reactivation from a rebooking.", senderBefore: "None in this repository", replyToBefore: "n/a", footerBefore: "None.", unsubscribeBefore: false, promotionalBefore: true, plainTextBefore: false, assignedType: "customer_marketing", ownerDecisionNeeded: true, external: true, changed: "When a reactivation email is added, it is marketing and uses this footer, consent, and suppression list." }),
  entry({ key: "docuseal_agreement", name: "DocuSeal agreement email", where: "DocuSeal send_email", senderBefore: "DocuSeal on behalf of the account", replyToBefore: "Unknown", footerBefore: "DocuSeal's own footer.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "agreement_account", ownerDecisionNeeded: false, external: true, changed: "Classified as an agreement message. The vendor still renders it. Keep it factual and free of offers." }),
  entry({ key: "migma_remote", name: "Migma remote HTML", where: "api.migma.ai export used by confirmation and cart", senderBefore: "Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "none", footerBefore: "Whatever is saved in Migma. Confirmation code set {{unsubscribe_link}} to #.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: true, external: true, changed: "Send-time footer replaces the broken unsubscribe placeholder for service mail. Cart HTML is marketing. Owner confirms each Migma document's type." }),
  entry({ key: "admin_one_off", name: "Admin one-off", where: "admin-send-email", senderBefore: "Caller-supplied, default Novara Cleaning <hello@novaracleaning.com>", replyToBefore: "Caller-supplied or none", footerBefore: "Whatever the composer pasted.", unsubscribeBefore: false, promotionalBefore: false, plainTextBefore: false, assignedType: "customer_service", ownerDecisionNeeded: true, external: false, changed: "A one-off without a type sends as service mail and loses promotional content until the sender picks a type." }),
];

export function migrationReport(): Array<{ key: string; type: EmailType; ownerDecisionNeeded: boolean; changed: string }> {
  return EMAIL_CATALOG.map((row) => ({
    key: row.key,
    type: row.assignedType,
    ownerDecisionNeeded: row.ownerDecisionNeeded,
    changed: row.changed,
  }));
}

export interface AuditFinding {
  id: string;
  status: "present" | "missing" | "partial";
  title: string;
  detail: string;
}

export function buildAuditReport(): { findings: AuditFinding[]; setupTasks: string[]; catalog: CatalogEntry[]; domain: typeof DOMAIN_AUTH_OBSERVED } {
  const findings: AuditFinding[] = [
    {
      id: "sends",
      status: "partial",
      title: "Emails the system sends",
      detail: `${EMAIL_CATALOG.length} send paths are classified. Resend is the app sender (react templates, admin one-offs, partnership mail, contractor mail). GoHighLevel is used for SMS and for workflows that are not stored here. There is no reactivation email program in this repository. DocuSeal and Migma render some messages outside the template folder.`,
    },
    {
      id: "unsubscribe",
      status: "partial",
      title: "Unsubscribe and suppression",
      detail: "Partnership mail had its own opt-out, separate from SMS STOP. Booking templates had no working unsubscribe (the Migma placeholder was set to #). There was no suppression list shared by Resend, GoHighLevel, and a reactivation tool. This layer is that list. An email unsubscribe does not change text status.",
    },
    {
      id: "auth",
      status: "partial",
      title: "Sending-domain authentication",
      detail: `Observed ${DOMAIN_AUTH_OBSERVED.observedOn}. Apex SPF authorizes Google only. send.novaracleaning.com authorizes Amazon SES and its MX is the SES feedback host. A Resend DKIM key is published. Two DMARC records are published together. Service and marketing mail used one Resend key and hello@novaracleaning.com.`,
    },
    {
      id: "replies",
      status: "partial",
      title: "Replies and conversation history",
      detail: "Google Workspace receives the domain. support@ and billing@ have an inbound acknowledgement and are now written to the conversation history. Most customer sends had no Reply-To, so replies went to hello@, which that acknowledgement ignores. Customer mail now replies to support@.",
    },
    {
      id: "plain_text",
      status: "missing",
      title: "Plain-text versions",
      detail: "Resend calls sent HTML only, except the mailbox acknowledgement. Every type now sends a plain-text part with the same footer.",
    },
    {
      id: "claims",
      status: "partial",
      title: "Claims in email",
      detail: "Email templates did not say licensed, insured, background-checked, or limited spots. The agreements state the company maintains commercial general liability insurance, so insured can be approved on that basis. Background checks are required by the screening policy, but a hiring path can still skip one, so background-checked is not approved for every cleaner. Licensed stays empty until a real license is supplied. Templates did say exclusive discounts, 5% off, save $30, and 50% off. Those stay blocked until each one is approved.",
    },
    {
      id: "address",
      status: "present",
      title: "Mailing address",
      detail: "Starting postal address is 7404 Executive Place, Lanham, MD 20706, the principal office in the service, host, and partner agreements. Legal name is Novara Cleaning LLC. Brand name is NovaraCleaning. The owner confirms both in Email settings. Clearing the address blocks marketing. Policy pages already publish privacy, terms, refund, and cancellation links. Some agreement screens still say NovaraCleaning LLC.",
    },
  ];
  return { findings, setupTasks: SETUP_TASKS, catalog: EMAIL_CATALOG, domain: DOMAIN_AUTH_OBSERVED };
}

export const IDENTITY_SETTING_KEY = "email_business_identity";
export const CLAIMS_SETTING_KEY = "email_approved_claims";

/** Square Novara mark. File lives at public/novara-logo.png. */
export const EMAIL_LOGO_URL = "https://app.novaracleaning.com/novara-logo.png";

export interface EmailCardInput {
  preheader?: string | null;
  title?: string | null;
  bodyHtml: string;
  buttonHref?: string | null;
  buttonLabel?: string | null;
  footerHtml?: string | null;
}

/**
 * The email box: dark card, purple bar, logo, then the message.
 * Matches the sign-in card — mark at the top left, title, body, light button.
 */
export function buildEmailCard(input: EmailCardInput): string {
  const title = textOf(input.title).trim();
  const button = input.buttonHref && input.buttonLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;"><tr><td style="background:#e7e7ea;border-radius:12px;">
        <a class="novara-btn" href="${escapeHtml(input.buttonHref)}" style="display:inline-block;padding:14px 28px;font-family:Inter,Arial,sans-serif;font-size:16px;font-weight:600;color:#18181b;text-decoration:none;border-radius:12px;">${escapeHtml(input.buttonLabel)}</a>
      </td></tr></table>
      <p style="margin:14px 0 0;font-family:Inter,Arial,sans-serif;font-size:12px;line-height:1.5;color:#a1a1aa;word-break:break-all;">${escapeHtml(input.buttonHref)}</p>`
    : "";
  const heading = title
    ? `<h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">${escapeHtml(title)}</h1>`
    : "";
  const footer = input.footerHtml ?? "<!--NOVARA_FOOTER_START--><!--NOVARA_FOOTER_END-->";
  const preheader = textOf(input.preheader).trim();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  .novara-card p, .novara-card li, .novara-card span, .novara-card td { color:#d4d4d8 !important; }
  .novara-card a:not(.novara-btn) { color:#ddd6fe; }
  .novara-card a.novara-btn { color:#18181b !important; }
</style></head>
<body style="margin:0;padding:0;background:#141416;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#141416;"><tr><td align="center" style="padding:28px 12px;">
<table data-novara-card="1" role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#2a2a2e;border:1px solid #3a3a40;border-radius:16px;">
<tr><td style="height:3px;background:#7c6af7;border-radius:16px 16px 0 0;font-size:0;line-height:3px;">&nbsp;</td></tr>
<tr><td class="novara-card" style="padding:28px 28px 24px;font-family:Inter,Arial,sans-serif;">
<img src="${EMAIL_LOGO_URL}" width="56" height="56" alt="Novara Cleaning" style="display:block;width:56px;height:56px;border-radius:12px;margin:0 0 22px;" />
${heading}
<div style="font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.5;color:#d4d4d8;">${input.bodyHtml}</div>
${button}
${footer}
</td></tr></table>
</td></tr></table></body></html>`;
}

/** Put fragment mail in the card. Leave a message that already uses the card. */
export function applyEmailChrome(html: string): string {
  const next = html.replace(/novara-email-logo\.png/g, "novara-logo.png");
  if (/data-novara-card/.test(next)) return next;
  if (/<html[\s>]/i.test(next) || /<!doctype/i.test(next)) {
    const body = next.replace(/[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");
    const inner = body.trim() || next;
    return buildEmailCard({ bodyHtml: inner });
  }
  return buildEmailCard({ bodyHtml: next });
}
