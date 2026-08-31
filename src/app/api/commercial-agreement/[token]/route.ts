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
import { agreementUrl, type ProposalSite } from "@/lib/commercial-proposal";
// Signature and billing are shared with the consolidated onboarding session —
// one implementation, so a signature through either door does the same things
// (store the document, countersign, send our certificate of insurance).
import {
  billingSnapshot,
  clip,
  configureInvoicedBilling,
  openAutoPaySetup,
  refreshAutoPayFromStripe,
  requestContext,
  signCommercialAgreement,
  validateSignature,
} from "@/lib/commercial-onboarding/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Retire the post-signature link once billing is actually configured.
 *
 * The continuation token exists for one reason: to carry a signer across the
 * Stripe redirect without leaving a live SIGNING link in circulation. Once
 * billing is set up there is nothing left to do on the page, and a link that
 * can still rewrite an account's billing details has outlived its purpose.
 */
async function retireContinuationToken(
  supabase: ReturnType<typeof getAdminSupabase>,
  agreement: Record<string, unknown>,
  billingState: unknown,
): Promise<void> {
  const configured = (billingState as { configured?: boolean } | null)?.configured === true;
  if (!configured || !agreement.token) return;
  await supabase
    .from("commercial_agreements")
    .update({ token: null, updated_at: new Date().toISOString() })
    .eq("id", agreement.id as string);
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

  const billing = await billingSnapshot(supabase, String(a.business_account_id));

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

  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, phone, address, city, state, zip_code, stripe_customer_id, requires_coi_on_file, account_type")
    .eq("id", accountId)
    .maybeSingle();
  const acct = (account || {}) as Record<string, unknown>;

  // ── Sign ───────────────────────────────────────────────────────────────
  if (action === "sign") {
    const signerName = clip(body.signerName, 120);
    const signatureDataUrl = clip(body.signatureDataUrl, 400_000);
    const pdfBase64 = clip(body.pdfBase64, 12_000_000);

    const invalid = validateSignature({
      signerName,
      agreedToTerms: body.agreedToTerms,
      signatureDataUrl,
      pdfBase64,
    });
    if (invalid) return NextResponse.json({ ok: false, message: invalid }, { status: 400 });

    const result = await signCommercialAgreement(supabase, {
      agreement: a,
      account: acct,
      signerName,
      signerTitle: clip(body.signerTitle, 120) || null,
      signatureDataUrl,
      pdfBase64,
      ctx: requestContext(req),
      // This route IS the signer's link, so it needs a continuation token to
      // survive the Stripe redirect and finish billing.
      mintContinuation: true,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    if (result.alreadySigned) {
      return NextResponse.json({ ok: true, outcome: "already_signed", message: result.message });
    }

    return NextResponse.json({
      ok: true,
      outcome: "signed",
      continuationUrl: result.continuationToken ? agreementUrl(result.continuationToken) : null,
      billingMethod: a.billing_method,
      coiSent: result.coiSent,
      coiError: result.coiError,
      message: result.message,
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

    if (method === "invoiced") {
      const result = await configureInvoicedBilling(supabase, {
        agreement: a,
        account: acct,
        billingContactName: clip(body.billingContactName, 120) || undefined,
        billingContactEmail: clip(body.billingContactEmail, 200),
        billingContactPhone: clip(body.billingContactPhone, 40) || undefined,
        invoiceCycle: body.invoiceCycle ? String(body.invoiceCycle) : undefined,
        netTerms: body.netTerms ? String(body.netTerms) : undefined,
        poNumber: clip(body.poNumber, 80) || undefined,
        invoiceNotes: clip(body.invoiceNotes, 2000) || undefined,
        confirmedByName:
          (a.signed_by_name as string) || clip(body.billingContactName, 120) || "Client",
        ctx: requestContext(req),
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
      }

      const billing = await billingSnapshot(supabase, accountId);
      await retireContinuationToken(supabase, a, billing.state);

      return NextResponse.json({
        ok: true,
        outcome: "billing_configured",
        billing: billing.state,
        message: result.message,
      });
    }

    const setup = await openAutoPaySetup(supabase, {
      agreement: a,
      account: acct,
      returnUrl: token ? agreementUrl(token) : agreementUrl(String(a.token || "")),
      billingContactName: clip(body.billingContactName, 120) || undefined,
      billingContactEmail: clip(body.billingContactEmail, 200) || undefined,
    });
    if (!setup.ok) {
      return NextResponse.json({ ok: false, message: setup.message }, { status: setup.status });
    }
    return NextResponse.json({ ok: true, outcome: "redirect", url: setup.url });
  }

  // ── Resolve the saved method after the Stripe redirect ─────────────────
  if (action === "billing_status") {
    await refreshAutoPayFromStripe(supabase, { agreement: a, account: acct });
    const billing = await billingSnapshot(supabase, accountId);
    await retireContinuationToken(supabase, a, billing.state);
    return NextResponse.json({ ok: true, billing: billing.state, billingProfile: billing.profile });
  }

  return NextResponse.json({ ok: false, message: `Unknown action "${action}".` }, { status: 400 });
}
