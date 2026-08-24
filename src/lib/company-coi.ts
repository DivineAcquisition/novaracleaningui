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

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

type Supa = ReturnType<typeof getAdminSupabase>;

export const COMPANY_COI_BUCKET = "company-coi";

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

  const doc = await currentCompanyCoi(supabase, args.accountId);
  const trigger = args.triggerSource || "manual";

  // Nothing current to send. Record the miss — a client who is owed a
  // certificate and did not get one is an obligation outstanding, and a
  // silent no-op is how that goes unnoticed until they ask.
  if (!doc || !doc.document_path || coiIsExpired(doc)) {
    await supabase.from("company_coi_deliveries").insert({
      business_account_id: args.accountId,
      company_coi_document_id: doc?.id || null,
      agreement_id: args.agreementId || null,
      sent_to: to,
      sent_by_name: args.sentByName || "System",
      trigger_source: trigger,
      status: "failed",
      failure_reason: !doc
        ? "No company certificate of insurance on file."
        : coiIsExpired(doc)
          ? "The company certificate on file has expired."
          : "The company certificate has no stored document.",
      certificate_expires_at: doc?.expiration_date || null,
    });

    await supabase.from("events").insert({
      event_type: "company_coi.delivery_failed",
      source: "company-coi",
      summary:
        `Could not send our certificate of insurance to ${acct.business_name} — ` +
        (!doc ? "none is on file." : coiIsExpired(doc) ? "the one on file has expired." : "the file is missing."),
      data: { account_id: args.accountId, agreement_id: args.agreementId || null, to },
    });

    return {
      ok: false,
      status: 409,
      error: !doc
        ? "No company certificate of insurance is on file to send. Upload one under Commercial → Compliance."
        : coiIsExpired(doc)
          ? "The company certificate on file has expired — upload the renewal before sending it to a client."
          : "The company certificate has no stored file.",
    };
  }

  // Attach the actual document.
  let base64 = "";
  const { data: file, error: dlError } = await supabase.storage
    .from(COMPANY_COI_BUCKET)
    .download(doc.document_path);
  if (dlError || !file) {
    await supabase.from("company_coi_deliveries").insert({
      business_account_id: args.accountId,
      company_coi_document_id: doc.id,
      agreement_id: args.agreementId || null,
      sent_to: to,
      sent_by_name: args.sentByName || "System",
      trigger_source: trigger,
      status: "failed",
      failure_reason: `Could not read the certificate file: ${dlError?.message || "not found"}`,
      certificate_expires_at: doc.expiration_date,
    });
    return { ok: false, status: 502, error: "Could not read the certificate file from storage." };
  }
  base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

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
    `— Novara Cleaning`,
  ].filter(Boolean);

  const { error: mailError } = await supabase.functions.invoke("admin-send-email", {
    body: {
      to,
      subject: `Certificate of insurance — NovaraCleaning LLC`,
      html: lines.map((l) => `<p>${l}</p>`).join(""),
      attachments: [
        {
          filename: doc.document_name || "novara-certificate-of-insurance.pdf",
          content: base64,
        },
      ],
    },
  });

  if (mailError) {
    await supabase.from("company_coi_deliveries").insert({
      business_account_id: args.accountId,
      company_coi_document_id: doc.id,
      agreement_id: args.agreementId || null,
      sent_to: to,
      sent_by_name: args.sentByName || "System",
      trigger_source: trigger,
      status: "failed",
      failure_reason: mailError.message,
      certificate_expires_at: doc.expiration_date,
    });
    return { ok: false, status: 502, error: `Could not send the certificate: ${mailError.message}` };
  }

  await supabase.from("company_coi_deliveries").insert({
    business_account_id: args.accountId,
    company_coi_document_id: doc.id,
    agreement_id: args.agreementId || null,
    sent_to: to,
    sent_by_name: args.sentByName || "System",
    trigger_source: trigger,
    status: "sent",
    certificate_expires_at: doc.expiration_date,
  });

  await supabase.from("business_accounts").update({
    company_coi_sent_at: new Date().toISOString(),
    company_coi_document_id: doc.id,
    updated_at: new Date().toISOString(),
  }).eq("id", args.accountId);

  await supabase.from("events").insert({
    event_type: "company_coi.delivered",
    source: "company-coi",
    summary: `Certificate of insurance sent to ${acct.business_name} (${to}) — valid through ${expires}.`,
    data: {
      account_id: args.accountId,
      agreement_id: args.agreementId || null,
      document_id: doc.id,
      to,
      trigger: trigger,
    },
  });

  return { ok: true, sentTo: to, documentId: doc.id };
}
