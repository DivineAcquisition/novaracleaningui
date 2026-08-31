// ─── POST /api/host-onboarding/send-contract ──────────────────────────────
//
// Admin/automation step (spec §5.3): once an admin has set every property's
// rate in Airtable, send the partnership agreement WITH the populated rate
// schedule for signature. Hard guardrail: if any property is still unpriced we
// REFUSE — no one signs a blank-rate schedule (spec §5 / §6).
//
// Secret-gated via `x-host-onboarding-secret` (or ?secret=) against
// HOST_ONBOARDING_ADMIN_SECRET.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { markHostAgreementSent, readPropertyRates } from "@/lib/airtable";
import { invokeHostOnboardingGhl } from "@/lib/host-onboarding/ghl";
import { startHostOnboardingSession } from "@/lib/host-onboarding/admin";

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

  let body: { submissionId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const query = supabase.from("host_onboarding_submissions").select("*").limit(1);
  const { data: rows, error } = body.submissionId
    ? await query.eq("id", body.submissionId)
    : body.email
      ? await query.eq("email", body.email.toLowerCase())
      : { data: null, error: { message: "submissionId or email required" } as { message: string } };
  const submission = rows?.[0];
  if (error || !submission) {
    return NextResponse.json({ error: error?.message || "Submission not found" }, { status: 404 });
  }

  // Guardrail: every property must be priced before we send for signature.
  const propertyIds: string[] = Array.isArray(submission.airtable_property_ids)
    ? submission.airtable_property_ids
    : [];
  const rates = await readPropertyRates(propertyIds);
  const unpriced = rates.filter((r) => !r.standardTurnoverRate || r.standardTurnoverRate <= 0);
  if (rates.length === 0 || unpriced.length > 0) {
    return NextResponse.json(
      {
        error: "Cannot send — set every property's rate first.",
        unpriced: unpriced.map((r) => r.nickname),
      },
      { status: 409 },
    );
  }

  // Build a human rate summary that the GHL document merge can surface.
  const rateSummary = rates
    .map((r) => `${r.nickname}: $${r.standardTurnoverRate}${r.introRate ? ` (intro $${r.introRate})` : ""}/turnover`)
    .join("; ");

  // Flip Airtable Onboarding Stage → Agreement Sent.
  try {
    await markHostAgreementSent(submission.email);
  } catch (err) {
    return NextResponse.json(
      { error: `Airtable update failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Trigger the entity-aware GHL document send.
  const ghl = await invokeHostOnboardingGhl("sendForSignature", {
    contactId: submission.ghl_contact_id,
    email: submission.email,
    entityType: submission.entity_type,
    entityName: submission.entity_name,
    rateSummary,
    opportunityId: submission.ghl_opportunity_id,
  });

  await supabase
    .from("host_onboarding_submissions")
    .update({ status: "agreement_sent", sync_error: ghl.ok ? null : `GHL send failed: ${ghl.error}` })
    .eq("id", submission.id);

  let session: { ok: boolean; link?: string; emailed?: boolean; texted?: boolean; message?: string } | null = null;
  let hostId = (submission.host_id as string) || null;
  if (!hostId && submission.email) {
    const { data: hostRow } = await supabase
      .from("hosts")
      .select("id")
      .eq("email", String(submission.email).toLowerCase())
      .maybeSingle();
    hostId = (hostRow?.id as string) || null;
  }
  if (hostId) {
    session = await startHostOnboardingSession(supabase, {
      hostId,
      actorName: "send-contract",
      recipientEmail: submission.email,
      send: true,
    });
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    ghl: ghl.ok,
    rateSummary,
    onboarding: session,
  });
}
