// ─── /api/commercial-onboarding/[token] ────────────────────────────────────
//
// The back end for the consolidated commercial onboarding session: ONE token
// carrying a client through pricing review, signature, billing setup, portal
// account creation and status, in that order, across as many visits as it
// takes.
//
//   GET                              where they are and everything to render it
//   POST accept_pricing              accept the terms; the agreement is built
//   POST request_changes             pause and route back to admin
//   POST sign                        execute the agreement
//   POST setup_billing               invoiced confirm, or an in-page Pre-Auth embed
//   POST confirm_billing             record the hold after the card form
//   POST billing_status              resolve the method after a 3DS return
//   POST create_portal               create their portal login
//   POST submit_info                 request a site, or send a document
//
// Three things here are deliberate:
//
//   * THE CLIENT IS NEVER ASKED HOW THEY WANT TO BE BILLED. Admin chose at
//     approval; the session presents that method and only that method's
//     fields. An invoiced account never sees a card field.
//   * THE PRICING STEP IS STILL A REAL CHECKPOINT. Request Changes pauses the
//     session and routes to admin before anything binding happens — merging
//     the links did not merge the decision.
//   * STEP ORDER IS ENFORCED SERVER-SIDE, from derived progress rather than
//     from what the browser claims. You cannot sign an agreement whose pricing
//     was never accepted by posting out of order.

import { NextResponse } from "next/server";

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import { AGREEMENT_COLS, PROPOSAL_COLS } from "@/lib/commercial-agreement-server";
import {
  acceptProposal,
  billingSnapshot,
  clip,
  configureInvoicedBilling,
  openAutoPaySetup,
  refreshAutoPayFromStripe,
  requestContext,
  requestProposalChanges,
  signCommercialAgreement,
  validateSignature,
} from "@/lib/commercial-onboarding/operations";
import { provisionCommercialPortalUser } from "@/lib/commercial-onboarding/portal";
import {
  applyCommercialOnboardingPreviewAction,
  commercialOnboardingPreviewPayload,
  isLocalCommercialOnboardingPreview,
} from "@/lib/commercial-onboarding/preview";
import {
  closeIfComplete,
  loadProgress,
  onboardingUrl,
  portalUrl,
  resolveSession,
  sessionPayload,
  touchActivity,
} from "@/lib/commercial-onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_BUCKET = "commercial-onboarding-uploads";
type Row = Record<string, unknown>;

async function loadContext(supabase: ReturnType<typeof getAdminSupabase>, session: Row) {
  const [{ data: account }, proposal, agreement] = await Promise.all([
    supabase
      .from("business_accounts")
      .select(
        "id, business_name, contact_name, email, phone, address, city, state, zip_code, " +
          "stripe_customer_id, requires_coi_on_file, assigned_va_email, preferred_billing_method, " +
          "portal_user_id, account_type",
      )
      .eq("id", session.business_account_id as string)
      .maybeSingle(),
    session.proposal_id
      ? supabase.from("commercial_proposals").select(PROPOSAL_COLS).eq("id", session.proposal_id).maybeSingle()
      : Promise.resolve({ data: null }),
    session.agreement_id
      ? supabase
          .from("commercial_agreements")
          .select(`${AGREEMENT_COLS}, exhibit_a_sites`)
          .eq("id", session.agreement_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    account: (account || {}) as Row,
    proposal: ((proposal as { data?: Row })?.data || null) as Row | null,
    agreement: ((agreement as { data?: Row })?.data || null) as Row | null,
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (isLocalCommercialOnboardingPreview(req, token)) {
    const url = new URL(req.url);
    return NextResponse.json(
      commercialOnboardingPreviewPayload(
        token,
        url.searchParams.get("step") || undefined,
        url.searchParams.get("billing"),
      ),
    );
  }
  const supabase = getAdminSupabase();
  const resolved = await resolveSession(supabase, token);
  if (!resolved.ok || !resolved.session) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, message: resolved.message },
      { status: resolved.status },
    );
  }

  const s = resolved.session;
  const now = new Date().toISOString();
  await supabase
    .from("commercial_onboarding_sessions")
    .update({
      first_viewed_at: (s.first_viewed_at as string) || now,
      last_viewed_at: now,
      view_count: Number(s.view_count || 0) + 1,
    })
    .eq("id", s.id as string);

  const payload = await sessionPayload(supabase, s);
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (isLocalCommercialOnboardingPreview(req, token)) {
    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = applyCommercialOnboardingPreviewAction(
      token,
      String(body.action || ""),
      body,
      url.searchParams.get("billing"),
    );
    return NextResponse.json(result, { status: result.status });
  }
  const supabase = getAdminSupabase();
  const resolved = await resolveSession(supabase, token);
  if (!resolved.ok || !resolved.session) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, message: resolved.message },
      { status: resolved.status },
    );
  }

  const session = resolved.session;
  const sessionId = String(session.id);
  const accountId = String(session.business_account_id);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const reqCtx = requestContext(req);

  const { account, proposal, agreement } = await loadContext(supabase, session);
  const progress = await loadProgress(supabase, sessionId);

  const finish = async (extra: Record<string, unknown>) => {
    const fresh = await loadProgress(supabase, sessionId);
    if (fresh.complete) {
      const { data } = await supabase
        .from("commercial_onboarding_sessions")
        .select("id, status, business_account_id, billing_method")
        .eq("id", sessionId)
        .maybeSingle();
      if (data) await closeIfComplete(supabase, data as Row, fresh);
    }
    return NextResponse.json({ ok: true, progress: fresh, ...extra });
  };

  async function provisionPortalNow(emailHint?: string) {
    const email =
      clip(emailHint, 200) ||
      (session.recipient_email as string) ||
      (account.email as string) ||
      "";
    if (!email) return { ok: false as const, error: "No email on file to open the portal with." };
    const result = await provisionCommercialPortalUser(supabase, {
      accountId,
      email,
      fullName:
        (agreement?.signed_by_name as string) ||
        (session.recipient_name as string) ||
        undefined,
      businessName: (account.business_name as string) || undefined,
    });
    if (!result.ok) return result;
    await supabase.from("events").insert({
      event_type: "commercial.onboarding.portal_created",
      source: "commercial-onboarding",
      summary: `Portal access ${result.linkedExisting ? "linked" : "created"} for ${String(account.business_name || "an account")} (${email}).`,
      data: { account_id: accountId, session_id: sessionId, email, linked_existing: result.linkedExisting },
    });
    await touchActivity(supabase, sessionId, "billing");
    return result;
  }

  // ── Submitting information is available at every point, including after
  //    the flow is finished. That is the whole point of it.
  if (action === "submit_info") {
    const kind = ["site_request", "document", "note"].includes(String(body.kind))
      ? String(body.kind)
      : "note";

    const submittedBy =
      clip(body.submittedByName, 120) ||
      (agreement?.signed_by_name as string) ||
      (session.recipient_name as string) ||
      "The client";

    const record: Row = {
      session_id: sessionId,
      business_account_id: accountId,
      kind,
      note: clip(body.note, 4000) || null,
      submitted_by_name: submittedBy,
      submitted_by_email:
        clip(body.submittedByEmail, 200) || (session.recipient_email as string) || null,
    };

    if (kind === "site_request") {
      const address = clip(body.siteAddress, 300);
      if (address.length < 5) {
        return NextResponse.json(
          { ok: false, message: "Add the address of the site you'd like us to look at." },
          { status: 400 },
        );
      }
      Object.assign(record, {
        site_nickname: clip(body.siteNickname, 120) || null,
        site_address: address,
        site_city: clip(body.siteCity, 120) || null,
        site_state: clip(body.siteState, 2).toUpperCase() || null,
        site_zip: clip(body.siteZip, 10) || null,
        site_sqft: Number.isFinite(Number(body.siteSqft)) ? Math.round(Number(body.siteSqft)) : null,
      });
    }

    if (kind === "document") {
      const name = clip(body.documentName, 200);
      const base64 = clip(body.documentBase64, 16_000_000);
      if (!name || base64.length < 100) {
        return NextResponse.json({ ok: false, message: "Choose a file to upload." }, { status: 400 });
      }
      const safe = name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
      const path = `${accountId}/${Date.now()}-${safe}`;
      const bytes = Buffer.from(base64.split(",").pop() || "", "base64");
      if (bytes.length > 12 * 1024 * 1024) {
        return NextResponse.json(
          { ok: false, message: "That file is larger than 12 MB. Send a smaller copy or email it to us." },
          { status: 400 },
        );
      }
      const { error: upErr } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(path, bytes, { contentType: String(body.documentType || "application/octet-stream"), upsert: false });
      if (upErr) {
        return NextResponse.json({ ok: false, message: `Upload failed: ${upErr.message}` }, { status: 502 });
      }
      Object.assign(record, {
        document_path: path,
        document_name: name,
        document_size_bytes: bytes.length,
      });
    }

    const { error } = await supabase.from("commercial_onboarding_submissions").insert(record);
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

    // Routed to a human. NOTHING here touches pricing, scope or billing: a
    // requested site is a lead for a walkthrough, not a priced site.
    const owner = (account.assigned_va_email as string) || null;
    if (owner) {
      await sendPartnershipMessage(supabase, {
        templateKey: "commercial_request_changes",
        trigger: "commercial-onboarding.submission",
        email: owner,
        role: "admin",
        accountId: String(account.id || "") || null,
        vars: {
          first_name: submittedBy,
          business_name: String(account.business_name || "commercial account"),
          note: String(record.note || ""),
        },
        subject: `Onboarding submission — ${String(account.business_name || "commercial account")}`,
        html: [
          `<p><strong>${submittedBy}</strong> sent something during onboarding for <strong>${String(account.business_name || "")}</strong>.</p>`,
          kind === "site_request"
            ? `<p>They'd like a site added: <strong>${clip(body.siteAddress, 300).replace(/</g, "&lt;")}</strong>. This has NOT been priced or added — it needs its own walkthrough.</p>`
            : kind === "document"
              ? `<p>They uploaded a document: <strong>${clip(body.documentName, 200).replace(/</g, "&lt;")}</strong>.</p>`
              : `<p>They left a note.</p>`,
          record.note
            ? `<p style="border-left:3px solid #7c3aed;padding-left:12px;white-space:pre-wrap">${String(record.note).replace(/</g, "&lt;")}</p>`
            : "",
          `<p>Review it in Commercial → the account's onboarding panel.</p>`,
        ].join(""),
      });
    }

    await supabase.from("events").insert({
      event_type: "commercial.onboarding.submission",
      source: "commercial-onboarding",
      summary: `${submittedBy} submitted a ${kind.replace("_", " ")} during onboarding for ${String(account.business_name || "an account")}.`,
      data: { account_id: accountId, session_id: sessionId, kind },
    });

    await touchActivity(supabase, sessionId);
    return finish({
      outcome: "submitted",
      message:
        kind === "site_request"
          ? "Thanks — that's with your account manager. A new site needs its own walkthrough before we can price it, and they'll be in touch to arrange one."
          : "Thanks — that's with your account manager.",
    });
  }

  if (session.status !== "active") {
    return NextResponse.json(
      { ok: false, message: "This onboarding is already complete. Nothing else is needed." },
      { status: 409 },
    );
  }

  // ── Step 1: pricing review ─────────────────────────────────────────────

  if (action === "request_changes") {
    if (!proposal) {
      return NextResponse.json({ ok: false, message: "There's no proposal on this session." }, { status: 409 });
    }
    if (progress.current_step !== "pricing") {
      return NextResponse.json(
        { ok: false, message: "Changes can only be requested before the agreement is signed." },
        { status: 409 },
      );
    }
    const note = clip(body.note, 4000);
    if (note.length < 5) {
      return NextResponse.json(
        { ok: false, message: "Tell us what to change and we'll send a revised proposal." },
        { status: 400 },
      );
    }

    const result = await requestProposalChanges(supabase, {
      proposal,
      account,
      note,
      byName: clip(body.name, 120) || (session.recipient_name as string) || "The client",
    });
    if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: 400 });

    await touchActivity(supabase, sessionId, "pricing_changes_requested");
    return finish({ outcome: "changes_requested", message: result.message });
  }

  if (action === "accept_pricing") {
    if (!proposal) {
      return NextResponse.json({ ok: false, message: "There's no proposal on this session." }, { status: 409 });
    }
    if (progress.current_step !== "pricing") {
      return NextResponse.json(
        { ok: false, message: "This proposal has already been accepted." },
        { status: 409 },
      );
    }
    const acceptedBy = clip(body.name, 120);
    if (acceptedBy.length < 2) {
      return NextResponse.json(
        { ok: false, message: "Please enter your name to record who accepted the proposal." },
        { status: 400 },
      );
    }

    // The billing method is the admin's decision, taken at approval. The
    // client is not offered a choice here and nothing in the request body can
    // change it.
    const billingMethod = String(session.billing_method) === "auto_pay" ? "auto_pay" : "invoiced";

    const result = await acceptProposal(supabase, {
      proposal,
      account,
      acceptedBy,
      acceptedEmail: clip(body.email, 200) || undefined,
      billingMethod,
      signerName: clip(body.signerName, 120) || acceptedBy,
      signerEmail:
        clip(body.signerEmail, 200) ||
        clip(body.email, 200) ||
        (session.recipient_email as string) ||
        undefined,
      signerTitle: clip(body.signerTitle, 120) || null,
      ctx: reqCtx,
    });
    if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: 400 });

    // The agreement belongs to this session. Its own token is retired at the
    // same time so the only way in stays the one link the client already has.
    if (result.agreementId) {
      await supabase
        .from("commercial_onboarding_sessions")
        .update({ agreement_id: result.agreementId, updated_at: new Date().toISOString() })
        .eq("id", sessionId);
      await supabase
        .from("commercial_agreements")
        .update({ token: null, updated_at: new Date().toISOString() })
        .eq("id", result.agreementId);
    }

    await touchActivity(supabase, sessionId, "pricing");
    return finish({
      outcome: "accepted",
      agreementReady: result.agreementReady,
      message: result.agreementReady
        ? "Accepted. Your services agreement is ready to sign — it's on the next step."
        : "Thanks — your acceptance is recorded. Your account manager will follow up with the agreement.",
      agreementError: result.agreementError || null,
    });
  }

  // ── Step 2: signature ──────────────────────────────────────────────────

  if (action === "sign") {
    if (!agreement) {
      return NextResponse.json(
        { ok: false, message: "The agreement isn't ready yet. Accept the pricing first." },
        { status: 409 },
      );
    }
    if (progress.current_step === "pricing" || progress.paused_for_changes) {
      return NextResponse.json(
        { ok: false, message: "Review and accept the pricing before signing." },
        { status: 409 },
      );
    }

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
      agreement,
      account,
      signerName,
      signerTitle: clip(body.signerTitle, 120) || null,
      signatureDataUrl,
      pdfBase64,
      ctx: reqCtx,
      // The session carries the signer to billing itself. A continuation token
      // would be a second live link into the same account for no benefit.
      mintContinuation: false,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }

    await touchActivity(supabase, sessionId, "agreement");
    return finish({
      outcome: result.alreadySigned ? "already_signed" : "signed",
      coiSent: result.coiSent ?? false,
      message: result.alreadySigned
        ? result.message
        : String(session.billing_method) === "auto_pay"
          ? "Signed. Next: a verification hold via Stripe Pre-Auth — nothing is charged now."
          : "Signed. Next: confirm where your invoices should go.",
    });
  }

  // ── Step 3: billing, in the method admin selected ──────────────────────

  if (action === "setup_billing") {
    if (!agreement || agreement.status !== "signed") {
      return NextResponse.json(
        { ok: false, message: "Billing is set up after the agreement is signed." },
        { status: 409 },
      );
    }

    const method = String(session.billing_method) === "auto_pay" ? "auto_pay" : "invoiced";

    if (method === "invoiced") {
      const result = await configureInvoicedBilling(supabase, {
        agreement,
        account,
        billingContactName: clip(body.billingContactName, 120) || undefined,
        billingContactEmail: clip(body.billingContactEmail, 200),
        billingContactPhone: clip(body.billingContactPhone, 40) || undefined,
        invoiceCycle: body.invoiceCycle ? String(body.invoiceCycle) : undefined,
        netTerms: body.netTerms ? String(body.netTerms) : undefined,
        poNumber: clip(body.poNumber, 80) || undefined,
        invoiceNotes: clip(body.invoiceNotes, 2000) || undefined,
        confirmedByName:
          (agreement.signed_by_name as string) || clip(body.billingContactName, 120) || "Client",
        ctx: reqCtx,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
      }
      await touchActivity(supabase, sessionId, "billing");
      const portal = await provisionPortalNow(
        clip(body.billingContactEmail, 200) || (session.recipient_email as string) || undefined,
      );
      const billing = await billingSnapshot(supabase, accountId);
      return finish({
        outcome: portal.ok ? "billing_configured" : "billing_configured",
        billing: billing.state,
        portalUrl: portal.ok ? portal.handoffUrl || portalUrl() : undefined,
        handoffUrl: portal.ok ? portal.handoffUrl : undefined,
        message: portal.ok
          ? `${result.message} Your partner portal is ready.`
          : result.message,
        portalError: portal.ok ? null : portal.error || "Could not open the portal yet.",
      });
    }

    const setup = await openAutoPaySetup(supabase, {
      agreement,
      account,
      returnUrl: onboardingUrl(token),
      billingContactName: clip(body.billingContactName, 120) || undefined,
      billingContactEmail: clip(body.billingContactEmail, 200) || undefined,
    });
    if (!setup.ok) {
      return NextResponse.json({ ok: false, message: setup.message }, { status: setup.status });
    }
    await touchActivity(supabase, sessionId);
    if (setup.alreadyHeld) {
      const billing = await billingSnapshot(supabase, accountId);
      const portal = await provisionPortalNow();
      return finish({
        outcome: "billing_configured",
        billing: billing.state,
        portalUrl: portal.ok ? portal.handoffUrl || portalUrl() : undefined,
        handoffUrl: portal.ok ? portal.handoffUrl : undefined,
        message: "Pre-Auth hold is already on file.",
      });
    }
    return NextResponse.json({
      ok: true,
      outcome: "embed",
      clientSecret: setup.clientSecret,
      amountCents: setup.amountCents,
    });
  }

  if (action === "confirm_billing") {
    if (!agreement) {
      return NextResponse.json({ ok: false, message: "Billing is set up after the agreement is signed." }, { status: 409 });
    }
    const held = await refreshAutoPayFromStripe(supabase, {
      agreement,
      account,
      paymentIntentId: clip(body.paymentIntentId, 80) || null,
    });
    if (!held) {
      return NextResponse.json(
        { ok: false, message: "The pre-auth hold has not landed yet. Submit the card form again." },
        { status: 409 },
      );
    }
    await touchActivity(supabase, sessionId, "billing");
    const portal = await provisionPortalNow();
    const billing = await billingSnapshot(supabase, accountId);
    return finish({
      outcome: "billing_configured",
      billing: billing.state,
      portalUrl: portal.ok ? portal.handoffUrl || portalUrl() : undefined,
      handoffUrl: portal.ok ? portal.handoffUrl : undefined,
      message: portal.ok
        ? "Pre-Auth hold is on file. Your partner portal is ready."
        : "Pre-Auth hold is on file.",
      portalError: portal.ok ? null : portal.error || "Could not open the portal yet.",
    });
  }

  if (action === "billing_status") {
    if (agreement) {
      await refreshAutoPayFromStripe(supabase, {
        agreement,
        account,
        paymentIntentId: clip(body.paymentIntentId, 80) || null,
      });
    }
    const billing = await billingSnapshot(supabase, accountId);
    const billed = await loadProgress(supabase, sessionId);
    let portal: Awaited<ReturnType<typeof provisionPortalNow>> | null = null;
    if (billed.billing_configured) {
      await touchActivity(supabase, sessionId, "billing");
      portal = await provisionPortalNow();
    }
    return finish({
      billing: billing.state,
      billingProfile: billing.profile,
      portalUrl: portal?.ok ? portal.handoffUrl || portalUrl() : undefined,
      handoffUrl: portal?.ok ? portal.handoffUrl : undefined,
    });
  }

  // Portal retry — Page 3 auto-provisions; this is only if that first attempt
  // failed, or the client reopens before portal_created_at lands.
  if (action === "create_portal") {
    if (!progress.billing_configured && progress.current_step !== "done") {
      return NextResponse.json(
        { ok: false, message: "Finish billing setup first — your portal opens as soon as that's done." },
        { status: 409 },
      );
    }

    const result = await provisionPortalNow(clip(body.email, 200) || undefined);
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.error || "Could not open your portal." }, { status: 400 });
    }

    return finish({
      outcome: "portal_created",
      portalUrl: result.handoffUrl || portalUrl(),
      handoffUrl: result.handoffUrl || portalUrl(),
      message: "Your portal is ready — no password needed.",
    });
  }

  return NextResponse.json({ ok: false, message: `Unknown action "${action}".` }, { status: 400 });
}
