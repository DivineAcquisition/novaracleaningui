// ─── POST /api/talent/invite/redeem ───────────────────────────────────────────
//
// Public redeem for tokenized contractor onboarding invites. The Talent hub
// mints invite_token on launch/resend; the link lands on
// contractor.novaracleaning.com/cleaner/auth?invite=<token> so the applicant
// skips the /cleaner/role video and enters the normal auth → onboarding flow.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { inviteToken?: string };
  try {
    body = (await req.json()) as { inviteToken?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = String(body.inviteToken || "").trim();
  if (token.length < 16) {
    return NextResponse.json({ error: "Invalid invite link." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: row, error } = await supabase
    .from("cleaner_applicants")
    .select(
      "id, email, first_name, last_name, full_name, stage, invite_expires_at, cleaner_id",
    )
    .eq("invite_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: "This invite link isn't valid — ask recruiting for a fresh one." },
      { status: 404 },
    );
  }

  if (["rejected", "withdrawn"].includes(String(row.stage))) {
    return NextResponse.json(
      { error: `This application is ${row.stage} — contact recruiting if that seems wrong.` },
      { status: 409 },
    );
  }

  if (row.stage === "active") {
    return NextResponse.json(
      { error: "You're already active — sign in to your contractor portal instead." },
      { status: 409 },
    );
  }

  const expired =
    !row.invite_expires_at || new Date(String(row.invite_expires_at)).getTime() < Date.now();
  if (expired) {
    return NextResponse.json(
      {
        error:
          "This invite link has expired. Ask recruiting to resend your onboarding invite.",
        expired: true,
      },
      { status: 410 },
    );
  }

  return NextResponse.json({
    ok: true,
    applicantId: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    stage: row.stage,
    cleanerId: row.cleaner_id,
  });
}
