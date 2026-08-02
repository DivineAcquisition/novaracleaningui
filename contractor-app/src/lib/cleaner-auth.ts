// Cleaner auth resolution — the native mirror of src/lib/cleaner-auth.ts in
// the web app. Both call the same `resolve_or_link_cleaner_for_user` RPC so a
// cleaner who was invited by an admin (cleaners row exists, user_id is NULL)
// gets linked by email on first sign-in exactly as they do on the web.

import { supabase } from "./supabase";

export interface ResolvedCleaner {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  home_zip: string | null;
  onboarding_complete: boolean | null;
  approved: boolean | null;
  status: string | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean | null;
  phone_verified: boolean | null;
  pay_tier: string | null;
  pay_percentage: number | null;
}

export type CleanerRouting = "auth" | "onboarding" | "dashboard";

export interface CleanerAuthResolution {
  cleaner: ResolvedCleaner | null;
  routing: CleanerRouting;
  sessionUserId: string | null;
  sessionEmail: string | null;
}

// "suspended" is deliberately absent: a suspension pauses new dispatch only,
// and the cleaner keeps portal access to work jobs they already hold and see
// their pay.
export const BLOCKED_CLEANER_STATUSES = [
  "terminated",
  "fired",
  "inactive",
  "deactivated",
] as const;

export function isBlockedCleanerStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (BLOCKED_CLEANER_STATUSES as readonly string[]).includes(status.toLowerCase());
}

export async function resolveCleanerAuth(): Promise<CleanerAuthResolution> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return { cleaner: null, routing: "auth", sessionUserId: null, sessionEmail: null };
  }

  const email = session.user.email || "";
  const { data, error } = await supabase.rpc("resolve_or_link_cleaner_for_user", {
    p_email: email,
  });

  if (error) {
    // Same fallback as the web helper — a transient RPC outage must not lock
    // a cleaner out of their jobs.
    console.warn("[cleaner-auth] resolver RPC failed, falling back", error.message);
    const { data: fallback } = await supabase
      .from("cleaners")
      .select(
        "id, user_id, first_name, last_name, email, phone, home_zip, onboarding_complete, approved, status, stripe_account_id, payouts_enabled, phone_verified, pay_tier, pay_percentage",
      )
      .eq("user_id", session.user.id)
      .maybeSingle();

    return {
      cleaner: (fallback as ResolvedCleaner) ?? null,
      routing: fallback?.onboarding_complete ? "dashboard" : "onboarding",
      sessionUserId: session.user.id,
      sessionEmail: email,
    };
  }

  const cleaner = (Array.isArray(data) ? data[0] : null) as ResolvedCleaner | null;

  return {
    cleaner,
    routing: cleaner?.onboarding_complete ? "dashboard" : "onboarding",
    sessionUserId: session.user.id,
    sessionEmail: email,
  };
}
