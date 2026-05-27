// ─── Cleaner auth-resolution helper ─────────────────────────────────────
//
// Every auth-gated cleaner view (Auth, AuthCallback, Onboarding, Dashboard,
// MobileDashboard, OnboardingPortal) calls into this helper instead of
// directly querying `cleaners` by `user_id`. The helper centralizes:
//
//   1. user_id → cleaner row lookup
//   2. email → cleaner row LINKING when the row exists but user_id is NULL
//      (this is the common state for admin-invited cleaners and rows
//       migrated in from earlier platforms)
//   3. auto-promotion of `onboarding_complete = true` when the cleaner has
//      a real first_name + last_name + phone + home_zip filled in (i.e.
//      they DID finish the wizard, but the flag was never stamped because
//      of an interrupted submit or an older version of the wizard).
//
// All three behaviors are implemented in the
// `resolve_or_link_cleaner_for_user(p_email)` RPC (SECURITY DEFINER) so
// RLS doesn't block the cross-row link, and so the client always gets
// a consistent answer regardless of which view called it.
//
// Return contract:
//   { cleaner, routing }
//     cleaner: ResolvedCleaner | null
//     routing: "dashboard" | "onboarding" | "auth"
//
//   "auth"        — no active session, redirect to /cleaner/auth
//   "onboarding"  — session exists but no cleaner row at all (genuine
//                   first-time signup), redirect to /cleaner/onboarding
//   "dashboard"   — cleaner row exists and onboarding_complete is true
//
// When `routing === "dashboard"` the caller can also inspect
// `cleaner.status` to gate access for suspended / terminated / fired
// accounts — see BLOCKED_STATUSES below.

import { supabase } from "@/integrations/supabase/client";

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
  was_linked: boolean | null;
  was_auto_promoted: boolean | null;
}

export type CleanerRouting = "auth" | "onboarding" | "dashboard";

export interface CleanerAuthResolution {
  cleaner: ResolvedCleaner | null;
  routing: CleanerRouting;
  sessionUserId: string | null;
  sessionEmail: string | null;
}

export const BLOCKED_CLEANER_STATUSES = [
  "suspended",
  "terminated",
  "fired",
  "inactive",
  "deactivated",
] as const;

/** True when the cleaner's account should NOT have portal access. */
export function isBlockedCleanerStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (BLOCKED_CLEANER_STATUSES as readonly string[]).includes(
    status.toLowerCase(),
  );
}

/**
 * Single source of truth for cleaner auth + onboarding routing.
 *
 * Usage in a view:
 *
 *   const { cleaner, routing } = await resolveCleanerAuth();
 *   if (routing === "auth")        return router.replace("/cleaner/auth");
 *   if (routing === "onboarding")  return router.replace("/cleaner/onboarding");
 *   // routing === "dashboard" — cleaner is populated, render the page
 */
export async function resolveCleanerAuth(): Promise<CleanerAuthResolution> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return {
      cleaner: null,
      routing: "auth",
      sessionUserId: null,
      sessionEmail: null,
    };
  }

  const email = session.user.email || "";
  const { data, error } = await supabase.rpc(
    "resolve_or_link_cleaner_for_user",
    { p_email: email },
  );

  if (error) {
    console.error("[cleaner-auth] resolver RPC failed:", error);
    // Fall back to the legacy direct lookup so we don't lock cleaners
    // out if the RPC has a transient outage.
    const { data: fallback } = await supabase
      .from("cleaners")
      .select(
        "id, user_id, first_name, last_name, email, phone, home_zip, onboarding_complete, approved, status, stripe_account_id, payouts_enabled, phone_verified, pay_tier, pay_percentage",
      )
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (fallback) {
      return {
        cleaner: { ...fallback, was_linked: false, was_auto_promoted: false } as ResolvedCleaner,
        routing: fallback.onboarding_complete ? "dashboard" : "onboarding",
        sessionUserId: session.user.id,
        sessionEmail: email,
      };
    }
    return {
      cleaner: null,
      routing: "onboarding",
      sessionUserId: session.user.id,
      sessionEmail: email,
    };
  }

  const cleaner = (Array.isArray(data) ? data[0] : null) as
    | ResolvedCleaner
    | null;

  if (!cleaner) {
    return {
      cleaner: null,
      routing: "onboarding",
      sessionUserId: session.user.id,
      sessionEmail: email,
    };
  }

  return {
    cleaner,
    routing: cleaner.onboarding_complete ? "dashboard" : "onboarding",
    sessionUserId: session.user.id,
    sessionEmail: email,
  };
}
