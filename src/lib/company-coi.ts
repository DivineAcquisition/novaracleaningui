// ─── Our own certificate of insurance, delivered to the client ─────────────
//
// Two different documents share the letters "COI" in this system, and keeping
// them apart matters:
//
//   commercial_coi_documents — certificates belonging to an ACCOUNT. Their
//     currency is what the dispatch gate enforces, and the compliance console
//     is where they are chased.
//
//   company_coi_documents — OUR certificate. A commercial client is entitled
//     to one on file per the agreement, and this is the code that puts it in
//     their hands on signature instead of leaving it to be asked for later.
//
// Delivery attaches the actual PDF rather than a link. A link into a private
// bucket expires; a certificate the client's insurance folder needs to hold
// for the life of the contract should not.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import {
  COMPANY_COI_CARRIER,
  COMPANY_COI_COVERAGE_NOTES,
  COMPANY_COI_DOCUMENT_PATH,
  COMPANY_COI_EFFECTIVE_DATE,
  COMPANY_COI_EXPIRATION_DATE,
  COMPANY_COI_FILENAME,
  COMPANY_COI_POLICY_NUMBER,
  COMPANY_COI_PUBLIC_HREF,
  COMPANY_COI_PUBLIC_PATH,
  isPublicCompanyCoiPath,
} from "@/lib/company-coi-public";

type Supa = ReturnType<typeof getAdminSupabase>;

export const COMPANY_COI_BUCKET = "company-coi";

export {
  COMPANY_COI_PUBLIC_HREF,
  COMPANY_COI_PUBLIC_PATH,
  isPublicCompanyCoiPath,
} from "@/lib/company-coi-public";

export interface CompanyCoiDocument {
  id: string;
  document_path: string | null;
  document_name: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  carrier: string | null;
  policy_number: string | null;
  coverage_notes: string | null;
  business_account_id: string | null;
  lifecycle: string;
}

const DOC_COLS =
  "id, document_path, document_name, document_size_bytes, effective_date, " +
  "expiration_date, carrier, policy_number, coverage_notes, business_account_id, " +
  "lifecycle, uploaded_by_name, created_at";

/**
 * The certificate to send this account.
 *
 * A certificate naming the client as additional insured beats the general
 * one — that is the document their risk team actually wants — so it is
 * preferred when present.
 */
export async function currentCompanyCoi(
  supabase: Supa,
  accountId?: string | null,
): Promise<CompanyCoiDocument | null> {
  if (accountId) {
    const { data } = await supabase
      .from("company_coi_documents")
      .select(DOC_COLS)
      .eq("business_account_id", accountId)
      .eq("lifecycle", "current")
      .maybeSingle();
    if (data) return data as unknown as CompanyCoiDocument;
  }
  const { data } = await supabase
    .from("company_coi_documents")
    .select(DOC_COLS)
    .is("business_account_id", null)
    .eq("lifecycle", "current")
    .maybeSingle();
  return (data as unknown as CompanyCoiDocument) || null;
}

export function coiIsExpired(doc: CompanyCoiDocument | null): boolean {
  if (!doc?.expiration_date) return true;
  return new Date(`${String(doc.expiration_date).slice(0, 10)}T23:59:59Z`).getTime() < Date.now();
}

/** The bundled ACORD 25, used when no current row is on file yet. */
export function bundledCompanyCoi(): CompanyCoiDocument {
  return {
    id: "d64f3143-a05d-4f9e-8c44-3c9051bd4e77",
    document_path: COMPANY_COI_DOCUMENT_PATH,
    document_name: COMPANY_COI_FILENAME,
    effective_date: COMPANY_COI_EFFECTIVE_DATE,
    expiration_date: COMPANY_COI_EXPIRATION_DATE,
    carrier: COMPANY_COI_CARRIER,
    policy_number: COMPANY_COI_POLICY_NUMBER,
    coverage_notes: COMPANY_COI_COVERAGE_NOTES,
    business_account_id: null,
    lifecycle: "current",
  };
}

async function readBundledCompanyCoiBytes(): Promise<Buffer | null> {
  const local = join(process.cwd(), "public", COMPANY_COI_PUBLIC_PATH);
  try {
    return await readFile(local);
  } catch {
    // Serverless hosts do not always ship public/ onto the function disk.
  }

  const bases = [
    process.env.NEXT_PUBLIC_COMMERCIAL_ORIGIN,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    "https://commercial.novaracleaning.com",
  ].filter((v): v is string => Boolean(v));

  for (const base of bases) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}${COMPANY_COI_PUBLIC_HREF}`);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // try the next origin
    }
  }
  return null;
}

async function readCompanyCoiBytes(
  supabase: Supa,
  doc: CompanyCoiDocument,
): Promise<Buffer | null> {
  if (isPublicCompanyCoiPath(doc.document_path)) {
    const bundled = await readBundledCompanyCoiBytes();
    if (bundled) return bundled;
  }

  if (doc.document_path && !isPublicCompanyCoiPath(doc.document_path)) {
    const { data: file, error } = await supabase.storage
      .from(COMPANY_COI_BUCKET)
      .download(doc.document_path);
    if (!error && file) return Buffer.from(await file.arrayBuffer());
  }

  return readBundledCompanyCoiBytes();
}

export interface SendCompanyCoiArgs {
  accountId: string;
  to?: string | null;
  agreementId?: string | null;
  triggerSource?: "agreement_signature" | "manual" | "renewal";
  sentByName?: string | null;
}

export interface SendCompanyCoiResult {
  ok: boolean;
  error?: string;
  status?: number;
  sentTo?: string;
  documentId?: string;
  skipped?: string;
}

/**
 * Deliver our current certificate to a client and record that we did.
 *
 * Never throws — a failure here must not roll back a signature that already
 * happened. Every outcome, including "we had nothing current to send", is
 * written to company_coi_deliveries so the gap is visible rather than silent.
 */
export async function sendCompanyCoi(
  supabase: Supa,
  args: SendCompanyCoiArgs,
): Promise<SendCompanyCoiResult> {
  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, requires_coi_on_file")
    .eq("id", args.accountId)
    .maybeSingle();
  if (!account) return { ok: false, error: "Account not found.", status: 404 };

  const acct = account as {
    business_name: string;
    contact_name: string | null;
    email: string | null;
    requires_coi_on_file: boolean | null;
  };

  const to = (args.to || acct.email || "").trim();
  if (!to) {
    return { ok: false, error: "No contact email on this account to send the certificate to.", status: 400 };
  }

  const stored = await currentCompanyCoi(supabase, args.accountId);
  const bundled = bundledCompanyCoi();
  const doc = stored && !coiIsExpired(stored) ? stored : (!stored ? bundled : stored);
  const trigger = args.triggerSource || "manual";
  const documentId = stored?.id || null;

  // Nothing current to send. Record the miss — a client who is owed a
  // certificate and did not get one is an obligation outstanding, and a
  // silent no-op is how that goes unnoticed until they ask.
  if (!doc || coiIsExpired(doc)) {
    await supabase.from("company_coi_deliveries").insert({
      business_account_id: args.accountId,
      company_coi_document_id: documentId,
      agreement_id: args.agreementId || null,
      sent_to: to,
      sent_by_name: args.sentByName || "System",
      trigger_source: trigger,
      status: "failed",
      failure_reason: !stored
        ? "No company certificate of insurance on file."
        : "The company certificate on file has expired.",
      certificate_expires_at: stored?.expiration_date || null,
    });

    await supabase.from("events").insert({
      event_type: "company_coi.delivery_failed",
      source: "company-coi",
      summary:
        `Could not send our certificate of insurance to ${acct.business_name} — ` +
        (!stored ? "none is on file." : "the one on file has expired."),
      data: { account_id: args.accountId, agreement_id: args.agreementId || null, to },
    });

    return {
      ok: false,
      status: 409,
      error: !stored
        ? "No company certificate of insurance is on file to send. Upload one under Commercial → Compliance."
        : "The company certificate on file has expired — upload the renewal before sending it to a client.",
    };
  }

  // Attach the actual document. A public: path (or a missing storage object)
  // falls back to the bundled ACORD 25 so a signature still sends a PDF.
  const bytes = await readCompanyCoiBytes(supabase, doc);
  if (!bytes) {
    await supabase.from("company_coi_deliveries").insert({
      business_account_id: args.accountId,
      company_coi_document_id: documentId,
      agreement_id: args.agreementId || null,
      sent_to: to,
      sent_by_name: args.sentByName || "System",
      trigger_source: trigger,
      status: "failed",
      failure_reason: "Could not read the certificate file.",
      certificate_expires_at: doc.expiration_date,
    });
    return { ok: false, status: 502, error: "Could not read the certificate file." };
  }
  const base64 = bytes.toString("base64");

  const expires = doc.expiration_date
    ? new Date(`${String(doc.expiration_date).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    })
    : "—";

  const lines = [
    `Hi ${acct.contact_name || "there"},`,
    `Attached is NovaraCleaning's current certificate of insurance for <strong>${acct.business_name}</strong>, as provided for in Section 8.1 of your service agreement.`,
    `Carrier: ${doc.carrier || "—"}${doc.policy_number ? ` · Policy ${doc.policy_number}` : ""}<br/>Valid through: ${expires}`,
    doc.coverage_notes ? `Coverage: ${doc.coverage_notes}` : "",
    `We renew before this lapses and send the updated certificate automatically — you shouldn't need to ask for it.`,
    `A copy is also at <a href="https://commercial.novaracleaning.com${COMPANY_COI_PUBLIC_HREF}">commercial.novaracleaning.com${COMPANY_COI_PUBLIC_HREF}</a>.`,
    `— Novara Cleaning`,
  ].filter(Boolean);

  const sent = await sendPartnershipMessage(supabase, {
    templateKey: "coi_delivery_client",
    trigger: `company-coi.${trigger}`,
    email: to,
    accountId: args.accountId,
    vars: {
      first_name: acct.contact_name || "there",
      business_name: acct.business_name,
      expires,
    },
    html: lines.map((l) => `<p>${l}</p>`).join(""),
    attachments: [
      {
        filename: doc.document_name || "novara-certificate-of-insurance.pdf",
        content: base64,
      },
    ],
  });
  const mailError = sent.emailed || sent.results.some((r) => r.channel === "email" && r.status === "sent")
    ? null
    : sent.results.find((r) => r.error)?.error || (sent.ok ? null : "Could not send the certificate");

  if (mailError) {
    await supabase.from("company_coi_deliveries").insert({
      business_account_id: args.accountId,
      company_coi_document_id: documentId,
      agreement_id: args.agreementId || null,
      sent_to: to,
      sent_by_name: args.sentByName || "System",
      trigger_source: trigger,
      status: "failed",
      failure_reason: mailError,
      certificate_expires_at: doc.expiration_date,
    });
    return { ok: false, status: 502, error: `Could not send the certificate: ${mailError}` };
  }

  await supabase.from("company_coi_deliveries").insert({
    business_account_id: args.accountId,
    company_coi_document_id: documentId,
    agreement_id: args.agreementId || null,
    sent_to: to,
    sent_by_name: args.sentByName || "System",
    trigger_source: trigger,
    status: "sent",
    certificate_expires_at: doc.expiration_date,
  });

  await supabase.from("business_accounts").update({
    company_coi_sent_at: new Date().toISOString(),
    ...(documentId ? { company_coi_document_id: documentId } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", args.accountId);

  await supabase.from("events").insert({
    event_type: "company_coi.delivered",
    source: "company-coi",
    summary: `Certificate of insurance sent to ${acct.business_name} (${to}) — valid through ${expires}.`,
    data: {
      account_id: args.accountId,
      agreement_id: args.agreementId || null,
      document_id: documentId,
      to,
      trigger: trigger,
    },
  });

  return { ok: true, sentTo: to, documentId: documentId || undefined };
}
