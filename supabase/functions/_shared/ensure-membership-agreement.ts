// Fire-and-forget the Next.js membership-agreement ensure route.
// Edge functions cannot import src/lib/docuseal; they POST to the same
// secret-gated endpoint the booking-confirm trigger uses.

import { resolveSecret } from "./app-secrets.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = { from: (table: string) => any };

export type MembershipAgreementPing = {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  plan?: string | null;
  serviceAddress?: string | null;
  firstServiceDate?: string | null;
  membershipRateCents?: number | null;
  oneTimeRateCents?: number | null;
  initialDeepClean?: string | null;
  homeSizeId?: string | null;
  scheduleId?: string | null;
  sendEmail?: boolean;
};

function deriveEnsureUrl(bookingAgreementUrl: string): string {
  const trimmed = bookingAgreementUrl.trim();
  if (!trimmed) return "";
  if (trimmed.includes("/api/bookings/send-agreement")) {
    return trimmed.replace("/api/bookings/send-agreement", "/api/memberships/ensure-agreement");
  }
  try {
    const u = new URL(trimmed);
    u.pathname = "/api/memberships/ensure-agreement";
    u.search = "";
    return u.toString();
  } catch {
    return "";
  }
}

export async function pingEnsureMembershipAgreement(
  supabase: SupabaseClientLike,
  payload: MembershipAgreementPing,
): Promise<void> {
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return;

  try {
    const secret = await resolveSecret(supabase, "BOOKING_AGREEMENT_SECRET");
    let url = await resolveSecret(supabase, "MEMBERSHIP_AGREEMENT_URL");
    if (!url) {
      url = deriveEnsureUrl(await resolveSecret(supabase, "BOOKING_AGREEMENT_URL"));
    }
    if (!secret || !url || !/^https?:\/\//i.test(url)) {
      console.warn("[ensure-membership-agreement] skipped — URL or secret missing");
      return;
    }

    const body: Record<string, unknown> = {
      email,
      name: payload.name || undefined,
      phone: payload.phone || undefined,
      plan: payload.plan || undefined,
      serviceAddress: payload.serviceAddress || undefined,
      firstServiceDate: payload.firstServiceDate || undefined,
      membershipRateCents: payload.membershipRateCents ?? undefined,
      oneTimeRateCents: payload.oneTimeRateCents ?? undefined,
      initialDeepClean: payload.initialDeepClean || undefined,
      homeSizeId: payload.homeSizeId || undefined,
      scheduleId: payload.scheduleId || undefined,
      sendEmail: payload.sendEmail !== false,
      holdPayment: false,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-booking-secret": secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[ensure-membership-agreement] HTTP", res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.warn(
      "[ensure-membership-agreement]",
      err instanceof Error ? err.message : String(err),
    );
  }
}
