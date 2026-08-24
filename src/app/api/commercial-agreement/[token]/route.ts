// ─── /api/commercial-agreement/[token] ─────────────────────────────────────
//
// The back end for the tokenized commercial agreement page — signature, then
// billing setup, in one session.
//
//   GET                     the agreement as generated: Exhibit A, term,
//                           billing method, and where in the flow this signer
//                           currently is.
//   POST { action:"sign" }  record the e-signature, store the executed PDF,
//                           countersign, deliver our certificate of insurance,
//                           and open the billing step.
//   POST { action:"setup_billing" }
//                           Auto-Pay  → a Stripe setup session (no charge)
//                           Invoiced  → confirm contact, cycle and Net terms
//   POST { action:"billing_status" }
//                           resolve the saved payment method after the Stripe
//                           redirect returns.
//
// Two things here are deliberate rather than incidental:
//
//   * BILLING IS NOT A CHARGE. Auto-Pay opens a Stripe *setup* session, which
//     saves a card or bank account and moves no money. Invoiced collects no
//     payment identifier at all. Both are complete: an invoiced account is
//     never left waiting on a card it was never going to have.
//   * The token is burned on signature. A forwarded email cannot produce a
//     second executed agreement, but the billing step stays reachable through
//     a short-lived continuation token so the signer isn't dropped mid-flow.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { AGREEMENT_COLS } from "@/lib/commercial-agreement-server";
import { sendCompanyCoi } from "@/lib/company-coi";
import { sendAgreement, buildCommercialValues } from "@/lib/docuseal";
import { resolveAppSecret, stripeCall, ensureCommercialCustomer } from "@/lib/stripe-rest";
import { agreementUrl, money, type ProposalSite } from "@/lib/commercial-proposal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "commercial-agreements";

interface Resolved {
  ok: boolean;
  status: number;
  reason: string;
  message: string;
  agreement: Record<string, unknown> | null;
}

function refuse(status: number, reason: string, message: string): Resolved {
  return { ok: false, status, reason, message, agreement: null };
}

/**
 * Resolve a signing link.
 *
 * A signed agreement still resolves — the signer may be returning from the
 * Stripe redirect to finish billing, and dropping them at "invalid link"
 * halfway through setup is how an account ends up signed but unbillable.
 */
async function resolveToken(token: string): Promise<Resolved> {
  if (!token || token.length < 32) {
    return refuse(404, "invalid", "This signing link isn't valid.");
  }

  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("commercial_agreements")
    .select(`${AGREEMENT_COLS}, exhibit_a_sites`)
    .eq("token", token)
    .maybeSingle();
  const agreement = (data || null) as Record<string, unknown> | null;

  if (!agreement) {
    return refuse(
      404,
      "invalid",
      "This signing link has already been used or is no longer valid. If you've already signed, " +
        "you're all set — nothing else is needed.",
    );
  }

  const status = String(agreement.status || "");
  if (status === "voided" || status === "superseded") {
    return refuse(
      410,
      "superseded",
      "This version of the agreement has been replaced. Your account manager will send the current one.",
    );
  }
  if (status === "declined") {
    return refuse(409, "declined", "This agreement was declined. Reply to us if that was a mistake.");
  }

  if (status === "pending") {
    const expires = agreement.expires_at ? new Date(String(agreement.expires_at)).getTime() : 0;
    if (expires && expires < Date.now()) {
      return refuse(
        410,
        "expired",
        "This signing link has expired. Reply to the email and we'll send a fresh one.",
      );
    }
  }

  return { ok: true, status: 200, reason: "ok", message: "", agreement };
}

async function billingSnapshot(accountId: string) {
  const supabase = getAdminSupabase();
  const [{ data: state }, { data: profile }] = await Promise.all([
    supabase.rpc("commercial_billing_state", { p_account_id: accountId }),
    supabase.from("commercial_billing_profiles").select("*").eq("business_account_id", accountId).maybeSingle(),
  ]);
  return { state: state || null, profile: profile || null };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const resolved = await resolveToken(token);
  if (!resolved.ok || !resolved.agreement) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, message: resolved.message },
      { status: resolved.status },
    );
  }

  const supabase = getAdminSupabase();
  const a = resolved.agreement;

  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, phone, address, city, state, zip_code, requires_coi_on_file")
    .eq("id", a.business_account_id as string)
    .maybeSingle();

  if (a.status === "pending" && !a.first_viewed_at) {
    await supabase
      .from("commercial_agreements")
      .update({ first_viewed_at: new Date().toISOString() })
      .eq("id", a.id as string);
  }

  const billing = await billingSnapshot(String(a.business_account_id));

  return NextResponse.json({
    ok: true,
    agreement: {
      id: a.id,
      status: a.status,
      signerName: a.signer_name,
      signerEmail: a.signer_email,
      signerTitle: a.signer_title,
      term: a.term,
      billingMethod: a.billing_method,
      invoiceCycle: a.invoice_cycle,
      netTerms: a.net_terms,
      exhibitAText: a.exhibit_a_text,
      totalPerVisitCents: a.total_per_visit_cents,
      signedAt: a.signed_at,
      signedByName: a.signed_by_name,
      countersignedAt: a.countersigned_at,
      countersignedByName: a.countersigned_by_name,
      expiresAt: a.expires_at,
    },
    sites: (a.exhibit_a_sites as ProposalSite[]) || [],
    account: account || null,
    billing: billing.state,
    billingProfile: billing.profile,
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const resolved = await resolveToken(token);
  if (!resolved.ok || !resolved.agreement) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, message: resolved.message },
      { status: resolved.status },
    );
  }

  const supabase = getAdminSupabase();
  const a = resolved.agreement;
  const accountId = String(a.business_account_id);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, phone, address, city, state, zip_code, stripe_customer_id, requires_coi_on_file")
    .eq("id", accountId)
    .maybeSingle();
  const acct = (account || {}) as Record<string, unknown>;

  // ── Sign ───────────────────────────────────────────────────────────────
  if (action === "sign") {
    if (a.status === "signed") {
      return NextResponse.json({
        ok: true,
        outcome: "already_signed",
        message: "This agreement is already signed — you're all set.",
      });
    }

    const signedBy = clip(body.signerName, 120);
    if (signedBy.length < 2) {
      return NextResponse.json(
        { ok: false, message: "Please enter your full legal name to sign." },
        { status: 400 },
      );
    }
    if (body.agreedToTerms !== true) {
      return NextResponse.json(
        { ok: false, message: "Please confirm you've read and agree to the agreement." },
        { status: 400 },
      );
    }

    const signature = clip(body.signatureDataUrl, 400_000);
    if (!/^data:image\/png;base64,/.test(signature)) {
      return NextResponse.json(
        { ok: false, message: "Please draw your signature in the box above." },
        { status: 400 },
      );
    }

    const pdfBase64 = clip(body.pdfBase64, 12_000_000);
    if (pdfBase64.length < 500) {
      return NextResponse.json(
        { ok: false, message: "The signed document didn't generate correctly. Please reload and try again." },
        { status: 400 },
      );
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const userAgent = req.headers.get("user-agent")?.slice(0, 400) || null;
    const now = new Date().toISOString();
    const stamp = Date.now();

    // The executed document and the signature image, in the private bucket.
    // Retained permanently: nothing sweeps this prefix.
    const base = `${accountId}/${a.id}-${stamp}`;
    const pdfPath = `${base}.pdf`;
    const sigPath = `${base}-signature.png`;

    const pdfBytes = Buffer.from(pdfBase64, "base64");
    const { error: pdfErr } = await supabase.storage
      .from(BUCKET)
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (pdfErr) {
      return NextResponse.json(
        { ok: false, message: `Could not store the signed agreement: ${pdfErr.message}` },
        { status: 502 },
      );
    }
    await supabase.storage
      .from(BUCKET)
      .upload(sigPath, Buffer.from(signature.split(",")[1] || "", "base64"), {
        contentType: "image/png",
        upsert: true,
      });

    // The signature is the moment. Everything after this is best-effort and
    // must not be able to undo it.
    const { error } = await supabase
      .from("commercial_agreements")
      .update({
        status: "signed",
        signed_at: now,
        signed_by_name: signedBy,
        signed_by_title: clip(body.signerTitle, 120) || (a.signer_title as string) || null,
        signed_ip: ip,
        signed_user_agent: userAgent,
        signature_path: sigPath,
        document_path: pdfPath,
        // Countersigned at execution, matching how every other agreement in
        // the app is company-signed.
        countersigned_at: (a.countersigned_at as string) || now,
        countersigned_by_name: (a.countersigned_by_name as string) || "Malik Sannie",
        token: null,
        updated_at: now,
      })
      .eq("id", a.id as string)
      .eq("status", "pending");
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    // A continuation token so the billing step survives the Stripe redirect
    // without leaving a live signing link in the wild.
    const { data: minted } = await supabase.rpc("mint_commercial_token");
    const continuation = String(minted || "");
    if (continuation) {
      await supabase.from("commercial_agreements")
        .update({ token: continuation, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() })
        .eq("id", a.id as string);
    }

    // Open the billing profile in the method the agreement was signed under,
    // so the account shows "billing pending" rather than nothing at all.
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
        `${signedBy} signed the commercial services agreement for ${String(acct.business_name || "an account")} — ` +
        `${money(Number(a.total_per_visit_cents || 0))} per visit across all sites. ` +
        `Billing: ${a.billing_method === "auto_pay" ? "Auto-Pay" : "invoiced"}.`,
      data: {
        agreement_id: a.id,
        account_id: accountId,
        proposal_id: a.proposal_id,
        signed_by: signedBy,
        billing_method: a.billing_method,
      },
    });

    // Mirror into DocuSeal so the commercial agreement trail continues to sit
    // beside every other signed document in the app.
    try {
      const sites = (a.exhibit_a_sites as ProposalSite[]) || [];
      await sendAgreement({
        audience: "one_time",
        email: String(a.signer_email || acct.email || ""),
        name: signedBy,
        sendEmail: false,
        signatureImage: signature,
        values: buildCommercialValues({
          businessName: String(acct.business_name || ""),
          contactName: signedBy,
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
      }).then(async (res) => {
        await supabase.from("commercial_agreements")
          .update({ docuseal_submission_id: res.submissionId || null })
          .eq("id", a.id as string);
      });
    } catch (err) {
      console.error("[commercial-agreement] docuseal mirror failed", (err as Error).message);
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

    return NextResponse.json({
      ok: true,
      outcome: "signed",
      continuationUrl: continuation ? agreementUrl(continuation) : null,
      billingMethod: a.billing_method,
      coiSent,
      coiError,
      message: "Signed. One last step: how you'd like to be billed.",
    });
  }

  // ── Billing setup ──────────────────────────────────────────────────────
  if (action === "setup_billing") {
    if (a.status !== "signed") {
      return NextResponse.json(
        { ok: false, message: "Billing is set up after the agreement is signed." },
        { status: 409 },
      );
    }

    const method = body.method === "auto_pay" ? "auto_pay" : "invoiced";

    // ── Invoiced: confirm terms, collect nothing ────────────────────────
    if (method === "invoiced") {
      const contactEmail = clip(body.billingContactEmail, 200);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
        return NextResponse.json(
          { ok: false, message: "A billing contact email is needed so invoices reach the right person." },
          { status: 400 },
        );
      }
      const cycle = ["per_visit", "weekly", "biweekly", "monthly"].includes(String(body.invoiceCycle))
        ? String(body.invoiceCycle)
        : (a.invoice_cycle as string) || "monthly";
      const terms = ["on_receipt", "net_15", "net_30", "net_45", "none"].includes(String(body.netTerms))
        ? String(body.netTerms)
        : (a.net_terms as string) || "on_receipt";

      const { error } = await supabase.from("commercial_billing_profiles").upsert(
        {
          business_account_id: accountId,
          agreement_id: a.id,
          method: "invoiced",
          billing_contact_name: clip(body.billingContactName, 120) || null,
          billing_contact_email: contactEmail,
          billing_contact_phone: clip(body.billingContactPhone, 40) || null,
          invoice_cycle: cycle,
          net_terms: terms,
          po_number: clip(body.poNumber, 80) || null,
          invoice_notes: clip(body.invoiceNotes, 2000) || null,
          confirmed_at: new Date().toISOString(),
          confirmed_by_name: (a.signed_by_name as string) || clip(body.billingContactName, 120) || "Client",
          confirmed_ip:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_account_id" },
      );
      if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

      const billing = await billingSnapshot(accountId);
      await supabase.from("events").insert({
        event_type: "commercial.billing.configured",
        source: "commercial-agreement",
        summary: `${String(acct.business_name || "An account")} confirmed invoiced billing — ${cycle}, ${terms.replace(/_/g, " ")}, to ${contactEmail}.`,
        data: { account_id: accountId, agreement_id: a.id, method: "invoiced", invoice_cycle: cycle, net_terms: terms },
      });

      return NextResponse.json({
        ok: true,
        outcome: "billing_configured",
        billing: billing.state,
        message: "Billing confirmed. Invoices will go to your billing contact on the terms above.",
      });
    }

    // ── Auto-Pay: a setup session. No charge. ───────────────────────────
    const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, message: "Card setup is temporarily unavailable. Your account manager will follow up." },
        { status: 503 },
      );
    }

    const email = String(a.signer_email || acct.email || "");
    if (!email) {
      return NextResponse.json({ ok: false, message: "No email on file to attach a payment method to." }, { status: 400 });
    }

    try {
      const customerId = await ensureCommercialCustomer(stripeKey, {
        accountId,
        email,
        businessName: String(acct.business_name || ""),
        existingId: (acct.stripe_customer_id as string) || null,
      });
      await supabase.from("business_accounts").update({ stripe_customer_id: customerId }).eq("id", accountId);

      const returnUrl = token ? agreementUrl(token) : agreementUrl(String(a.token || ""));
      const session = await stripeCall(stripeKey, "POST", "checkout/sessions", {
        mode: "setup",
        customer: customerId,
        "payment_method_types[0]": "card",
        "payment_method_types[1]": "us_bank_account",
        success_url: `${returnUrl}?billing=done`,
        cancel_url: `${returnUrl}?billing=cancelled`,
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
          billing_contact_name: clip(body.billingContactName, 120) || (a.signed_by_name as string) || null,
          billing_contact_email: clip(body.billingContactEmail, 200) || email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_account_id" },
      );

      return NextResponse.json({ ok: true, outcome: "redirect", url: session.url });
    } catch (err) {
      return NextResponse.json(
        { ok: false, message: `Could not open card setup: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  }

  // ── Resolve the saved method after the Stripe redirect ─────────────────
  if (action === "billing_status") {
    const { data: profile } = await supabase
      .from("commercial_billing_profiles")
      .select("*")
      .eq("business_account_id", accountId)
      .maybeSingle();
    const p = (profile || null) as Record<string, unknown> | null;

    if (p && p.method === "auto_pay" && !p.stripe_payment_method_id && p.setup_session_id) {
      const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
      if (stripeKey) {
        try {
          const session = await stripeCall(stripeKey, "GET", `checkout/sessions/${String(p.setup_session_id)}`);
          const setupIntentId = session?.setup_intent as string | undefined;
          if (setupIntentId) {
            const intent = await stripeCall(stripeKey, "GET", `setup_intents/${setupIntentId}`);
            const pmId = intent?.payment_method as string | undefined;
            if (pmId) {
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
                  confirmed_by_name: (a.signed_by_name as string) || "Client",
                  updated_at: new Date().toISOString(),
                })
                .eq("business_account_id", accountId);

              await supabase.from("events").insert({
                event_type: "commercial.billing.configured",
                source: "commercial-agreement",
                summary: `${String(acct.business_name || "An account")} added an Auto-Pay method (${type === "card" ? "card" : "bank account"}).`,
                data: { account_id: accountId, agreement_id: a.id, method: "auto_pay", payment_method_type: type },
              });
            }
          }
        } catch (err) {
          console.error("[commercial-agreement] billing_status", (err as Error).message);
        }
      }
    }

    const billing = await billingSnapshot(accountId);
    return NextResponse.json({ ok: true, billing: billing.state, billingProfile: billing.profile });
  }

  return NextResponse.json({ ok: false, message: `Unknown action "${action}".` }, { status: 400 });
}
