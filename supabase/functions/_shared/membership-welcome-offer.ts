// One 15% membership offer per customer, sent after a completed cleaning.
// The code applies to the first month only, and only for the address it
// was sent to. Marketing rules (consent, unsubscribe, offer terms) run
// inside the shared Resend sender.

import { deliverCompliantEmail } from "./email-compliance-send.ts";
import { resolveSecret } from "./app-secrets.ts";
import {
  renderWelcomeOfferEmail,
  WELCOME_CODE_PREFIX,
  WELCOME_OFFER_TERMS,
  WELCOME_PERCENT,
  WELCOME_VALID_DAYS,
  welcomeClaimUrl,
} from "./membership-welcome-copy.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const MEMBER_PLANS = new Set(["weekly", "biweekly", "monthly"]);

function code(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return WELCOME_CODE_PREFIX + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function token(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function expiresLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "30 days after your cleaning";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

async function alreadyAMember(supabase: Db, booking: Record<string, unknown>, email: string): Promise<boolean> {
  const plan = String(booking.membership_plan || "").trim().toLowerCase();
  if (MEMBER_PLANS.has(plan) || booking.uses_credit === true) return true;
  const { data } = await supabase
    .from("membership_credits")
    .select("status")
    .ilike("email", email)
    .eq("status", "active")
    .limit(1);
  return Boolean(data?.length);
}

/**
 * Send the welcome offer once. Safe to call every time a booking is
 * completed: a second call for the same email does nothing.
 */
export async function sendMembershipWelcomeOffer(
  supabase: Db,
  booking: Record<string, unknown>,
): Promise<{ sent: boolean; reason: string }> {
  const email = String(booking.email || "").trim().toLowerCase();
  if (!email || booking.is_reclean === true) return { sent: false, reason: "skipped" };
  if (await alreadyAMember(supabase, booking, email)) return { sent: false, reason: "already-member" };

  const { data: prior } = await supabase
    .from("membership_welcome_offers")
    .select("id, status, token, promo_code, expires_at, sent_at")
    .ilike("email", email)
    .limit(1);
  const existing = prior?.[0] as { id: string; status: string; token: string; promo_code: string; expires_at: string; sent_at: string | null } | undefined;
  if (existing?.sent_at || existing?.status === "claimed") return { sent: false, reason: "already-sent" };

  const expires = new Date(Date.now() + WELCOME_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let offer = existing;
  if (!offer) {
    const row = {
      booking_id: booking.id,
      email,
      first_name: booking.first_name || null,
      token: token(),
      promo_code: code(),
      percent_off: WELCOME_PERCENT,
      status: "pending",
      expires_at: expires,
    };
    const { data, error } = await supabase.from("membership_welcome_offers").insert(row).select("id, token, promo_code, expires_at, sent_at, status").maybeSingle();
    if (error || !data) return { sent: false, reason: "not-saved" };
    offer = data;
    const { error: promoError } = await supabase.from("promo_codes").insert({
      code: offer.promo_code,
      type: "percent",
      value: WELCOME_PERCENT,
      active: true,
      expires_at: expires,
      applies_to: "membership_welcome",
      max_uses_per_customer: 1,
      max_total_uses: 1,
    });
    if (promoError) console.warn("[membership-welcome] promo code not saved", promoError.message);
  }

  const apiKey = await resolveSecret(supabase, "RESEND_API_KEY");
  const url = welcomeClaimUrl(offer.token);
  const result = await deliverCompliantEmail(supabase, {
    apiKey,
    to: email,
    subject: "Your Glow membership offer: 15% off the first month",
    html: renderWelcomeOfferEmail({
      firstName: String(booking.first_name || ""),
      code: offer.promo_code,
      url,
      expiresLabel: expiresLabel(offer.expires_at),
    }),
    templateKey: "membership_welcome_offer",
    declaredType: "customer_marketing",
    offerTerms: WELCOME_OFFER_TERMS,
    bookingId: String(booking.id),
    category: "offers",
  });
  if (!result.ok) {
    console.warn("[membership-welcome] not sent", result.error);
    // A block is a decision (no consent, suppressed, unapproved claim), not a
    // delivery failure. Drop the unsent offer so a later completed visit can
    // try again once the address is allowed to receive it.
    if (result.blocked) {
      await supabase.from("membership_welcome_offers").delete().eq("id", offer.id);
      await supabase.from("promo_codes").delete().eq("code", offer.promo_code);
    }
    return { sent: false, reason: result.blocked ? "blocked" : "failed" };
  }
  await supabase.from("membership_welcome_offers").update({
    status: "sent",
    sent_at: new Date().toISOString(),
  }).eq("id", offer.id);
  return { sent: true, reason: "sent" };
}

export async function lookupWelcomeOffer(supabase: Db, codeValue: string, email: string): Promise<{
  id: string;
  promo_code: string;
  percent_off: number;
} | null> {
  const code = String(codeValue || "").trim().toUpperCase();
  const to = String(email || "").trim().toLowerCase();
  if (!code.startsWith(WELCOME_CODE_PREFIX) || !to) return null;
  const { data } = await supabase
    .from("membership_welcome_offers")
    .select("id, email, promo_code, percent_off, status, expires_at")
    .eq("promo_code", code)
    .maybeSingle();
  if (!data) return null;
  if (String(data.email || "").toLowerCase() !== to) return null;
  if (data.status !== "sent") return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return { id: data.id, promo_code: data.promo_code, percent_off: Number(data.percent_off) || WELCOME_PERCENT };
}

export async function markWelcomeOfferClaimed(supabase: Db, codeValue: string): Promise<void> {
  const code = String(codeValue || "").trim().toUpperCase();
  if (!code) return;
  const now = new Date().toISOString();
  await supabase.from("membership_welcome_offers").update({ status: "claimed", claimed_at: now }).eq("promo_code", code).eq("status", "sent");
  await supabase.from("promo_codes").update({ active: false, total_uses: 1 }).eq("code", code);
}
