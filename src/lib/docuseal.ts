// ─── DocuSeal e-signature client (server-only) ────────────────────────────────
//
// Sends NovaraCleaning agreements for e-signature via DocuSeal and records each
// send in public.docuseal_submissions. One engine serves every audience:
//   one_time      → One-Time Service Agreement   (signer role: Client)
//   membership    → Recurring & Membership Agr.   (signer role: Member)
//   str_host      → Host Partnership Agreement     (signer role: Host)
//   commercial    → Commercial Cleaning Services   (signer role: Client)
//   contractor    → Contractor Agreement           (signer role: Contractor)
//   va_contractor → VA Independent Contractor Agr. (signer role: Contractor)
//
// Config (API token, base URL, per-audience template ids, webhook secret) lives
// in public.app_secrets — never in git. We resolve it with the service-role
// client (falling back to process.env) and cache it per server instance.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export type AgreementAudience =
  | "one_time"
  | "membership"
  | "str_host"
  | "commercial"
  | "contractor"
  | "va_contractor"
  | "va_contractor_hourly";

/** Default DocuSeal submitter role per audience (matches the templates). */
export const AUDIENCE_ROLE: Record<AgreementAudience, string> = {
  one_time: "Client",
  membership: "Member",
  str_host: "Host",
  commercial: "Client",
  contractor: "Contractor",
  va_contractor: "Contractor",
  va_contractor_hourly: "Contractor",
};

const AUDIENCE_TEMPLATE_SECRET: Record<AgreementAudience, string> = {
  one_time: "DOCUSEAL_TEMPLATE_ONE_TIME",
  membership: "DOCUSEAL_TEMPLATE_MEMBERSHIP",
  str_host: "DOCUSEAL_TEMPLATE_STR_HOST",
  commercial: "DOCUSEAL_TEMPLATE_COMMERCIAL",
  contractor: "DOCUSEAL_TEMPLATE_CONTRACTOR",
  va_contractor: "DOCUSEAL_TEMPLATE_VA_CONTRACTOR",
  // The "V2 Hourly" VA agreement template.
  va_contractor_hourly: "DOCUSEAL_TEMPLATE_VA_CONTRACTOR_HOURLY",
};

/** DocuSeal checkbox on the commercial template — hyphen is U+2011, not ASCII. */
export const COMMERCIAL_AUTO_PAY_FIELD = "Auto\u2011Card or ACH";

/** §3.3 walkthrough threshold blank on the commercial template (Company field). */
export const COMMERCIAL_SQFT_THRESHOLD = 5000;

/** §10.2 placement-fee blank on the commercial template (Client number field). */
export const COMMERCIAL_LIQUIDATED_DAMAGES = 5000;

// ─── Config resolution (app_secrets → env), cached ────────────────────────────

// Cache secrets with a short TTL — NOT forever. app_secrets exists so ops can
// repoint things (e.g. swap a DocuSeal template) at runtime; a warm serverless
// instance holding stale values indefinitely defeats that.
const SECRET_TTL_MS = 60_000;
const secretCache = new Map<string, { value: string; expires: number }>();

async function resolveSecret(name: string): Promise<string> {
  const hit = secretCache.get(name);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = "";
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch {
    /* fall through to env */
  }
  if (!value) value = (process.env[name] || "").trim();
  secretCache.set(name, { value, expires: Date.now() + SECRET_TTL_MS });
  return value;
}

export async function getDocusealWebhookSecret(): Promise<string> {
  return resolveSecret("DOCUSEAL_WEBHOOK_SECRET");
}

/** Fetch the (blank) template PDF URL for an audience — used for in-app preview. */
export async function getAgreementPreviewUrl(audience: AgreementAudience): Promise<string | null> {
  const { token, baseUrl, templateId } = await getConfig(audience);
  // no-store: Next 14 caches GET fetches in the Data Cache (persists across
  // deploys) — a swapped template would keep serving the old document.
  const res = await fetch(`${baseUrl}/templates/${templateId}`, {
    headers: { "X-Auth-Token": token },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const t = await res.json().catch(() => null);
  const docs = (t?.documents || []) as Array<{ url?: string }>;
  return docs[0]?.url || null;
}

async function getConfig(audience: AgreementAudience): Promise<{
  token: string;
  baseUrl: string;
  templateId: string;
}> {
  const [token, baseUrlRaw, templateId] = await Promise.all([
    resolveSecret("DOCUSEAL_API_TOKEN"),
    resolveSecret("DOCUSEAL_BASE_URL"),
    resolveSecret(AUDIENCE_TEMPLATE_SECRET[audience]),
  ]);
  if (!token) throw new Error("DocuSeal is not configured (missing DOCUSEAL_API_TOKEN).");
  if (!templateId) throw new Error(`No DocuSeal template configured for "${audience}".`);
  const baseUrl = (baseUrlRaw || "https://api.docuseal.com").replace(/\/+$/, "");
  return { token, baseUrl, templateId };
}

// ─── Per-audience field pre-fill builders ─────────────────────────────────────
//
// Keys are the EXACT DocuSeal template field names (signer-role fields only —
// the Company/Representative side is left for our countersignature). Pass the
// result as `values` to sendAgreement so the signer just reviews + signs.

const today = () => new Date().toISOString().slice(0, 10);
const dollars = (cents: number | null | undefined) => Number((Number(cents || 0) / 100).toFixed(2));
function compact(
  v: Record<string, string | number | boolean | undefined | null>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined || val === null || val === "") continue;
    out[k] = val;
  }
  return out;
}

/** One-Time Service Agreement (role: Client). */
export function buildOneTimeValues(b: {
  name?: string; email: string; phone?: string; serviceDate?: string; address?: string;
  totalCents?: number; depositCents?: number; balanceCents?: number;
}): Record<string, string | number | boolean> {
  return compact({
    "Service Date": b.serviceDate,
    "Client Name": b.name,
    "Service Address": b.address,
    "Phone": b.phone,
    "Email": b.email,
    "Selected service type": true,
    "Total Service Fee": b.totalCents != null ? dollars(b.totalCents) : undefined,
    "Deposit Amount": b.depositCents != null ? dollars(b.depositCents) : undefined,
    "Balance Due": b.balanceCents != null ? dollars(b.balanceCents) : undefined,
  });
}

/**
 * Exhibit A — the schedule of sites and rates a commercial agreement covers.
 *
 * Each rate here came from a walkthrough: someone stood in the building,
 * measured it, and priced it from what they found. This renders that into the
 * one place the client actually signs, so the agreement and the booking flow
 * quote the same number instead of the agreement carrying a single
 * account-level rate that no site is actually serviced at.
 *
 * Sites without a firm price are listed as pending rather than omitted — a
 * schedule that quietly drops the unpriced locations reads as complete when
 * it is not.
 */
export interface ExhibitASite {
  nickname: string;
  address?: string | null;
  sqft?: number | null;
  facilityType?: string | null;
  scopeLevel?: string | null;
  crewSize?: number | null;
  firmPriceCents?: number | null;
  cadence?: string | null;
  excluded?: boolean;
  exclusionNote?: string | null;
}

export function buildExhibitA(sites: ExhibitASite[]): {
  text: string;
  totalPerVisitCents: number;
  pricedCount: number;
  pendingCount: number;
} {
  const lines: string[] = [];
  let total = 0;
  let priced = 0;
  let pending = 0;

  for (const s of sites) {
    const bits = [
      s.sqft ? `${s.sqft.toLocaleString()} sq ft` : null,
      s.facilityType || null,
      s.scopeLevel ? `${s.scopeLevel} scope` : null,
      s.crewSize ? `crew of ${s.crewSize}` : null,
      s.cadence || null,
    ].filter(Boolean).join(" · ");

    if (s.excluded) {
      pending += 1;
      lines.push(
        `${s.nickname}${s.address ? ` — ${s.address}` : ""}` +
        `${bits ? ` (${bits})` : ""}: NOT SERVICEABLE. ${s.exclusionNote || "A site survey found a condition outside our scope of service."}`,
      );
      continue;
    }
    if (s.firmPriceCents && s.firmPriceCents > 0) {
      priced += 1;
      total += s.firmPriceCents;
      lines.push(
        `${s.nickname}${s.address ? ` — ${s.address}` : ""}` +
        `${bits ? ` (${bits})` : ""}: $${(s.firmPriceCents / 100).toFixed(2)} per visit`,
      );
    } else {
      pending += 1;
      lines.push(
        `${s.nickname}${s.address ? ` — ${s.address}` : ""}` +
        `${bits ? ` (${bits})` : ""}: rate pending site walkthrough`,
      );
    }
  }

  return {
    text: lines.length ? lines.join("\n") : "No sites on this account yet.",
    totalPerVisitCents: total,
    pricedCount: priced,
    pendingCount: pending,
  };
}

function prettyLabel(s?: string | null): string {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function netDaysFromTerms(terms?: string | null): number {
  switch (String(terms || "")) {
    case "net_15":
      return 15;
    case "net_30":
      return 30;
    case "net_45":
      return 45;
    default:
      return 0;
  }
}

function billingCycleLabel(method?: string | null, cycle?: string | null): string {
  if (method === "auto_pay") return "Auto-Pay";
  switch (String(cycle || "monthly")) {
    case "per_visit":
      return "per visit";
    case "weekly":
      return "weekly";
    case "biweekly":
      return "biweekly";
    default:
      return "monthly";
  }
}

function serviceWindow(start?: string | null, end?: string | null): string {
  const a = String(start || "").trim();
  const b = String(end || "").trim();
  if (a && b) return `${a}\u2013${b}`;
  return a || b || "TBD";
}

function clientTypeLabel(accountType?: string | null): string {
  const t = String(accountType || "").trim().toLowerCase();
  if (t === "office") return "office business";
  if (t === "partnership") return "partnership";
  return "business";
}

export interface CommercialSitePrefill extends ExhibitASite {
  serviceWindowStart?: string | null;
  serviceWindowEnd?: string | null;
  walkthroughCompleted?: boolean;
  startDate?: string | null;
}

/**
 * Commercial Cleaning Services Agreement (template 5636550, role: Client).
 *
 * Field names must match the DocuSeal template exactly. Unused Site 2 / Site 3
 * slots are filled with N/A so required blanks on the form still complete.
 */
export function buildCommercialValues(b: {
  businessName: string;
  contactName?: string | null;
  email: string;
  phone?: string | null;
  address?: string | null;
  accountType?: string | null;
  billingMethod?: "auto_pay" | "invoiced" | string | null;
  invoiceCycle?: string | null;
  netTerms?: string | null;
  sites: CommercialSitePrefill[];
}): Record<string, string | number | boolean> {
  const t = today();
  const name = b.contactName || b.businessName;
  const phone = String(b.phone || "").trim() || "000-000-0000";
  const autoPay = b.billingMethod === "auto_pay";
  const invoiced = b.billingMethod === "invoiced";
  const slots: Array<Record<string, string | number | boolean>> = [];
  const filled = b.sites.slice(0, 3);
  const extras = b.sites.slice(3);

  for (let i = 0; i < 3; i++) {
    const s = filled[i];
    const n = i + 1;
    if (!s) {
      slots.push({
        [`Site${n} Nickname`]: "N/A",
        [`Site${n} Facility Type`]: "N/A",
        [`Site${n} Address`]: "N/A",
        [`Site${n} SqFt`]: 0,
        [`Site${n} Scope Level`]: "N/A",
        [`Site${n} Frequency`]: "N/A",
        [`Site${n} Service Window`]: "N/A",
        [`Site${n} Rate`]: 0,
        [`Site${n} Start Date`]: t,
      });
      continue;
    }
    let frequency = s.cadence || "TBD";
    if (n === 3 && extras.length) {
      const extraList = extras
        .map((x) => `${x.nickname}${x.firmPriceCents ? ` ($${dollars(x.firmPriceCents)}/visit)` : ""}`)
        .join("; ");
      frequency = `${frequency}. Additional sites: ${extraList}`;
    }
    slots.push({
      [`Site${n} Nickname`]: s.nickname,
      [`Site${n} Facility Type`]: prettyLabel(s.facilityType) || "Commercial",
      [`Site${n} Address`]: s.address || b.address || "TBD",
      [`Site${n} SqFt`]: Number(s.sqft || 0),
      [`Site${n} Scope Level`]: prettyLabel(s.scopeLevel) || "Standard",
      [`Site${n} Frequency`]: frequency,
      [`Site${n} Service Window`]: serviceWindow(s.serviceWindowStart, s.serviceWindowEnd),
      [`Site${n} Rate`]: s.firmPriceCents != null ? dollars(s.firmPriceCents) : 0,
      [`Site${n} Start Date`]: s.startDate || t,
    });
  }

  const walkthroughYes = filled.some((s) => s.walkthroughCompleted);
  const merged: Record<string, string | number | boolean | undefined | null> = {
    "Effective Date": t,
    Client: b.businessName || name,
    "Client Type": clientTypeLabel(b.accountType),
    [COMMERCIAL_AUTO_PAY_FIELD]: autoPay,
    "Billing Cycle": billingCycleLabel(b.billingMethod, b.invoiceCycle),
    "Net Days": netDaysFromTerms(b.netTerms),
    "Days from Invoice Date": invoiced,
    "Liquidated Damages": COMMERCIAL_LIQUIDATED_DAMAGES,
    "Client Printed Name": name,
    "Client Date": t,
    "Billing Contact Name": name,
    "Billing Contact Email": b.email,
    "Billing Contact Phone": phone,
    "Primary Site Contact Name": name,
    "Primary Site Contact Email": b.email,
    "Primary Site Contact Phone": phone,
    "Walkthrough Completed": walkthroughYes ? "Yes" : "N/A",
  };
  for (const slot of slots) Object.assign(merged, slot);
  return compact(merged);
}

export interface HostPropertyPrefill {
  nickname?: string | null;
  address?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  rate?: number | null;
  introRate?: number | null;
  introEndDate?: string | null;
  linen?: boolean;
  restock?: boolean;
  notes?: string | null;
}

export type HostFieldPrefill = { name: string; default_value: string | number | boolean };

const HOST_LINEN_FIELDS = ["Linen laundry", "Linen laundry2", "Linen laundry3"] as const;
const HOST_RESTOCK_FIELDS = ["Restock", "Restock2", "Restock3"] as const;

function bedsBaths(bedrooms?: number | null, bathrooms?: number | null): string {
  const beds = bedrooms == null ? "—" : String(bedrooms);
  const baths = bathrooms == null ? "—" : String(bathrooms);
  return `${beds} bed / ${baths} bath`;
}

/**
 * Repeatable Part Two slots on the host template share field names (three
 * "Property Nickname" fields, etc.). DocuSeal's `values` object cannot address
 * those separately, so we emit them as a `fields` array in document order.
 */
export function buildHostPropertyFields(properties: HostPropertyPrefill[]): HostFieldPrefill[] {
  const t = today();
  const extras = properties.slice(3);
  const fields: HostFieldPrefill[] = [];
  for (let i = 0; i < 3; i++) {
    const p = properties[i];
    const empty = !p;
    let notes = empty ? "Not applicable" : p.notes || "";
    if (i === 2 && extras.length) {
      const extraList = extras
        .map((x) => `${x.nickname || x.address || "Property"}${x.rate != null ? ` ($${Number(x.rate)})` : ""}`)
        .join("; ");
      notes = [notes, `Additional properties: ${extraList}`].filter(Boolean).join(". ");
    }
    const rate = empty ? 0 : Number(p.rate ?? 0);
    const intro = empty ? 0 : Number(p.introRate ?? p.rate ?? 0);
    fields.push(
      { name: "Property Nickname", default_value: empty ? "N/A" : p.nickname || p.address || "Property" },
      { name: "Bedrooms/Bathrooms", default_value: empty ? "N/A" : bedsBaths(p.bedrooms, p.bathrooms) },
      { name: "Property Address", default_value: empty ? "N/A" : p.address || "TBD" },
      { name: "Standard Rate", default_value: rate },
      { name: "Intro Rate", default_value: intro },
      { name: "Intro End Date", default_value: empty ? t : p.introEndDate || t },
      { name: HOST_LINEN_FIELDS[i], default_value: empty ? "No" : p.linen ? "Yes" : "No" },
      { name: HOST_RESTOCK_FIELDS[i], default_value: empty ? "No" : p.restock ? "Yes" : "No" },
      { name: "Notes/Scope", default_value: notes || "Standard turnover" },
    );
  }
  if (extras.length) {
    fields.push({ name: "Additional Option", default_value: true });
  }
  return fields;
}

/** Host Partnership Agreement (template 5636800, role: Host). */
export function buildHostValues(h: {
  name?: string;
  company?: string;
  email: string;
  entityType?: "individual" | "entity" | string | null;
  propertyNickname?: string;
  rate?: number | null;
  rateEndDate?: string | null;
  linen?: string;
  notes?: string;
}): Record<string, string | number | boolean> {
  const t = today();
  const hostName = h.company || h.name;
  return compact({
    "Agreement Title": "Host Partnership Agreement",
    "Confidential Notice": "CONFIDENTIAL",
    "Effective Date": t,
    "Host/Entity Name": hostName,
    "Host/Entity": hostName,
    "Host Email": h.email,
    "Guarantor Name": h.name || hostName,
    "Guarantor Date": t,
  });
}

/** Recurring Service & Membership Agreement (role: Member). */
export function buildMembershipValues(m: {
  name?: string; email: string; serviceAddress?: string; plan?: string;
  membershipRateCents?: number; oneTimeRateCents?: number; firstServiceDate?: string;
  cardLast4?: string; initialDeepClean?: string;
}): Record<string, string | number | boolean> {
  const t = today();
  return compact({
    "Effective Date": t,
    "Member Name": m.name,
    "Service Address": m.serviceAddress,
    "Plan / Frequency": m.plan,
    "Membership Rate": m.membershipRateCents != null ? dollars(m.membershipRateCents) : undefined,
    "One‑Time Rate": m.oneTimeRateCents != null ? dollars(m.oneTimeRateCents) : undefined,
    "Initial Deep Clean": m.initialDeepClean,
    "First Service Date": m.firstServiceDate,
    "Card on File (last 4)": m.cardLast4,
    "Name": m.name,
    "Email": m.email,
    "Date": t,
  });
}

/** Contractor / VA Independent Contractor Agreement (role: Contractor). */
export function buildContractorValues(c: {
  name?: string; legalName?: string; email: string; phone?: string; address?: string;
}): Record<string, string | number | boolean> {
  const t = today();
  // "Mobile Number" is a NUMBER-type field → a formatted phone string maps to 0.
  // Pass digits only so the actual number renders.
  const digits = c.phone ? String(c.phone).replace(/\D/g, "") : "";
  return compact({
    "Contractor Name": c.name,
    "Full Name": c.name,
    // Legal name defaults to the full name when not explicitly provided.
    "Legal Name": c.legalName || c.name,
    "Full Address": c.address,
    "Mobile Number": digits ? Number(digits) : undefined,
    "Email": c.email,
    "Date": t,
  });
}

// ─── Submission ───────────────────────────────────────────────────────────────

export interface SendAgreementInput {
  audience: AgreementAudience;
  email: string;
  name?: string;
  /** Prefill template fields by name, e.g. { "Service Date": "2026-07-01" }. */
  values?: Record<string, string | number | boolean>;
  /** Override the signer role (defaults to AUDIENCE_ROLE[audience]). */
  role?: string;
  /** DocuSeal emails the signer (true) vs. return a link only (false). Default true. */
  sendEmail?: boolean;
  /** Optional back-references for the tracking row. */
  bookingId?: string;
  hostEmail?: string;
  cleanerId?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
  /** When true, the caller owns the docuseal_submissions tracking row. */
  skipTracking?: boolean;
  /** Drawn signature as a data:image/png;base64 URL — rendered in the doc. */
  signatureImage?: string;
  /** Repeatable fields that share a name (host Part Two slots). Applied in order. */
  fields?: HostFieldPrefill[];
}

export interface SendAgreementResult {
  ok: true;
  submissionId: string | null;
  signingUrl: string | null;
  recordId: string | null;
}

/** Build a public signing URL from a submitter slug when no embed src is returned. */
function signingUrlFromSlug(baseUrl: string, slug: string | null | undefined): string | null {
  if (!slug) return null;
  // The signer-facing host mirrors the API host (api.docuseal.com → docuseal.com).
  const host = baseUrl.replace("api.docuseal.com", "docuseal.com").replace(/^https?:\/\/api\./, "https://");
  return `${host.replace(/\/+$/, "")}/s/${slug}`;
}

/**
 * Create a DocuSeal submission for one external signer and record it. The
 * company counter-signer (if any) is configured on the template itself.
 */
// ─── Company counter-signer + per-audience completed-submission specs ─────────

async function companyInfo(): Promise<{ name: string; rep: string; email: string }> {
  const [name, rep, email] = await Promise.all([
    resolveSecret("DOCUSEAL_COMPANY_NAME"),
    resolveSecret("DOCUSEAL_COMPANY_REP"),
    resolveSecret("DOCUSEAL_COMPANY_EMAIL"),
  ]);
  return {
    name: name || "NovaraCleaning LLC",
    rep: rep || "Malik Sannie",
    email: email || "hello@novaracleaning.com",
  };
}

interface CompanyInfo { name: string; rep: string; email: string }
interface SignerInfo { name: string; email: string }

interface AudienceSpec {
  signerRole: string;
  /** Signature fields on the signer role to auto-fill with their typed name. */
  signerSignatures?: string[];
  /** Optional "Initials" field on the signer role. */
  signerInitials?: string;
  /** The signer's date field name (defaults to "Date"). */
  signerDateField?: string;
  /** Signer-role fields that carry COMPANY info (e.g. the VA template's
   *  "Authorized Rep" line sits on the Contractor submitter). */
  signerCompanyValues?: (c: CompanyInfo) => Record<string, string | number>;
  /** The second submitter role (the execution/company page) + its field values. */
  companyRole: string;
  companyValues: (c: CompanyInfo, signer: SignerInfo) => Record<string, string | number>;
  /** A signature-type field that lives on the COMPANY role but represents the
   *  SIGNER's signature (e.g. the one-time template's execution page keeps the
   *  customer's "Signature" slot on the Company submitter). When set, a drawn
   *  signature image (or the typed name fallback) is rendered here. */
  companySignatureField?: string;
  /** Host agreement also has a Guarantor role. */
  guarantorRole?: string;
}

const AUDIENCE_SPECS: Record<AgreementAudience, AudienceSpec> = {
  // One-Time execution page. The template's FIELD NAMES do NOT match their
  // on-page positions, so we map by the actual slot each field renders in
  // (verified against the generated PDF):
  //   field "Company"        → Client/Customer · Full Name
  //   field "Full Name"      → Client/Customer · Email
  //   field "Representative" → Client/Customer · Date
  //   field "Signature"      → Client/Customer · Signature (cursive)
  //   field "Email"          → Organization · Date
  //   field "Date"           → Organization · Signature (date-type, holds text)
  one_time: {
    signerRole: "Client",
    companyRole: "Company",
    // The customer's signature slot lives on the Company submitter (see field-
    // mapping note above). sendAgreement fills it with the drawn signature
    // image when one is provided, else the typed name.
    companySignatureField: "Signature",
    companyValues: (c, s) => ({
      "Company": s.name,                 // Customer Full Name
      "Full Name": s.email,              // Customer Email
      "Representative": today(),          // Customer Date
      "Signature": s.name || s.email,     // Customer Signature
      "Email": today(),                   // Organization Date
      "Date": c.rep,                      // Organization Signature (rep name)
    }),
  },
  str_host: {
    signerRole: "Host",
    signerSignatures: ["Host Signature", "Guarantor Signature"],
    signerDateField: "Host Date",
    companyRole: "Company",
    companyValues: (c) => ({
      "Company Name": c.name,
      "Authorized Rep": c.rep,
      "Authorized Rep Title": "Owner",
      "Company Signature": c.rep,
      "Company Acceptance": c.rep,
      "Printed Name": c.rep,
      Date: today(),
    }),
  },
  commercial: {
    signerRole: "Client",
    signerSignatures: ["Client Signature"],
    signerDateField: "Client Date",
    companyRole: "Company",
    companyValues: (c) => ({
      "Square Feet Threshold": COMMERCIAL_SQFT_THRESHOLD,
      "Company Printed Name": c.rep,
      "Company Date": today(),
      "Company Signature": c.rep,
    }),
  },
  membership: {
    signerRole: "Member",
    signerSignatures: ["Signature"],
    signerInitials: "Initials",
    companyRole: "Company",
    companyValues: (c) => ({ "Date": today(), "Signature": c.rep }),
  },
  contractor: {
    signerRole: "Contractor",
    signerSignatures: ["Signature"],
    companyRole: "Company",
    companyValues: (c) => ({ "Effective Date": today(), "Name": c.rep, "Title": "Owner", "Signature": c.rep, "Date": today() }),
  },
  // VA Independent Contractor Agreement (V2) — template 4943110 fields:
  //   Contractor: "Contractor Name", "Full Name", "Authorized Rep",
  //               "Contractor Date", "Contractor Signature"
  //   Company:    "Effective Date", "Company Date", "Company Signature"
  va_contractor: {
    signerRole: "Contractor",
    signerSignatures: ["Contractor Signature"],
    signerDateField: "Contractor Date",
    // The "Authorized Rep" line sits on the Contractor submitter but carries
    // the company representative's printed name.
    signerCompanyValues: (c) => ({ "Authorized Rep": c.rep }),
    companyRole: "Company",
    companyValues: (c) => ({
      "Effective Date": today(),
      "Company Date": today(),
      "Company Signature": c.rep,
    }),
  },
  // VA Independent Contractor Agreement — "V2 Hourly" (template 5081719).
  //   Contractor: "Contractor Name", "Authorized Representative", "Effective
  //               Date", "Date", "Contractor Signature"
  //   Company:    "Company Full Name", "Company Signature"
  va_contractor_hourly: {
    signerRole: "Contractor",
    signerSignatures: ["Contractor Signature"],
    signerDateField: "Date",
    signerCompanyValues: (c) => ({ "Authorized Representative": c.rep, "Effective Date": today() }),
    companyRole: "Company",
    companyValues: (c) => ({
      "Company Full Name": c.name,
      "Company Signature": c.rep,
    }),
  },
};

// Fetch the template's field names per submitter role so we can drop values
// whose fields don't exist on the CURRENT template revision. DocuSeal rejects
// unknown field names, so without this, re-uploading/replacing a template
// (field renames) silently breaks every send until the code catches up.
async function templateFieldsByRole(
  baseUrl: string,
  token: string,
  templateId: string,
): Promise<Record<string, Set<string>> | null> {
  try {
    const res = await fetch(`${baseUrl}/templates/${templateId}`, {
      headers: { "X-Auth-Token": token },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const t = await res.json().catch(() => null);
    const roleByUuid = new Map<string, string>();
    for (const s of (t?.submitters || []) as Array<{ uuid?: string; name?: string }>) {
      if (s.uuid && s.name) roleByUuid.set(s.uuid, s.name);
    }
    const map: Record<string, Set<string>> = {};
    for (const f of (t?.fields || []) as Array<{ name?: string; submitter_uuid?: string }>) {
      if (!f.name) continue;
      const role = roleByUuid.get(f.submitter_uuid || "") || "";
      (map[role] ||= new Set()).add(f.name);
    }
    return Object.keys(map).length ? map : null;
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
}

/**
 * Create + COMPLETE the agreement (all fields filled on every role, including
 * signatures) and email the customer a copy of the finished document. We treat
 * the booking/onboarding acceptance as the signature, so the customer receives
 * a completed copy rather than a sign request (spec: "completed document sent
 * as a copy across all docs"). The company side is auto-signed by the rep.
 */
export async function sendAgreement(input: SendAgreementInput): Promise<SendAgreementResult> {
  if (!input.email) throw new Error("A signer email is required.");
  const { token, baseUrl, templateId } = await getConfig(input.audience);
  const spec = AUDIENCE_SPECS[input.audience];
  const co = await companyInfo();
  const role = input.role || spec.signerRole;
  const name = input.name || "";

  // Signer fields: the caller's data values + auto signature(s)/initials/date.
  // A drawn signature image (data URL) renders the actual signature; otherwise
  // we fall back to the typed name (DocuSeal renders it in a signature font).
  const signerValues: Record<string, string | number | boolean> = {
    ...(input.values || {}),
    ...(spec.signerCompanyValues ? spec.signerCompanyValues(co) : {}),
  };
  const sigValue =
    input.signatureImage && /^data:image\/(png|jpe?g);base64,/.test(input.signatureImage)
      ? input.signatureImage
      : name || "Accepted electronically";
  for (const f of spec.signerSignatures || []) signerValues[f] = sigValue;
  if (spec.signerInitials && name) signerValues[spec.signerInitials] = initialsOf(name);
  const dateField = spec.signerDateField || "Date";
  if (!(dateField in signerValues)) signerValues[dateField] = today();

  let companyValues: Record<string, string | number | boolean> =
    spec.companyValues(co, { name, email: input.email });

  // Some templates (e.g. one-time) keep the SIGNER's signature slot on the
  // Company submitter — render the drawn signature image (or typed-name
  // fallback) there so the executed document shows the customer's mark.
  if (spec.companySignatureField) {
    companyValues[spec.companySignatureField] = sigValue;
  }

  // Drop values whose field names don't exist on the CURRENT template
  // revision — DocuSeal rejects unknown fields, so a re-uploaded template
  // with renamed fields would otherwise break every send.
  const fieldsByRole = await templateFieldsByRole(baseUrl, token, templateId);
  const keepKnown = (
    values: Record<string, string | number | boolean>,
    roleName: string,
  ): Record<string, string | number | boolean> => {
    const known = fieldsByRole?.[roleName];
    if (!known) return values;
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(values)) {
      if (known.has(k)) out[k] = v;
      else console.warn(`[docuseal] dropping value for unknown field "${k}" (role ${roleName}, template ${templateId})`);
    }
    return out;
  };
  const filteredSignerValues = keepKnown(signerValues, role);
  companyValues = keepKnown(companyValues, spec.companyRole);

  const knownSignerFields = fieldsByRole?.[role];
  const signerFields = (input.fields || []).filter((f) => {
    if (!knownSignerFields) return true;
    return knownSignerFields.has(f.name);
  });

  const submitters: Array<Record<string, unknown>> = [
    {
      role,
      email: input.email,
      ...(name ? { name } : {}),
      completed: true,
      send_email: input.sendEmail !== false, // emails the customer the completed copy
      values: filteredSignerValues,
      ...(signerFields.length ? { fields: signerFields } : {}),
    },
    {
      role: spec.companyRole,
      email: co.email,
      name: co.name,
      completed: true,
      send_email: false,
      values: companyValues,
    },
  ];
  if (spec.guarantorRole) {
    submitters.push({
      role: spec.guarantorRole,
      email: input.email,
      ...(name ? { name } : {}),
      completed: true,
      send_email: false,
      values: { "Guarantor Name": name || co.name, "Guarantor Signature": name || "Accepted electronically", "Guarantor Date": today() },
    });
  }

  const res = await fetch(`${baseUrl}/submissions`, {
    method: "POST",
    headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: Number(templateId),
      send_email: input.sendEmail !== false,
      submitters,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (body && (body.error || body.message)) || `DocuSeal returned ${res.status}`;
    throw new Error(`DocuSeal send failed: ${msg}`);
  }

  // POST /submissions returns an array of submitter objects.
  const respSubmitters: any[] = Array.isArray(body) ? body : body?.submitters || [];
  const first = respSubmitters[0] || {};
  const submissionId = String(first.submission_id ?? body?.id ?? "") || null;
  const signingUrl =
    first.embed_src || signingUrlFromSlug(baseUrl, first.slug) || null;

  // Record the send (best-effort — never block on the tracking write).
  let recordId: string | null = null;
  if (input.skipTracking) {
    return { ok: true, submissionId, signingUrl, recordId: null };
  }
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("docuseal_submissions")
      .insert({
        audience: input.audience,
        template_id: templateId,
        submission_id: submissionId,
        submitter_email: input.email,
        submitter_name: input.name || null,
        role,
        status: "completed",
        signing_url: signingUrl,
        booking_id: input.bookingId || null,
        host_email: input.hostEmail || null,
        cleaner_id: input.cleanerId || null,
        created_by: input.createdBy || null,
        metadata: input.metadata || {},
      })
      .select("id")
      .single();
    recordId = (data?.id as string) || null;
  } catch {
    /* tracking is best-effort */
  }

  return { ok: true, submissionId, signingUrl, recordId };
}

function firstPdfUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  if (typeof rec.combined_document_url === "string" && rec.combined_document_url) {
    return rec.combined_document_url;
  }
  const lists: unknown[] = [];
  if (Array.isArray(rec.documents)) lists.push(...rec.documents);
  if (Array.isArray(rec.submitters)) {
    for (const s of rec.submitters) {
      if (s && typeof s === "object") {
        const docs = (s as Record<string, unknown>).documents;
        if (Array.isArray(docs)) lists.push(...docs);
      }
    }
  }
  for (const d of lists) {
    if (d && typeof d === "object") {
      const url = (d as Record<string, unknown>).url;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download the completed combined PDF for a DocuSeal submission as base64.
 * Completion can lag a moment after POST /submissions with completed:true.
 */
export async function downloadCompletedAgreementPdf(submissionId: string): Promise<string | null> {
  if (!submissionId) return null;
  const token = await resolveSecret("DOCUSEAL_API_TOKEN");
  const baseUrlRaw = await resolveSecret("DOCUSEAL_BASE_URL");
  if (!token) return null;
  const baseUrl = (baseUrlRaw || "https://api.docuseal.com").replace(/\/+$/, "");

  let url: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    try {
      const res = await fetch(`${baseUrl}/submissions/${submissionId}`, {
        headers: { "X-Auth-Token": token },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const body: unknown = await res.json().catch(() => null);
      url = firstPdfUrl(body);
      if (url) break;
    } catch {
      /* retry */
    }
  }
  if (!url) return null;

  const pdf = await fetch(url, { cache: "no-store" });
  if (!pdf.ok) return null;
  const buf = Buffer.from(await pdf.arrayBuffer());
  if (buf.length < 500) return null;
  return buf.toString("base64");
}
