// ─── POST /api/cleaner/sign-agreement ─────────────────────────────────────────
//
// A contractor signs their Independent Contractor Agreement during onboarding.
// Authenticated by the contractor's own Supabase session (the agreement is
// always sent to THEIR own email). Creates a COMPLETED DocuSeal submission with
// the mapped contractor fields + their drawn signature, and DocuSeal emails them
// the finished copy. Also stamps cleaners.ob_agreement_signed when a row exists.
//
// Body: { firstName?, lastName?, phone?, address?, legalName?, signatureDataUrl? }

import { NextResponse } from "next/server";
import { requireUser, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendAgreement, buildContractorValues } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }
  if (!user.email) return NextResponse.json({ error: "No email on your account." }, { status: 400 });

  let body: {
    firstName?: string; lastName?: string; phone?: string; address?: string;
    legalName?: string; signatureDataUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = `${body.firstName || ""} ${body.lastName || ""}`.trim() || undefined;
  const values = buildContractorValues({
    name,
    legalName: body.legalName || name,
    email: user.email,
    phone: body.phone || undefined,
    address: body.address || undefined,
  });

  try {
    const supabase = getAdminSupabase();

    // Idempotent: one contractor agreement per cleaner. Reuse the existing one
    // (so re-signing doesn't spam duplicates).
    const { data: existing } = await supabase
      .from("docuseal_submissions")
      .select("id, submission_id, document_url")
      .eq("cleaner_id", user.userId)
      .eq("audience", "contractor")
      .limit(1);
    // (cleaner_id stores the auth user id here for the onboarding context.)

    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, alreadySigned: true, submissionId: existing[0].submission_id });
    }

    const result = await sendAgreement({
      audience: "contractor",
      email: user.email,
      name,
      values,
      signatureImage: body.signatureDataUrl,
      cleanerId: user.userId,
      createdBy: "cleaner:onboarding",
      metadata: { source: "cleaner-onboarding" },
    });

    // Best-effort: stamp the cleaner row if it already exists.
    try {
      await supabase
        .from("cleaners")
        .update({ ob_agreement_signed: true, ob_agreement_signed_at: new Date().toISOString() })
        .eq("user_id", user.userId);
    } catch {
      /* row may not exist yet — onboarding submit also sets this */
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[cleaner/sign-agreement]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
