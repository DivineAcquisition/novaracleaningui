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

import "server-only";

import { createSupabaseServerClient } from "@/integrations/supabase/server";

export interface DocsViewer {
  email: string;
  userId: string;
}

export type DocsAccess =
  | { allowed: true; viewer: DocsViewer }
  | { allowed: false; reason: "signed_out" | "wrong_domain" | "no_role" };

export async function getDocsAccess(): Promise<DocsAccess> {
  const supabase = createSupabaseServerClient();

  // getUser() revalidates the JWT with Supabase rather than trusting the
  // cookie's contents, which is what makes this safe to gate on.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { allowed: false, reason: "signed_out" };

  const email = String(user.email || "").trim().toLowerCase();
  if (!email.endsWith("@novaracleaning.com")) {
    return { allowed: false, reason: "wrong_domain" };
  }

  const { data: isAdminOrVa, error: roleError } = await (supabase.rpc as any)("is_admin_or_va", {
    _uid: user.id,
  });
  if (roleError || isAdminOrVa !== true) return { allowed: false, reason: "no_role" };

  return { allowed: true, viewer: { email, userId: user.id } };
}
