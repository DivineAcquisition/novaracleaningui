import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { applyConsentChange } from "@/lib/email-compliance/engine";
import {
  emailForToken,
  loadConsent,
  loadIdentity,
  resubscribeAddress,
  saveCategoryChoices,
  withdrawTaxConsent,
} from "@/lib/email-compliance/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 2)}***@${domain}` : email;
}

export async function GET(req: Request): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get("t") || "";
  if (!token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  try {
    const supabase = getAdminSupabase();
    const email = await emailForToken(supabase, token);
    if (!email) return NextResponse.json({ ok: false, error: "This link is not valid." }, { status: 404 });
    const [identity, consent] = await Promise.all([loadIdentity(supabase), loadConsent(supabase, email)]);
    return NextResponse.json({
      ok: true,
      email: maskEmail(email),
      status: consent?.status || "not_asked",
      categories: identity.marketingCategories,
      choices: consent?.categories || null,
      serviceContinues: true,
      smsUnchanged: true,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Could not load preferences." }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.t || "");
  if (!token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  try {
    const supabase = getAdminSupabase();
    const email = await emailForToken(supabase, token);
    if (!email) return NextResponse.json({ ok: false, error: "This link is not valid." }, { status: 404 });
    if (body.resubscribe === true) {
      const current = await loadConsent(supabase, email);
      const gate = applyConsentChange({
        actor: "contact",
        current: current?.status || "not_asked",
        next: "subscribed",
        source: "preference_page",
      });
      if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
      const saved = await resubscribeAddress(supabase, { email, source: "preference_page" });
      return NextResponse.json({ ...saved, smsUnchanged: true });
    }
    if (body.withdrawTax === true) {
      const withdrawn = await withdrawTaxConsent(supabase, email);
      return NextResponse.json({ ok: withdrawn.ok, taxWithdrawn: true, at: withdrawn.at, smsUnchanged: true });
    }
    if (body.categories && typeof body.categories === "object") {
      await saveCategoryChoices(supabase, email, body.categories as Record<string, boolean>);
      return NextResponse.json({
        ok: true,
        smsUnchanged: true,
        serviceContinues: true,
      });
    }
    return NextResponse.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Could not save preferences." }, { status: 500 });
  }
}
