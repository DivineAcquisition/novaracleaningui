import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { suppressAddress } from "@/lib/email-compliance/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard bounces and spam complaints join the same suppression list.
export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.EMAIL_COMPLIANCE_HOOK_KEY || "";
  const given = req.headers.get("x-novara-email-key") || "";
  if (!expected || given !== expected) {
    return NextResponse.json({ ok: false, error: "This check needs the email hook key." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { email?: string; type?: string };
  const email = String(body.email || "").trim();
  const type = body.type === "complaint" ? "complaint" : body.type === "bounce" ? "bounce" : "";
  if (!email || !type) {
    return NextResponse.json({ ok: false, error: "email and type (bounce or complaint) are required." }, { status: 400 });
  }
  try {
    const result = await suppressAddress(getAdminSupabase(), {
      email,
      reason: type,
      source: "provider",
      actor: "system",
    });
    return NextResponse.json({ ok: result.ok, at: result.at, smsUnchanged: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Could not suppress." }, { status: 500 });
  }
}
