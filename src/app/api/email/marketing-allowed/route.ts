import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { canReceiveMarketing, hasMailingAddress, marketingStreamReady } from "@/lib/email-compliance/engine";
import { isSuppressed, loadConsent, loadIdentity } from "@/lib/email-compliance/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GoHighLevel and any other sender call this before a marketing email.
// One answer for every tool. Service mail does not use this check.
export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.EMAIL_COMPLIANCE_HOOK_KEY || "";
  const given = req.headers.get("x-novara-email-key") || "";
  if (!expected || given !== expected) {
    return NextResponse.json({ ok: false, error: "This check needs the email hook key." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { email?: string; category?: string };
  const email = String(body.email || "").trim();
  if (!email) return NextResponse.json({ ok: false, allowed: false, reason: "An email address is required." }, { status: 400 });
  try {
    const supabase = getAdminSupabase();
    const [identity, consent, suppression] = await Promise.all([
      loadIdentity(supabase),
      loadConsent(supabase, email),
      isSuppressed(supabase, email),
    ]);
    if (!hasMailingAddress(identity.mailingAddress)) {
      return NextResponse.json({ ok: true, allowed: false, reason: "The mailing address is not saved." });
    }
    if (!marketingStreamReady(identity)) {
      return NextResponse.json({ ok: true, allowed: false, reason: "The marketing stream is not separate from service mail." });
    }
    const decision = canReceiveMarketing(consent, body.category || null, suppression.suppressed);
    return NextResponse.json({ ok: true, allowed: decision.ok, reason: decision.reason, smsUnchanged: true });
  } catch (err) {
    return NextResponse.json({ ok: false, allowed: false, reason: err instanceof Error ? err.message : "Check failed." }, { status: 500 });
  }
}
