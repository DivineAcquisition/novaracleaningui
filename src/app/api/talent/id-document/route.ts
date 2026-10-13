// ─── GET /api/talent/id-document?applicantId= ────────────────────────────────
//
// Short-lived signed URL for the government-issued photo ID stored in the
// private applicant-ids bucket. Admin and VA only.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { APPLICANT_ID_BUCKET } from "@/lib/hiring/application";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  const applicantId = new URL(req.url).searchParams.get("applicantId")?.trim() || "";
  if (!applicantId) {
    return NextResponse.json({ error: "Missing applicant." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("cleaner_applicants")
    .select("government_id_path")
    .eq("id", applicantId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const path = (data?.government_id_path as string | null) || "";
  if (!path) return NextResponse.json({ error: "No photo ID is stored for this applicant." }, { status: 404 });

  const { data: signed, error: signErr } = await supabase.storage
    .from(APPLICANT_ID_BUCKET)
    .createSignedUrl(path, 300);
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: "Couldn’t open the ID." }, { status: 500 });
  }
  return NextResponse.json({ url: signed.signedUrl });
}
