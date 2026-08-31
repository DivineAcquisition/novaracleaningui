// ─── POST /api/host-onboarding ────────────────────────────────────────────
//
// The host onboarding submit handler. Fans the form out to (spec §3):
//   1. Supabase  — persist the submission + click-wrap consent (timestamp/IP).
//   2. Airtable  — upsert Client (STR Host) → Properties (Pending Pricing).
//   3. GHL       — upsert contact + custom fields + opportunity (entity-aware).
//
// Idempotent (upserts on email / nickname). Partial-failure tolerant: if a
// downstream sync fails the submission is still saved and the error recorded
// for retry — we never silently drop the sync (spec §6).

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import { syncHostOnboardingToAirtable } from "@/lib/airtable";
import { invokeHostOnboardingGhl } from "@/lib/host-onboarding/ghl";
import { provisionHostAccount } from "@/lib/host-onboarding/provision";
import {
  normalizeOnboarding,
  validateOnboarding,
  type OnboardingFormPayload,
} from "@/lib/host-onboarding/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "";
}

export async function POST(req: Request): Promise<NextResponse> {
  let raw: OnboardingFormPayload;
  try {
    raw = (await req.json()) as OnboardingFormPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateOnboarding(raw);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const payload = normalizeOnboarding(raw);

  const consentIp = clientIp(req);
  const consentUserAgent = req.headers.get("user-agent") || "";
  const consentTimestamp = new Date().toISOString();

  // 1. Persist the submission (consent evidence trail) first so nothing is lost.
  const supabase = getAdminSupabase();
  const { data: submission, error: insertErr } = await supabase
    .from("host_onboarding_submissions")
    .insert({
      full_name: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      entity_type: payload.entityType,
      entity_name: payload.entityName || null,
      service_zone: payload.serviceZone || null,
      properties: payload.properties,
      consent_agreement: payload.consentAgreement,
      consent_timestamp: consentTimestamp,
      consent_ip: consentIp || null,
      consent_user_agent: consentUserAgent || null,
      status: "pending_pricing",
    })
    .select("id")
    .single();

  if (insertErr || !submission) {
    return NextResponse.json(
      { error: `Could not save your application: ${insertErr?.message || "unknown"}` },
      { status: 500 },
    );
  }
  const submissionId = submission.id as string;

  const warnings: string[] = [];
  let airtableClientId: string | null = null;
  let airtablePropertyIds: string[] = [];
  let ghlContactId: string | null = null;
  let ghlOpportunityId: string | null = null;

  // 1b. Seamless auth — provision the Host Portal account (auth user + host +
  // Pending-Pricing properties) so the host lands logged in. Best-effort:
  // a failure here never blocks the saved submission.
  const provision = await provisionHostAccount(supabase, payload);
  if (provision.error) warnings.push(`Account setup deferred: ${provision.error}`);

  // 2. Airtable (Client → Properties). Retry once on failure before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await syncHostOnboardingToAirtable({
        fullName: payload.fullName,
        email: payload.email,
        phone: payload.phone,
        entityType: payload.entityType,
        entityName: payload.entityName,
        serviceZone: payload.serviceZone,
        properties: payload.properties,
      });
      airtableClientId = res.clientRecordId;
      airtablePropertyIds = res.propertyRecordIds;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 1) warnings.push(`Airtable sync failed: ${msg}`);
      else await new Promise((r) => setTimeout(r, 800));
    }
  }

  // 3. GHL contact + opportunity (entity-aware). Best-effort.
  const ghl = await invokeHostOnboardingGhl("submit", {
    fullName: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    entityType: payload.entityType,
    entityName: payload.entityName,
    serviceZone: payload.serviceZone,
    propertyCount: payload.properties.length,
  });
  if (ghl.ok) {
    ghlContactId = ghl.contactId ?? null;
    ghlOpportunityId = ghl.opportunityId ?? null;
  } else if (ghl.error) {
    warnings.push(`GHL sync failed: ${ghl.error}`);
  }

  // Persist resolved ids + any warning for retry/visibility.
  await supabase
    .from("host_onboarding_submissions")
    .update({
      airtable_client_id: airtableClientId,
      airtable_property_ids: airtablePropertyIds,
      ghl_contact_id: ghlContactId,
      ghl_opportunity_id: ghlOpportunityId,
      user_id: provision.userId,
      host_id: provision.hostId,
      account_created: provision.accountCreated,
      sync_error: warnings.length ? warnings.join(" | ") : null,
    })
    .eq("id", submissionId);

  // 4. Lifecycle comms — "application received" (email via Resend + SMS via GHL).
  // Best-effort: a comms hiccup never fails the submission.
  const firstName = payload.fullName.split(" ")[0] || "there";
  try {
    await sendPartnershipMessage(supabase, {
      templateKey: "host_application_received",
      trigger: "host-onboarding.application_received",
      email: payload.email,
      phone: payload.phone,
      hostId: provision.hostId || null,
      vars: {
        first_name: firstName,
        propertyCount: String(payload.properties.length),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    ok: true,
    submissionId,
    // Tells the client whether to auto sign-in (created) or prompt login
    // (the email already had a portal account).
    accountCreated: provision.accountCreated,
    accountExists: provision.accountExists,
    warnings: warnings.length ? warnings : undefined,
  });
}
