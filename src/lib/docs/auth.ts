// ─── Who may read the admin workspace documentation ────────────────────────
//
// These guides contain internal pricing formulas, the floor that protects
// cleaner pay, override bands, and the exact conditions behind every hard
// stop in the workspace. That is not public information, and it is not
// customer- or contractor-facing either.
//
// So the gate is the SAME one the admin workspace itself uses — a signed-in
// @novaracleaning.com account holding the `admin` or `va` role — and it is
// enforced on the SERVER, before any guide text or screenshot is rendered.
// The workspace's client-side ProtectedRoute is not sufficient here: it
// redirects after the page has already been sent, which for a document means
// the content reached the browser regardless.
//
// The session has to be a COOKIE on docs.novaracleaning.com. The admin
// portal stores its session in localStorage on admin.novaracleaning.com;
// neither that host nor that storage is visible here. Sign-in for this
// gate lives at /docs (and /docs/auth), with the Google callback at
// /docs/auth/callback.

import "server-only";

import { createSupabaseServerClient } from "@/integrations/supabase/server";

export interface DocsViewer {
  email: string;
  userId: string;
}

export type DocsDenialReason = "signed_out" | "wrong_domain" | "no_role";

/**
 * Deliberately a flat shape rather than a discriminated union: this project
 * compiles with `strictNullChecks` disabled, where narrowing on
 * `if (!access.allowed)` does not work, and a type that only looks safe is
 * worse than one that reads plainly.
 */
export interface DocsAccess {
  allowed: boolean;
  viewer: DocsViewer | null;
  reason: DocsDenialReason | null;
}

const deny = (reason: DocsDenialReason): DocsAccess => ({ allowed: false, viewer: null, reason });

export async function getDocsAccess(): Promise<DocsAccess> {
  const supabase = createSupabaseServerClient();

  // getUser() revalidates the JWT with Supabase rather than trusting the
  // cookie's contents, which is what makes this safe to gate on.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return deny("signed_out");

  const email = String(user.email || "").trim().toLowerCase();
  if (!email.endsWith("@novaracleaning.com")) return deny("wrong_domain");

  const { data: isAdminOrVa, error: roleError } = await (supabase.rpc as any)("is_admin_or_va", {
    _uid: user.id,
  });
  if (roleError || isAdminOrVa !== true) return deny("no_role");

  return { allowed: true, viewer: { email, userId: user.id }, reason: null };
}
