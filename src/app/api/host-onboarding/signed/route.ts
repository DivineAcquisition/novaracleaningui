// ─── POST /api/host-onboarding/signed ─────────────────────────────────────
//
// Document-signed webhook target (spec §5.4). Wire a GHL Workflow "on document
// signed" to POST here. Flips Onboarding Stage → "Signed" + Agreement Signed
// in both Airtable and GHL, and activates the host's properties.
//
// Secret-gated via `x-host-onboarding-secret` (or ?secret=) against
// HOST_ONBOARDING_ADMIN_SECRET. Identify the host by submissionId, email, or
// ghl_contact_id (GHL workflows can send any of these).

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import { markHostAgreementSigned } from "@/lib/airtable";
import { invokeHostOnboardingGhl } from "@/lib/host-onboarding/ghl";
import { portalHomeUrl } from "@/lib/partner-portal/origins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.HOST_ONBOARDING_ADMIN_SECRET;
  if (!expected) return false;
  const header = req.headers.get("x-host-onboarding-secret");
  const query = new URL(req.url).searchParams.get("secret");
  return header === expected || query === expected;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { submissionId?: string; email?: string; contactId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  let q = supabase.from("host_onboarding_submissions").select("*").limit(1);
  if (body.submissionId) q = q.eq("id", body.submissionId);
  else if (body.email) q = q.eq("email", body.email.toLowerCase());
  else if (body.contactId) q = q.eq("ghl_contact_id", body.contactId);
  else return NextResponse.json({ error: "submissionId, email, or contactId required" }, { status: 400 });

  const { data: rows } = await q;
  const submission = rows?.[0];
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

  const warnings: string[] = [];

  // Airtable: Client Signed + properties Active.
  try {
    const propertyIds: string[] = Array.isArray(submission.airtable_property_ids)
      ? submission.airtable_property_ids
      : [];
    await markHostAgreementSigned(submission.email, propertyIds);
  } catch (err) {
    warnings.push(`Airtable update failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // GHL: Signed + Active.
  const ghl = await invokeHostOnboardingGhl("markSigned", {
    contactId: submission.ghl_contact_id,
    email: submission.email,
    opportunityId: submission.ghl_opportunity_id,
  });
  if (!ghl.ok && ghl.error) warnings.push(`GHL update failed: ${ghl.error}`);

  await supabase
    .from("host_onboarding_submissions")
    .update({
      status: "signed",
      agreement_signed_at: new Date().toISOString(),
      sync_error: warnings.length ? warnings.join(" | ") : null,
    })
    .eq("id", submission.id);

  // Activate the host's Supabase properties (portal bookability) now that the
  // agreement is signed. Pricing still gates bookings (NULL price = pending).
  if (submission.host_id) {
    try {
      await supabase.from("hosts").update({ status: "active" }).eq("id", submission.host_id);
    } catch { /* best-effort */ }
  }

  // Lifecycle comms — "you're active" (email via Resend + SMS via GHL).
  const firstName = (submission.full_name || "").split(" ")[0] || "there";
  try {
    await sendPartnershipMessage(supabase, {
      templateKey: "host_agreement_signed",
      trigger: "host-onboarding.agreement_signed",
      email: submission.email,
      phone: submission.phone,
      hostId: submission.host_id || null,
      vars: {
        first_name: firstName,
        link: portalHomeUrl(),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, signed: true, warnings: warnings.length ? warnings : undefined });
}
