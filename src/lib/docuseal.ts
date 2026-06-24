// ─── DocuSeal e-signature client (server-only) ────────────────────────────────
//
// Sends NovaraCleaning agreements for e-signature via DocuSeal and records each
// send in public.docuseal_submissions. One engine serves every audience:
//   one_time      → One-Time Service Agreement   (signer role: Client)
//   membership    → Recurring & Membership Agr.   (signer role: Member)
//   str_host      → Host Partnership Agreement     (signer role: Host)
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
  | "contractor"
  | "va_contractor";

/** Default DocuSeal submitter role per audience (matches the templates). */
export const AUDIENCE_ROLE: Record<AgreementAudience, string> = {
  one_time: "Client",
  membership: "Member",
  str_host: "Host",
  contractor: "Contractor",
  va_contractor: "Contractor",
};

const AUDIENCE_TEMPLATE_SECRET: Record<AgreementAudience, string> = {
  one_time: "DOCUSEAL_TEMPLATE_ONE_TIME",
  membership: "DOCUSEAL_TEMPLATE_MEMBERSHIP",
  str_host: "DOCUSEAL_TEMPLATE_STR_HOST",
  contractor: "DOCUSEAL_TEMPLATE_CONTRACTOR",
  va_contractor: "DOCUSEAL_TEMPLATE_VA_CONTRACTOR",
};

// ─── Config resolution (app_secrets → env), cached ────────────────────────────

const secretCache = new Map<string, string>();

async function resolveSecret(name: string): Promise<string> {
  if (secretCache.has(name)) return secretCache.get(name) || "";
  let value = "";
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch {
    /* fall through to env */
  }
  if (!value) value = (process.env[name] || "").trim();
  secretCache.set(name, value);
  return value;
}

export async function getDocusealWebhookSecret(): Promise<string> {
  return resolveSecret("DOCUSEAL_WEBHOOK_SECRET");
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

/** Host Partnership Agreement (role: Host). */
export function buildHostValues(h: {
  name?: string; company?: string; email: string; entityType?: "individual" | "entity";
  propertyNickname?: string; rate?: number | null; rateEndDate?: string | null;
  linen?: string; notes?: string;
}): Record<string, string | number | boolean> {
  const t = today();
  return compact({
    "Effective Date": t,
    "Host/Entity Name": h.name,
    "Company Name": h.company,
    "Entity": h.entityType === "entity" ? "Business Entity" : "Individual",
    "Email": h.email,
    "Host/Entity": h.company || h.name,
    "Printed Name": h.name,
    "Date": t,
    "Property Nickname": h.propertyNickname,
    "Rate": h.rate != null ? Number(h.rate) : undefined,
    "Rate End Date": h.rateEndDate || undefined,
    "Linen Restock": h.linen,
    "Notes/Scope": h.notes,
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
  return compact({
    "Contractor Name": c.name,
    "Full Name": c.name,
    "Legal Name": c.legalName || c.name,
    "Full Address": c.address,
    "Mobile Number": c.phone,
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
  /** The second submitter role (the execution/company page) + its field values. */
  companyRole: string;
  companyValues: (c: CompanyInfo, signer: SignerInfo) => Record<string, string | number>;
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
    signerSignatures: ["Signature", "Host Signature"],
    companyRole: "Company Representative",
    companyValues: (c) => ({ "Signature": c.rep }),
    guarantorRole: "Guarantor",
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
  va_contractor: {
    signerRole: "Contractor",
    signerSignatures: ["Signature"],
    companyRole: "Company",
    companyValues: (c) => ({ "Effective Date": today(), "Name": c.rep, "Date": today(), "Signature": c.rep }),
  },
};

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
  const signerValues: Record<string, string | number | boolean> = { ...(input.values || {}) };
  for (const f of spec.signerSignatures || []) signerValues[f] = name || "Accepted electronically";
  if (spec.signerInitials && name) signerValues[spec.signerInitials] = initialsOf(name);
  if (!("Date" in signerValues)) signerValues["Date"] = today();

  const submitters: Array<Record<string, unknown>> = [
    {
      role,
      email: input.email,
      ...(name ? { name } : {}),
      completed: true,
      send_email: input.sendEmail !== false, // emails the customer the completed copy
      values: signerValues,
    },
    {
      role: spec.companyRole,
      email: co.email,
      name: co.name,
      completed: true,
      send_email: false,
      values: spec.companyValues(co, { name, email: input.email }),
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
