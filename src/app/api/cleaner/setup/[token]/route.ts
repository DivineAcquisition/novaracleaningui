// Tokenized account-setup landing — no login required to view status.
// Continue CTA sends them to /cleaner/auth?setup=<token> so they can finish
// phone verify + Stripe in the normal portal.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { isCleanerSetupComplete } from "@/lib/cleaner-supplies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const token = String(raw || "").trim();
  if (token.length < 16) {
    return NextResponse.json({ error: "Invalid setup link.", reason: "invalid" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: cleaner, error } = await (supabase.from as any)("cleaners")
    .select(
      "id, first_name, last_name, email, phone, status, phone_verified, payouts_enabled, ob_payouts_setup, stripe_account_id, onboarding_complete, setup_token_expires_at, ob_agreement_signed",
    )
    .eq("setup_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message, reason: "error" }, { status: 500 });
  }
  if (!cleaner) {
    return NextResponse.json(
      { error: "This setup link isn't valid — ask Novara for a fresh one.", reason: "invalid" },
      { status: 404 },
    );
  }

  if (String(cleaner.status) === "terminated") {
    return NextResponse.json(
      { error: "This account is no longer active.", reason: "terminated" },
      { status: 409 },
    );
  }

  const expired =
    cleaner.setup_token_expires_at &&
    new Date(String(cleaner.setup_token_expires_at)).getTime() < Date.now();
  if (expired) {
    return NextResponse.json(
      {
        error: "This setup link has expired. Ask Novara to resend it.",
        reason: "expired",
      },
      { status: 410 },
    );
  }

  const complete = isCleanerSetupComplete(cleaner);
  return NextResponse.json({
    ok: true,
    complete,
    cleaner: {
      firstName: cleaner.first_name || "",
      lastName: cleaner.last_name || "",
      name: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
      email: cleaner.email || "",
    },
    steps: {
      phoneVerified: Boolean(cleaner.phone_verified),
      stripeReady:
        Boolean(cleaner.payouts_enabled) ||
        Boolean(cleaner.ob_payouts_setup) ||
        Boolean(cleaner.stripe_account_id),
      agreementSigned: Boolean(cleaner.ob_agreement_signed),
      onboardingComplete: Boolean(cleaner.onboarding_complete),
    },
    expiresAt: cleaner.setup_token_expires_at || null,
    continueUrl: `/cleaner/auth?setup=${encodeURIComponent(token)}`,
  });
}
