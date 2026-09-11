// ─── POST /api/cleaner/acknowledge-standards ─────────────────────────────────
//
// A new contractor acknowledges the Contractor Standards & Conduct Addendum
// during onboarding, authenticated by their own Supabase session. Existing
// contractors use the tokenized page instead (/api/cleaner/standards/[token]);
// both land in the same ledger.
//
// Both writes happen here — the append-only acknowledgment row AND the version
// stamp on the contractor — rather than letting the wizard stamp the version in
// its own upsert alongside ob_agreement_signed. If this call fails, the
// contractor is simply still recorded as owing an acknowledgment and the admin
// panel texts them a link. That is the right way round: a stamped version with
// no evidence behind it is worse than an extra text message.
//
// Body: { legalName?, signatureDataUrl }

import { NextResponse } from "next/server";
import { requireUser, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  CONTRACTOR_STANDARDS_ACKNOWLEDGMENT,
  CONTRACTOR_STANDARDS_VERSION,
  standardsStanding,
} from "@/lib/contractor-standards";

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

  let body: { legalName?: string; signatureDataUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const signature = String(body.signatureDataUrl || "").trim();
  if (!signature.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "Please sign the standards before submitting." },
      { status: 400 },
    );
  }

  const supabase = getAdminSupabase();

  const { data } = await (supabase.from as any)("cleaners")
    .select(
      "id, first_name, last_name, conduct_standards_version, conduct_standards_acknowledged_at",
    )
    .eq("user_id", user.userId)
    .maybeSingle();
  const cleaner = (data || null) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    conduct_standards_version: string | null;
    conduct_standards_acknowledged_at: string | null;
  } | null;

  // The wizard creates the contractor row before calling this, so a miss means
  // that upsert failed and there is nothing to attach the acknowledgment to.
  if (!cleaner) {
    return NextResponse.json({ error: "No contractor profile found for your account." }, { status: 404 });
  }

  if (standardsStanding(cleaner) === "current") {
    return NextResponse.json({
      ok: true,
      alreadyAcknowledged: true,
      acknowledgedAt: cleaner.conduct_standards_acknowledged_at,
    });
  }

  const legalName =
    String(body.legalName || "").trim() ||
    `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim();
  const acknowledgedAt = new Date().toISOString();

  const { error: ackErr } = await (supabase.from as any)("cleaner_conduct_acknowledgments")
    .upsert(
      {
        cleaner_id: cleaner.id,
        version: CONTRACTOR_STANDARDS_VERSION,
        acknowledged_at: acknowledgedAt,
        source: "onboarding",
        legal_name: legalName || null,
        signature_data_url: signature,
        acknowledgment_text: CONTRACTOR_STANDARDS_ACKNOWLEDGMENT,
        ip_address:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          req.headers.get("x-real-ip") ||
          null,
        user_agent: req.headers.get("user-agent"),
      },
      { onConflict: "cleaner_id,version" },
    );

  if (ackErr) {
    // eslint-disable-next-line no-console
    console.error("[cleaner/acknowledge-standards]", ackErr.message);
    return NextResponse.json({ error: ackErr.message }, { status: 502 });
  }

  const { error: upErr } = await (supabase.from as any)("cleaners")
    .update({
      conduct_standards_version: CONTRACTOR_STANDARDS_VERSION,
      conduct_standards_acknowledged_at: acknowledgedAt,
      updated_at: acknowledgedAt,
    })
    .eq("id", cleaner.id);
  if (upErr) {
    // eslint-disable-next-line no-console
    console.error("[cleaner/acknowledge-standards] version stamp failed", upErr.message);
  }

  await supabase
    .from("events")
    .insert({
      event_type: "cleaner.standards_acknowledged",
      cleaner_id: cleaner.id,
      source: "onboarding",
      summary:
        `📋 ${legalName || "A new contractor"} acknowledged the Contractor Standards ` +
        `(${CONTRACTOR_STANDARDS_VERSION}) during onboarding.`,
      data: {
        cleaner_id: cleaner.id,
        version: CONTRACTOR_STANDARDS_VERSION,
        previous_version: cleaner.conduct_standards_version,
        via: "onboarding",
      },
    })
    .then(() => undefined, () => undefined);

  return NextResponse.json({ ok: true, acknowledgedAt, version: CONTRACTOR_STANDARDS_VERSION });
}
