import { NextResponse } from "next/server";
import { AdminAuthError, requireFullAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { deliverCompliantEmail } from "@/lib/email-compliance/deliver";
import {
  applyConsentChange,
  buildAuditReport,
  EMAIL_CATALOG,
  evaluateEmail,
  migrationReport,
  previewFor,
  retentionCutoff,
} from "@/lib/email-compliance/engine";
import {
  loadClaims,
  loadConsent,
  loadIdentity,
  saveClaims,
  saveIdentity,
} from "@/lib/email-compliance/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function denied(err: unknown): NextResponse {
  const error = err as AdminAuthError;
  return NextResponse.json({ error: error.message || "Not signed in." }, { status: error.status || 401 });
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireFullAdmin(req);
  } catch (err) {
    return denied(err);
  }
  const supabase = getAdminSupabase();
  const [identity, claims, log, suppression, registry] = await Promise.all([
    loadIdentity(supabase),
    loadClaims(supabase),
    supabase.from("email_delivery_log").select("id, contact_email, email_type, template_key, subject, status, footer_version, sent_at, test_send").order("sent_at", { ascending: false }).limit(25),
    supabase.from("email_suppression").select("email, reason, source, created_at, revoked_at").is("revoked_at", null).order("created_at", { ascending: false }).limit(50),
    supabase.from("email_template_registry").select("key, email_type, live, owner_decision_needed, updated_at").order("key"),
  ]);
  const audit = buildAuditReport();
  return NextResponse.json({
    ok: true,
    identity,
    claims,
    audit,
    migration: migrationReport(),
    catalog: EMAIL_CATALOG,
    deliveryLog: log.data || [],
    suppression: suppression.data || [],
    registry: registry.data || [],
    retentionCutoff: retentionCutoff(new Date().toISOString(), identity.retentionMonths),
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal: { email: string };
  try {
    principal = await requireFullAdmin(req);
  } catch (err) {
    return denied(err);
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "");
  const supabase = getAdminSupabase();

  try {
    if (action === "save_identity") {
      const identity = await saveIdentity(supabase, body.identity, principal.email);
      return NextResponse.json({ ok: true, identity });
    }
    if (action === "save_claims") {
      const claims = await saveClaims(supabase, Array.isArray(body.claims) ? body.claims as never : []);
      return NextResponse.json({ ok: true, claims });
    }
    if (action === "preview") {
      const identity = await loadIdentity(supabase);
      const type = String(body.emailType || "customer_service");
      const footer = previewFor(identity, type as never);
      const prepared = evaluateEmail({
        mode: "save",
        declaredType: type,
        templateKey: String(body.templateKey || ""),
        subject: String(body.subject || "Preview"),
        html: String(body.html || "<p>Preview</p>"),
        identity,
        claims: await loadClaims(supabase),
        adminAcknowledged: body.adminAcknowledged === true,
        unsubscribeUrl: `${identity.publicOrigin}/email/unsubscribe?t=preview`,
        preferencesUrl: `${identity.publicOrigin}/email/preferences?t=preview`,
        oneClickUrl: `${identity.publicOrigin}/api/email/unsubscribe?t=preview`,
      });
      return NextResponse.json({ ok: true, footer, prepared });
    }
    if (action === "save_template") {
      const identity = await loadIdentity(supabase);
      const claims = await loadClaims(supabase);
      const emailType = String(body.emailType || "");
      if (!emailType) return NextResponse.json({ error: "A template needs a type before it can be saved." }, { status: 400 });
      const prepared = evaluateEmail({
        mode: "save",
        declaredType: emailType,
        templateKey: String(body.key || ""),
        subject: String(body.subject || ""),
        html: String(body.html || ""),
        identity,
        claims,
        adminAcknowledged: body.adminAcknowledged === true,
        category: String(body.category || "") || null,
        unsubscribeUrl: `${identity.publicOrigin}/email/unsubscribe?t=preview`,
        preferencesUrl: `${identity.publicOrigin}/email/preferences?t=preview`,
        oneClickUrl: `${identity.publicOrigin}/api/email/unsubscribe?t=preview`,
      });
      if (prepared.decision === "block") {
        return NextResponse.json({ ok: false, error: prepared.blockReasons[0] || "This template cannot be saved.", checklist: prepared.checklist, prepared }, { status: 400 });
      }
      const { error } = await supabase.from("email_template_registry").upsert({
        key: String(body.key || ""),
        email_type: prepared.type,
        subject: String(body.subject || ""),
        html: String(body.html || ""),
        live: true,
        owner_decision_needed: false,
        category: body.category || null,
        checklist: prepared.checklist,
        updated_at: new Date().toISOString(),
        updated_by: principal.email,
      }, { onConflict: "key" });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, type: prepared.type, warnings: prepared.warnings, checklist: prepared.checklist });
    }
    if (action === "test_send") {
      const to = String(body.to || principal.email);
      const outcome = await deliverCompliantEmail(supabase, {
        to,
        subject: String(body.subject || "Test email"),
        html: String(body.html || "<p>Test</p>"),
        declaredType: String(body.emailType || "customer_service"),
        templateKey: String(body.templateKey || "admin_one_off"),
        category: String(body.category || "") || null,
        testSend: true,
        adminAcknowledged: true,
        staffRecipient: true,
      });
      return NextResponse.json(outcome, { status: outcome.ok ? 200 : outcome.blocked ? 409 : 500 });
    }
    if (action === "subscribe") {
      const current = await loadConsent(supabase, String(body.email || ""));
      const change = applyConsentChange({
        actor: "admin",
        current: current?.status || "unsubscribed",
        next: "subscribed",
        source: "manual",
      });
      return NextResponse.json({ ok: false, error: change.error, smsUnchanged: true }, { status: 403 });
    }
    if (action === "purge") {
      const identity = await loadIdentity(supabase);
      const { data, error } = await supabase.rpc("purge_email_delivery_log", { p_months: identity.retentionMonths });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, removed: data, cutoff: retentionCutoff(new Date().toISOString(), identity.retentionMonths) });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save." }, { status: 500 });
  }
}
