// ─── /api/partner/host-onboarding/[token] ──────────────────────────────────
//
// One token carrying a host through Legal → Rates → Payment. Step order is
// enforced server-side from derived progress. Pages 2 and 3 refuse until
// Page 1 is signed.

import { NextResponse } from "next/server";

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  applyHostOnboardingPreviewAction,
  hostOnboardingPreviewPayload,
  isHostOnboardingPreviewToken,
  isLocalHostRequest,
} from "@/lib/host-onboarding/preview";
import {
  clip,
  decideProperty,
  markPortalAlreadyLinked,
  openPaymentSetup,
  provisionHostPortal,
  refreshPaymentFromStripe,
  requestAdditionalProperty,
  requestContext,
  requireSigned,
  signHostAgreement,
  validateSignature,
} from "@/lib/host-onboarding/operations";
import {
  closeIfComplete,
  loadProgress,
  onboardingUrl,
  portalUrl,
  resolveSession,
  sessionPayload,
  touchActivity,
} from "@/lib/host-onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

async function loadHost(supabase: ReturnType<typeof getAdminSupabase>, hostId: string) {
  const { data } = await supabase.from("hosts").select("*").eq("id", hostId).maybeSingle();
  return (data || {}) as Row;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (isHostOnboardingPreviewToken(token) && isLocalHostRequest(req)) {
    const step = new URL(req.url).searchParams.get("step") || undefined;
    return NextResponse.json(hostOnboardingPreviewPayload(step));
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
    .from("host_onboarding_sessions")
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
  if (isHostOnboardingPreviewToken(token) && isLocalHostRequest(req)) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = applyHostOnboardingPreviewAction(String(body.action || ""), body);
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ ok: true, progress: hostOnboardingPreviewPayload().progress, ...result });
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
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const reqCtx = requestContext(req);
  const host = await loadHost(supabase, String(session.host_id));

  const finish = async (extra: Record<string, unknown>) => {
    const freshSession = (
      await supabase.from("host_onboarding_sessions").select("*").eq("id", sessionId).maybeSingle()
    ).data as Row;
    const progress = await loadProgress(supabase, freshSession || session, host);
    if (progress.complete) await closeIfComplete(supabase, freshSession || session, progress);
    return NextResponse.json({ ok: true, progress, ...extra });
  };

  if (session.status === "completed" && action !== "payment_status") {
    return NextResponse.json(
      { ok: true, outcome: "already_complete", portalUrl: portalUrl(), message: "You're all set." },
    );
  }

  if (action === "sign") {
    const signerName = clip(body.signerName, 120);
    const signatureDataUrl = clip(body.signatureDataUrl, 400_000);
    const pdfBase64 = clip(body.pdfBase64, 12_000_000);
    const invalid = validateSignature({
      signerName,
      agreedToTerms: body.agreedToTerms,
      acknowledgedNonCircumvention: body.acknowledgedNonCircumvention,
      acknowledgedChargebacks: body.acknowledgedChargebacks,
      acknowledgedArbitration: body.acknowledgedArbitration,
      signatureDataUrl,
      pdfBase64,
    });
    if (invalid) return NextResponse.json({ ok: false, message: invalid }, { status: 400 });

    const result = await signHostAgreement(supabase, {
      session,
      host,
      signerName,
      signerEmail:
        clip(body.signerEmail, 200) ||
        (session.recipient_email as string) ||
        (host.email as string) ||
        "",
      entityType: clip(body.entityType, 40) || null,
      entityName: clip(body.entityName, 200) || null,
      signatureDataUrl,
      pdfBase64,
      ctx: reqCtx,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    return finish({
      outcome: result.alreadySigned ? "already_signed" : "signed",
      message: result.message,
    });
  }

  if (action === "decide_property") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const decision = body.decision === "flagged" ? "flagged" : "confirmed";
    const result = await decideProperty(supabase, {
      session,
      host,
      propertyId: clip(body.propertyId, 80),
      decision,
      note: clip(body.note, 1000),
      byName:
        clip(body.name, 120) ||
        (session.signer_name as string) ||
        (session.recipient_name as string) ||
        "The host",
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    await touchActivity(supabase, sessionId);
    return finish({ outcome: decision, message: result.message });
  }

  if (action === "request_property") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const result = await requestAdditionalProperty(supabase, {
      session,
      host,
      nickname: clip(body.nickname, 120),
      address: clip(body.address, 300),
      bedrooms: Number.isFinite(Number(body.bedrooms)) ? Number(body.bedrooms) : undefined,
      bathrooms: Number.isFinite(Number(body.bathrooms)) ? Number(body.bathrooms) : undefined,
      notes: clip(body.notes, 2000),
      byName:
        clip(body.name, 120) ||
        (session.signer_name as string) ||
        (session.recipient_name as string) ||
        "The host",
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    await touchActivity(supabase, sessionId);
    return finish({ outcome: "property_requested", message: result.message });
  }

  if (action === "setup_payment") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const option = String(body.paymentOption || "");
    if (!["full", "split", "pay_after"].includes(option)) {
      return NextResponse.json({ ok: false, message: "Choose a payment option." }, { status: 400 });
    }
    const setup = await openPaymentSetup(supabase, {
      session,
      host,
      paymentOption: option as "full" | "split" | "pay_after",
      returnUrl: onboardingUrl(token),
    });
    if (!setup.ok) {
      return NextResponse.json({ ok: false, message: setup.message }, { status: setup.status });
    }
    await touchActivity(supabase, sessionId);
    if (setup.alreadyHeld) {
      return finish({ outcome: "payment_ready", message: "Pre-Auth hold is already on file." });
    }
    return NextResponse.json({
      ok: true,
      outcome: "embed",
      clientSecret: setup.clientSecret,
      amountCents: setup.amountCents,
    });
  }

  if (action === "confirm_payment") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const refreshed = await refreshPaymentFromStripe(supabase, {
      session,
      host,
      paymentIntentId: clip(body.paymentIntentId, 80) || null,
    });
    if (!refreshed.ok) {
      return NextResponse.json(
        { ok: false, message: "The pre-auth hold has not landed yet. Submit the card form again." },
        { status: 409 },
      );
    }
    await touchActivity(supabase, sessionId, "payment");
    return finish({
      outcome: "payment_ready",
      paymentMethodId: refreshed.paymentMethodId,
      message: "Pre-Auth hold is on file.",
    });
  }

  if (action === "payment_status") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const refreshed = await refreshPaymentFromStripe(supabase, {
      session,
      host,
      paymentIntentId: clip(body.paymentIntentId, 80) || null,
    });
    if (refreshed.ok && host.user_id) {
      await markPortalAlreadyLinked(supabase, session, host);
      await touchActivity(supabase, sessionId, "payment");
    }
    return finish({
      outcome: refreshed.ok ? "payment_ready" : "payment_pending",
      paymentMethodId: refreshed.paymentMethodId,
    });
  }

  if (action === "create_portal") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const progress = await loadProgress(supabase, session, host);
    if (!progress.payment_ready && !host.default_payment_method_id && !session.payment_method_id) {
      return NextResponse.json(
        { ok: false, message: "Save a payment method first — then we'll open your portal." },
        { status: 409 },
      );
    }
    if (host.user_id || session.portal_user_id || session.portal_provisioned_at) {
      await markPortalAlreadyLinked(supabase, session, host);
      await touchActivity(supabase, sessionId, "payment");
    }
    const email = clip(body.email, 200) || (session.recipient_email as string) || (host.email as string) || "";
    const result = await provisionHostPortal(supabase, {
      session,
      host,
      email,
      fullName: clip(body.fullName, 120) || (session.signer_name as string) || undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.error || "Could not open your portal." }, { status: 400 });
    }
    await touchActivity(supabase, sessionId, "payment");
    return finish({
      outcome: "portal_created",
      portalUrl: result.handoffUrl || result.portalUrl,
      handoffUrl: result.handoffUrl || result.portalUrl,
      email,
      message: "Your portal is ready — no password needed.",
    });
  }

  return NextResponse.json({ ok: false, message: `Unknown action "${action}".` }, { status: 400 });
}
