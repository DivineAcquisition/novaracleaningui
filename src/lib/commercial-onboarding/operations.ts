// ─── Commercial onboarding operations ──────────────────────────────────────
//
// The acts that move a commercial account forward: accepting the pricing,
// signing the agreement, configuring billing. These were written inline in
// the two public token routes (/api/proposal/[token] and
// /api/commercial-agreement/[token]). They live here now because the
// consolidated onboarding session performs the SAME acts on a different
// token, and two copies of "what happens when someone signs" is exactly the
// kind of divergence that ends with one path sending the certificate of
// insurance and the other not.
//
// Everything here takes an already-resolved record and an admin client. Token
// resolution stays in the routes, because each route's token means something
// different — one link, one meaning, checked where it is read.

import { sendCompanyCoi } from "@/lib/company-coi";
import { sendPartnershipMessage } from "@/lib/partnership-comms";
import { sendAgreement, buildCommercialValues } from "@/lib/docuseal";
import { resolveAppSecret, stripeCall, ensureCommercialCustomer } from "@/lib/stripe-rest";
import { money, type ProposalSite } from "@/lib/commercial-proposal";
import { generateAgreement } from "@/lib/commercial-agreement-server";

/** The service-role Supabase client, as the rest of this codebase types it. */
// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export const AGREEMENT_BUCKET = "commercial-agreements";

export const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export const INVOICE_CYCLES = ["per_visit", "weekly", "biweekly", "monthly"] as const;
export const NET_TERMS = ["on_receipt", "net_15", "net_30", "net_45", "none"] as const;

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
    userAgent: req.headers.get("user-agent")?.slice(0, 400) || null,
  };
}

export async function billingSnapshot(supabase: Admin, accountId: string) {
  const [{ data: state }, { data: profile }] = await Promise.all([
    supabase.rpc("commercial_billing_state", { p_account_id: accountId }),
    supabase
      .from("commercial_billing_profiles")
      .select("*")
      .eq("business_account_id", accountId)
      .maybeSingle(),
  ]);
  return { state: (state || null) as Row | null, profile: (profile || null) as Row | null };
}

// ─── Pricing review ────────────────────────────────────────────────────────

export interface ChangeRequestInput {
  proposal: Row;
  account: Row;
  note: string;
  byName: string;
}

/**
 * The client wants something different before anything binding happens.
 *
 * The version is left exactly as it was sent and its link is retired — a
 * revision becomes a NEW version, so the negotiation stays readable instead of
 * being overwritten in place.
 */
export async function requestProposalChanges(
  supabase: Admin,
  { proposal, account, note, byName }: ChangeRequestInput,
): Promise<{ ok: boolean; message: string }> {
  const { error } = await supabase
    .from("commercial_proposals")
    .update({
      status: "changes_requested",
      changes_requested_at: new Date().toISOString(),
      change_request_note: note,
      change_request_by_name: byName,
      token: null,
    })
    .eq("id", proposal.id as string);
  if (error) return { ok: false, message: error.message };

  const owner =
    (proposal.assigned_to_email as string | null) ||
    (account.assigned_va_email as string | null) ||
    null;
  if (owner) {
    await sendPartnershipMessage(supabase, {
      templateKey: "commercial_request_changes",
      trigger: "commercial-proposal.changes_requested",
      email: owner,
      role: "admin",
      accountId: String(proposal.business_account_id || "") || null,
      vars: {
        first_name: byName,
        business_name: String(account.business_name || "commercial proposal"),
        note,
      },
      subject: `Changes requested — ${String(account.business_name || "commercial proposal")} (v${proposal.version})`,
      html: [
        `<p><strong>${byName}</strong> asked for changes to proposal v${proposal.version} for <strong>${String(account.business_name || "")}</strong>.</p>`,
        `<p style="border-left:3px solid #7c3aed;padding-left:12px;margin:16px 0;white-space:pre-wrap">${note.replace(/</g, "&lt;")}</p>`,
        `<p>Build the revised version in Commercial → Send Proposal. The current version has been retained and its link retired.</p>`,
      ].join(""),
    });
  }

  await supabase.from("events").insert({
    event_type: "commercial.proposal.changes_requested",
    source: "commercial-proposal",
    summary:
      `${byName} requested changes to proposal v${proposal.version} for ` +
      `${String(account.business_name || "an account")}: ${note.slice(0, 240)}`,
    data: {
      proposal_id: proposal.id,
      account_id: proposal.business_account_id,
      version: proposal.version,
      note,
      assigned_to: owner,
    },
  });

  return {
    ok: true,
    message: "Thanks — that's with your account manager now. We'll send a revised proposal shortly.",
  };
}

export interface AcceptProposalInput {
  proposal: Row;
  account: Row;
  acceptedBy: string;
  acceptedEmail?: string;
  /** Pre-selected by admin. The client is not asked. */
  billingMethod: "auto_pay" | "invoiced";
  signerName?: string;
  signerEmail?: string;
  signerTitle?: string | null;
  ctx: RequestContext;
}

export interface AcceptProposalResult {
  ok: boolean;
  message?: string;
  agreementReady: boolean;
  agreementId: string | null;
  agreementToken: string | null;
  agreementError?: string | null;
  signerEmail: string | null;
}

/**
 * Record acceptance and build the agreement from what was just accepted.
 *
 * Acceptance stands even if the agreement fails to generate — it is the
 * client's act, not ours — so the failure is reported loudly rather than
 * rolled back into a silent nothing.
 */
export async function acceptProposal(
  supabase: Admin,
  input: AcceptProposalInput,
): Promise<AcceptProposalResult> {
  const { proposal, account, acceptedBy, billingMethod, ctx } = input;

  const { error } = await supabase
    .from("commercial_proposals")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by_name: acceptedBy,
      accepted_by_email: input.acceptedEmail || (proposal.recipient_email as string) || null,
      accepted_billing_method: billingMethod,
      accepted_ip: ctx.ip,
      accepted_user_agent: ctx.userAgent,
      token: null,
    })
    .eq("id", proposal.id as string)
    .eq("status", "sent");
  if (error) {
    return {
      ok: false,
      message: error.message,
      agreementReady: false,
      agreementId: null,
      agreementToken: null,
      signerEmail: null,
    };
  }

  const signerName = input.signerName || acceptedBy;
  const signerEmail =
    input.signerEmail ||
    input.acceptedEmail ||
    (proposal.recipient_email as string) ||
    (account.email as string) ||
    "";

  const built = await generateAgreement(supabase, {
    proposalId: String(proposal.id),
    signerName,
    signerEmail,
    signerTitle: input.signerTitle || null,
    billingMethod,
    actorName: acceptedBy,
  });

  await supabase.from("events").insert({
    event_type: "commercial.proposal.accepted",
    source: "commercial-proposal",
    summary:
      `${acceptedBy} accepted proposal v${proposal.version} for ${String(account.business_name || "an account")} — ` +
      `${money(Number(proposal.total_per_visit_cents || 0))} per visit, billed by ` +
      `${billingMethod === "auto_pay" ? "Auto-Pay" : "invoice"}.` +
      (built.ok ? " Agreement generated." : ` Agreement NOT generated: ${built.error}`),
    data: {
      proposal_id: proposal.id,
      account_id: proposal.business_account_id,
      version: proposal.version,
      accepted_by: acceptedBy,
      billing_method: billingMethod,
      agreement_id: built.agreementId || null,
      agreement_error: built.ok ? null : built.error,
    },
  });

  return {
    ok: true,
    agreementReady: built.ok,
    agreementId: built.ok ? (built.agreementId as string) : null,
    agreementToken: built.ok ? (built.token as string) : null,
    agreementError: built.ok ? null : built.error || "Agreement could not be generated.",
    signerEmail: signerEmail || null,
  };
}

// ─── Signature ─────────────────────────────────────────────────────────────

export interface SignAgreementInput {
  agreement: Row;
  account: Row;
  signerName: string;
  signerTitle?: string | null;
  signatureDataUrl: string;
  pdfBase64: string;
  ctx: RequestContext;
  /**
   * Mint a fresh token on the agreement so the signer can carry on to billing
   * on the agreement link. The consolidated session does NOT want this: it
   * carries the signer itself, and a second live link to the same account is a
   * second way in that nobody is watching.
   */
  mintContinuation: boolean;
}

export interface SignAgreementResult {
  ok: boolean;
  status: number;
  message: string;
  alreadySigned?: boolean;
  continuationToken?: string | null;
  coiSent?: boolean;
  coiError?: string | null;
}

/** Validate a signature payload before anything is written. */
export function validateSignature(input: {
  signerName: string;
  agreedToTerms: unknown;
  signatureDataUrl: string;
  pdfBase64: string;
}): string | null {
  if (input.signerName.length < 2) return "Please enter your full legal name to sign.";
  if (input.agreedToTerms !== true) return "Please confirm you've read and agree to the agreement.";
  if (!/^data:image\/png;base64,/.test(input.signatureDataUrl)) {
    return "Please draw your signature in the box above.";
  }
  if (input.pdfBase64.length < 500) {
    return "The signed document didn't generate correctly. Please reload and try again.";
  }
  return null;
}

/**
 * Execute the agreement.
 *
 * The signature is the moment. Storing the document, mirroring to DocuSeal and
 * sending our certificate of insurance all happen after it and none of them
 * can undo it.
 */
export async function signCommercialAgreement(
  supabase: Admin,
  input: SignAgreementInput,
): Promise<SignAgreementResult> {
  const { agreement: a, account: acct, ctx } = input;
  const accountId = String(a.business_account_id);

  if (a.status === "signed") {
    return {
      ok: true,
      status: 200,
      alreadySigned: true,
      message: "This agreement is already signed — you're all set.",
    };
  }

  const now = new Date().toISOString();
  const stamp = Date.now();
  const base = `${accountId}/${a.id}-${stamp}`;
  const pdfPath = `${base}.pdf`;
  const sigPath = `${base}-signature.png`;

  const { error: pdfErr } = await supabase.storage
    .from(AGREEMENT_BUCKET)
    .upload(pdfPath, Buffer.from(input.pdfBase64, "base64"), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (pdfErr) {
    return { ok: false, status: 502, message: `Could not store the signed agreement: ${pdfErr.message}` };
  }
  await supabase.storage
    .from(AGREEMENT_BUCKET)
    .upload(sigPath, Buffer.from(input.signatureDataUrl.split(",")[1] || "", "base64"), {
      contentType: "image/png",
      upsert: true,
    });

  // Minted before the signature lands so the row is never left without a
  // working link. If minting fails the existing token is kept rather than
  // nulled — a signer stranded immediately after signing is far worse than a
  // link that lives a little longer, and the status guard below already makes
  // a second signature impossible.
  let continuation: string | null = null;
  if (input.mintContinuation) {
    const { data: minted } = await supabase.rpc("mint_commercial_token");
    continuation = String(minted || "") || String(a.token || "") || null;
  }

  const { error } = await supabase
    .from("commercial_agreements")
    .update({
      status: "signed",
      signed_at: now,
      signed_by_name: input.signerName,
      signed_by_title: input.signerTitle || (a.signer_title as string) || null,
      signed_ip: ctx.ip,
      signed_user_agent: ctx.userAgent,
      signature_path: sigPath,
      document_path: pdfPath,
      countersigned_at: (a.countersigned_at as string) || now,
      countersigned_by_name: (a.countersigned_by_name as string) || "Malik Sannie",
      // The session owns the link when it is driving, so the agreement's own
      // token is retired rather than replaced.
      token: continuation,
      expires_at: continuation ? new Date(Date.now() + 7 * 86400_000).toISOString() : a.expires_at,
      updated_at: now,
    })
    .eq("id", a.id as string)
    .eq("status", "pending");
  if (error) return { ok: false, status: 400, message: error.message };

  // Open the billing profile in the method the agreement was signed under, so
  // the account reads "billing pending" rather than nothing at all.
  await supabase.from("commercial_billing_profiles").upsert(
    {
      business_account_id: accountId,
      agreement_id: a.id,
      method: a.billing_method,
      invoice_cycle: a.billing_method === "invoiced" ? (a.invoice_cycle as string) || "monthly" : null,
      net_terms: a.billing_method === "invoiced" ? (a.net_terms as string) || "on_receipt" : null,
      updated_at: now,
    },
    { onConflict: "business_account_id" },
  );

  await supabase.from("events").insert({
    event_type: "commercial.agreement.signed",
    source: "commercial-agreement",
    summary:
      `${input.signerName} signed the commercial services agreement for ${String(acct.business_name || "an account")} — ` +
      `${money(Number(a.total_per_visit_cents || 0))} per visit across all sites. ` +
      `Billing: ${a.billing_method === "auto_pay" ? "Auto-Pay" : "invoiced"}.`,
    data: {
      agreement_id: a.id,
      account_id: accountId,
      proposal_id: a.proposal_id,
      signed_by: input.signerName,
      billing_method: a.billing_method,
    },
  });

  // Mirror into DocuSeal so the commercial trail sits beside every other
  // signed document in the app. Best effort — never blocks the signature.
  try {
    const sites = (a.exhibit_a_sites as ProposalSite[]) || [];
    const res = await sendAgreement({
      audience: "one_time",
      email: String(a.signer_email || acct.email || ""),
      name: input.signerName,
      sendEmail: false,
      signatureImage: input.signatureDataUrl,
      values: buildCommercialValues({
        businessName: String(acct.business_name || ""),
        contactName: input.signerName,
        email: String(a.signer_email || acct.email || ""),
        phone: (acct.phone as string) || null,
        address:
          [acct.address, acct.city, acct.state, acct.zip_code].filter(Boolean).join(", ") ||
          String(acct.business_name || ""),
        sites: sites.map((si) => ({
          nickname: si.nickname,
          address: si.address,
          sqft: si.sqft,
          facilityType: si.facility_type,
          scopeLevel: si.scope_level,
          crewSize: si.crew_size,
          firmPriceCents: si.per_visit_price_cents,
          cadence: si.frequency,
        })),
      }),
      metadata: { business_account_id: accountId, kind: "commercial", agreement_id: a.id },
    });
    await supabase
      .from("commercial_agreements")
      .update({ docuseal_submission_id: res.submissionId || null })
      .eq("id", a.id as string);
  } catch (err) {
    console.error("[commercial-onboarding] docuseal mirror failed", (err as Error).message);
  }

  // Our certificate of insurance goes out on signature, not on request.
  let coiSent = false;
  let coiError: string | null = null;
  if (acct.requires_coi_on_file !== false) {
    const result = await sendCompanyCoi(supabase, {
      accountId,
      to: String(a.signer_email || acct.email || "") || null,
      agreementId: String(a.id),
      triggerSource: "agreement_signature",
      sentByName: "System",
    });
    coiSent = result.ok;
    coiError = result.ok ? null : result.error || null;
  }

  return {
    ok: true,
    status: 200,
    message: "Signed. One last step: how you'd like to be billed.",
    continuationToken: continuation,
    coiSent,
    coiError,
  };
}

// ─── Billing ───────────────────────────────────────────────────────────────

export interface InvoicedBillingInput {
  agreement: Row;
  account: Row;
  billingContactName?: string;
  billingContactEmail: string;
  billingContactPhone?: string;
  invoiceCycle?: string;
  netTerms?: string;
  poNumber?: string;
  invoiceNotes?: string;
  confirmedByName: string;
  ctx: RequestContext;
}

/** Invoiced: confirm who gets the invoice and on what terms. Collects nothing. */
export async function configureInvoicedBilling(
  supabase: Admin,
  input: InvoicedBillingInput,
): Promise<{ ok: boolean; status: number; message: string }> {
  const { agreement: a, account: acct } = input;
  const accountId = String(a.business_account_id);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.billingContactEmail)) {
    return {
      ok: false,
      status: 400,
      message: "A billing contact email is needed so invoices reach the right person.",
    };
  }

  const cycle = (INVOICE_CYCLES as readonly string[]).includes(String(input.invoiceCycle))
    ? String(input.invoiceCycle)
    : (a.invoice_cycle as string) || "monthly";
  const terms = (NET_TERMS as readonly string[]).includes(String(input.netTerms))
    ? String(input.netTerms)
    : (a.net_terms as string) || "on_receipt";

  const { error } = await supabase.from("commercial_billing_profiles").upsert(
    {
      business_account_id: accountId,
      agreement_id: a.id,
      method: "invoiced",
      billing_contact_name: input.billingContactName || null,
      billing_contact_email: input.billingContactEmail,
      billing_contact_phone: input.billingContactPhone || null,
      invoice_cycle: cycle,
      net_terms: terms,
      po_number: input.poNumber || null,
      invoice_notes: input.invoiceNotes || null,
      confirmed_at: new Date().toISOString(),
      confirmed_by_name: input.confirmedByName,
      confirmed_ip: input.ctx.ip,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_account_id" },
  );
  if (error) return { ok: false, status: 400, message: error.message };

  await supabase.from("events").insert({
    event_type: "commercial.billing.configured",
    source: "commercial-onboarding",
    summary: `${String(acct.business_name || "An account")} confirmed invoiced billing — ${cycle}, ${terms.replace(/_/g, " ")}, to ${input.billingContactEmail}.`,
    data: {
      account_id: accountId,
      agreement_id: a.id,
      method: "invoiced",
      invoice_cycle: cycle,
      net_terms: terms,
    },
  });

  return {
    ok: true,
    status: 200,
    message: "Billing confirmed. Invoices will go to your billing contact on the terms above.",
  };
}

export interface AutoPaySetupInput {
  agreement: Row;
  account: Row;
  /** Where Stripe sends them back to — the session, or the agreement page. */
  returnUrl: string;
  billingContactName?: string;
  billingContactEmail?: string;
}

/**
 * Auto-Pay: a Stripe SETUP session. No money moves. It saves a card or bank
 * account for future billing, which is what a commercial account expects when
 * it agrees to Auto-Pay — not a charge on the day they sign.
 */
export async function openAutoPaySetup(
  supabase: Admin,
  input: AutoPaySetupInput,
): Promise<{ ok: boolean; status: number; message?: string; url?: string }> {
  const { agreement: a, account: acct } = input;
  const accountId = String(a.business_account_id);

  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return {
      ok: false,
      status: 503,
      message: "Card setup is temporarily unavailable. Your account manager will follow up.",
    };
  }

  const email = String(a.signer_email || acct.email || "");
  if (!email) {
    return { ok: false, status: 400, message: "No email on file to attach a payment method to." };
  }

  try {
    const customerId = await ensureCommercialCustomer(stripeKey, {
      accountId,
      email,
      businessName: String(acct.business_name || ""),
      existingId: (acct.stripe_customer_id as string) || null,
    });
    await supabase.from("business_accounts").update({ stripe_customer_id: customerId }).eq("id", accountId);

    const session = await stripeCall(stripeKey, "POST", "checkout/sessions", {
      mode: "setup",
      customer: customerId,
      "payment_method_types[0]": "card",
      "payment_method_types[1]": "us_bank_account",
      success_url: `${input.returnUrl}?billing=done`,
      cancel_url: `${input.returnUrl}?billing=cancelled`,
      "metadata[business_account_id]": accountId,
      "metadata[agreement_id]": String(a.id),
      "metadata[kind]": "commercial_setup",
    });

    await supabase.from("commercial_billing_profiles").upsert(
      {
        business_account_id: accountId,
        agreement_id: a.id,
        method: "auto_pay",
        stripe_customer_id: customerId,
        setup_session_id: String(session.id || ""),
        billing_contact_name: input.billingContactName || (a.signed_by_name as string) || null,
        billing_contact_email: input.billingContactEmail || email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_account_id" },
    );

    return { ok: true, status: 200, url: String(session.url || "") };
  } catch (err) {
    return { ok: false, status: 502, message: `Could not open card setup: ${(err as Error).message}` };
  }
}

/**
 * Resolve the saved payment method after the Stripe redirect returns.
 *
 * Stripe's setup session only tells us the method once we go and ask, so this
 * runs when the client lands back on the page rather than waiting on a webhook
 * — a signer sitting on a "still setting up" screen is a support ticket.
 */
export async function refreshAutoPayFromStripe(
  supabase: Admin,
  { agreement, account }: { agreement: Row; account: Row },
): Promise<void> {
  const accountId = String(agreement.business_account_id);
  const { data: profile } = await supabase
    .from("commercial_billing_profiles")
    .select("*")
    .eq("business_account_id", accountId)
    .maybeSingle();
  const p = (profile || null) as Row | null;

  if (!p || p.method !== "auto_pay" || p.stripe_payment_method_id || !p.setup_session_id) return;

  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return;

  try {
    const session = await stripeCall(stripeKey, "GET", `checkout/sessions/${String(p.setup_session_id)}`);
    const setupIntentId = session?.setup_intent as string | undefined;
    if (!setupIntentId) return;
    const intent = await stripeCall(stripeKey, "GET", `setup_intents/${setupIntentId}`);
    const pmId = intent?.payment_method as string | undefined;
    if (!pmId) return;

    const pm = await stripeCall(stripeKey, "GET", `payment_methods/${pmId}`);
    const type = pm?.type === "us_bank_account" ? "us_bank_account" : "card";
    await supabase
      .from("commercial_billing_profiles")
      .update({
        stripe_payment_method_id: pmId,
        payment_method_type: type,
        payment_method_brand:
          type === "card" ? pm?.card?.brand || null : pm?.us_bank_account?.bank_name || null,
        payment_method_last4:
          type === "card" ? pm?.card?.last4 || null : pm?.us_bank_account?.last4 || null,
        payment_method_added_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        confirmed_by_name: (agreement.signed_by_name as string) || "Client",
        updated_at: new Date().toISOString(),
      })
      .eq("business_account_id", accountId);

    await supabase.from("events").insert({
      event_type: "commercial.billing.configured",
      source: "commercial-onboarding",
      summary: `${String(account.business_name || "An account")} added an Auto-Pay method (${type === "card" ? "card" : "bank account"}).`,
      data: { account_id: accountId, agreement_id: agreement.id, method: "auto_pay", payment_method_type: type },
    });
  } catch (err) {
    console.error("[commercial-onboarding] auto-pay refresh", (err as Error).message);
  }
}
