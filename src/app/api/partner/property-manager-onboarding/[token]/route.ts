// ─── /api/partner/property-manager-onboarding/[token] ──────────────────────
//
// One token carrying a property manager through Legal → Unit Registry &
// Rates → Billing & Portal. Step order is enforced server-side from derived
// progress: Pages 2 and 3 refuse until Page 1 is signed.
//
// Page 3 does both halves. Configuring billing and provisioning the portal
// happen in the same page, so the session ends on a confirmation with a live
// link into the portal rather than on a promise.

import { NextResponse } from "next/server";

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  addUnitDuringOnboarding,
  clip,
  configureBilling,
  confirmBillingCard,
  decideUnit,
  provisionPmPortal,
  requestContext,
  requireSigned,
  signPmAgreement,
  updateUnitDetailsDuringOnboarding,
  validateSignature,
} from "@/lib/property-manager/onboarding/operations";
import {
  closeIfComplete,
  loadProgress,
  portalUrl,
  resolveSession,
  sessionPayload,
  touchActivity,
} from "@/lib/property-manager/onboarding/session";
import type { PmBillingMethod } from "@/lib/property-manager/onboarding/agreement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function numOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function numAllowZero(value: unknown): number | null | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function loadAccount(supabase: ReturnType<typeof getAdminSupabase>, pmAccountId: string) {
  const { data } = await supabase
    .from("property_manager_accounts")
    .select("*")
    .eq("id", pmAccountId)
    .maybeSingle();
  return (data || {}) as Row;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
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
    .from("property_manager_onboarding_sessions")
    .update({
      first_viewed_at: (s.first_viewed_at as string) || now,
      last_viewed_at: now,
      view_count: Number(s.view_count || 0) + 1,
    })
    .eq("id", s.id as string);

  const payload = await sessionPayload(supabase, s);
  const withHandoff = await attachAccountHandoff(payload);
  return NextResponse.json({ ok: true, ...withHandoff });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
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
  const account = await loadAccount(supabase, String(session.pm_account_id));

  const byName =
    clip(body.name, 120) ||
    (session.signer_name as string) ||
    (session.recipient_name as string) ||
    "The property manager";

  const finish = async (extra: Record<string, unknown>) => {
    const freshSession = (
      await supabase
        .from("property_manager_onboarding_sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle()
    ).data as Row;
    const current = freshSession || session;
    const progress = await loadProgress(supabase, current, account);
    if (progress.complete) await closeIfComplete(supabase, current, progress);
    return NextResponse.json({ ok: true, progress, ...extra });
  };

  if (session.status === "completed" && action !== "billing_status") {
    return NextResponse.json({
      ok: true,
      outcome: "already_complete",
      portalUrl: portalUrl(),
      message: "You're all set.",
    });
  }

  if (action === "sign") {
    const signerName = clip(body.signerName, 120);
    const signatureDataUrl = clip(body.signatureDataUrl, 400_000);
    const invalid = validateSignature({
      signerName,
      agreedToTerms: body.agreedToTerms,
      acknowledgedNonCircumvention: body.acknowledgedNonCircumvention,
      acknowledgedChargebacks: body.acknowledgedChargebacks,
      acknowledgedArbitration: body.acknowledgedArbitration,
      signatureDataUrl,
    });
    if (invalid) return NextResponse.json({ ok: false, message: invalid }, { status: 400 });

    const result = await signPmAgreement(supabase, {
      session,
      account,
      signerName,
      signerEmail:
        clip(body.signerEmail, 200) ||
        (session.recipient_email as string) ||
        (account.email as string) ||
        "",
      entityName: clip(body.entityName, 200) || null,
      signatureDataUrl,
      pdfBase64: clip(body.pdfBase64, 12_000_000),
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

  if (action === "decide_unit") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const decision = body.decision === "flagged" ? "flagged" : "confirmed";
    const result = await decideUnit(supabase, {
      session,
      account,
      unitId: clip(body.unitId, 80),
      decision,
      note: clip(body.note, 1000),
      byName,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    await touchActivity(supabase, sessionId);
    return finish({ outcome: decision, message: result.message });
  }

  if (action === "add_unit") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const result = await addUnitDuringOnboarding(supabase, {
      session,
      account,
      unitLabel: clip(body.unitLabel, 120) || undefined,
      address: clip(body.address, 300),
      city: clip(body.city, 120) || undefined,
      state: clip(body.state, 40) || undefined,
      zipCode: clip(body.zipCode, 10) || undefined,
      sqft: numOrUndefined(body.sqft),
      bedrooms: numOrUndefined(body.bedrooms),
      bathrooms: numOrUndefined(body.bathrooms),
      notes: clip(body.notes, 2000) || undefined,
      flagNonStandard: body.flagNonStandard === true,
      byName,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    await touchActivity(supabase, sessionId);
    return finish({
      outcome: result.autoPriced ? "unit_added" : "unit_routed",
      unitId: result.unitId,
      autoPriced: result.autoPriced,
      countReview: !!result.countReview,
      message: result.message,
    });
  }

  if (action === "update_unit") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const result = await updateUnitDetailsDuringOnboarding(supabase, {
      session,
      account,
      unitId: clip(body.unitId, 80),
      sqft: numOrUndefined(body.sqft) ?? null,
      bedrooms: numAllowZero(body.bedrooms) ?? null,
      bathrooms: numAllowZero(body.bathrooms) ?? null,
      byName,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    await touchActivity(supabase, sessionId);
    return finish({ outcome: "unit_updated", rates: result.rates, message: result.message });
  }

  if (action === "configure_billing") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const method = String(body.billingMethod || "invoiced");
    if (!["invoiced", "auto_pay"].includes(method)) {
      return NextResponse.json({ ok: false, message: "Choose Invoiced or Auto-Pay." }, { status: 400 });
    }
    const result = await configureBilling(supabase, {
      session,
      account,
      billingMethod: method as PmBillingMethod,
      billingEmail: clip(body.billingEmail, 200) || undefined,
      billingContactName: clip(body.billingContactName, 120) || undefined,
      billingContactPhone: clip(body.billingContactPhone, 40) || undefined,
      invoiceCycle: clip(body.invoiceCycle, 20) || undefined,
      netTerms: clip(body.netTerms, 20) || undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    await touchActivity(supabase, sessionId);
    if (result.needsCard) {
      return NextResponse.json({
        ok: true,
        outcome: "embed",
        clientSecret: result.clientSecret,
        message: result.message,
      });
    }
    await provisionPortalAfterBilling(supabase, sessionId, account);
    return finish({ outcome: "billing_ready", message: result.message });
  }

  if (action === "confirm_billing" || action === "billing_status") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const result = await confirmBillingCard(supabase, { session, account });
    if (!result.ok && action === "confirm_billing") {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    if (result.ok) await touchActivity(supabase, sessionId, "billing");
    if (result.ok) await provisionPortalAfterBilling(supabase, sessionId, account);
    return finish({
      outcome: result.ok ? "billing_ready" : "billing_pending",
      message: result.message,
    });
  }

  if (action === "create_portal") {
    const gate = requireSigned(session);
    if (gate) return NextResponse.json({ ok: false, message: gate }, { status: 409 });
    const result = await provisionPmPortal(supabase, {
      session,
      account,
      email: clip(body.email, 200) || undefined,
      fullName: clip(body.fullName, 120) || (session.signer_name as string) || undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    }
    await touchActivity(supabase, sessionId, "billing");
    return finish({
      outcome: "portal_created",
      portalUrl: result.portalUrl,
      handoffUrl: result.handoffUrl || result.portalUrl,
      message: result.message,
    });
  }

  return NextResponse.json({ ok: false, message: `Unknown action "${action}".` }, { status: 400 });
}

async function provisionPortalAfterBilling(
  supabase: ReturnType<typeof getAdminSupabase>,
  sessionId: string,
  account: Row,
): Promise<void> {
  const { data: fresh } = await supabase
    .from("property_manager_onboarding_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!fresh) return;
  if (fresh.portal_provisioned_at || account.portal_provisioned_at) return;
  if (!fresh.billing_configured_at) return;
  const email = (account.email as string) || (fresh.recipient_email as string) || "";
  if (!email) return;
  await provisionPmPortal(supabase, {
    session: fresh,
    account,
    email,
    fullName: (fresh.signer_name as string) || (account.contact_name as string) || undefined,
  }).catch(() => null);
}

async function attachAccountHandoff(
  payload: Awaited<ReturnType<typeof sessionPayload>>,
): Promise<Awaited<ReturnType<typeof sessionPayload>> & { handoffUrl?: string }> {
  if (payload.progress.current_step !== "done" && !payload.progress.complete) return payload;
  if (!payload.account.email) return payload;
  try {
    const { provisionPropertyManagerPortalAccess } = await import("@/lib/partner-portal/handoff");
    const access = await provisionPropertyManagerPortalAccess({
      email: payload.account.email,
      pmAccountId: payload.account.id,
      displayName: payload.account.contactName,
    });
    return { ...payload, handoffUrl: access.handoffUrl || payload.portalUrl };
  } catch {
    return payload;
  }
}

