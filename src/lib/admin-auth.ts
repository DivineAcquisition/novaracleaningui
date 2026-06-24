// ─── Server-side admin gate for Next.js API routes ───────────────────────────
//
// The STR partner-admin console is ADMIN-ONLY and must be enforced SERVER-SIDE
// (spec §8 — never exposed to hosts; the client ProtectedRoute is not enough).
//
// Every protected route calls requireAdmin(req): it reads the caller's Supabase
// access token from the Authorization header, validates it by passing the token
// EXPLICITLY to getUser(token) (never trusting an unverified client), then checks
// the user holds an `admin` or `va` role via the service-role client (which
// bypasses RLS to read user_roles). VAs operate the same back-office console, so
// they're allowed — matching the va_admin_portal_access policy used elsewhere.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class AdminAuthError extends Error {
  constructor(
    message: string,
    readonly status: number = 401,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export interface AdminPrincipal {
  userId: string;
  email: string;
}

let serviceClient: SupabaseClient | null = null;
function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AdminAuthError("Server auth is not configured (missing service role key).", 500);
  }
  serviceClient = createClient(url, key, { auth: { persistSession: false } });
  return serviceClient;
}

function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

/**
 * Validate the request is from a signed-in admin or VA. Throws AdminAuthError
 * (with an HTTP status) otherwise. Returns the verified principal.
 */
export async function requireAdmin(req: Request): Promise<AdminPrincipal> {
  const token = bearerToken(req);
  if (!token) throw new AdminAuthError("Not signed in.", 401);

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new AdminAuthError("Server auth is not configured.", 500);

  // Validate the JWT by passing the token explicitly — do NOT rely on ambient
  // session state on the server.
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user?.id) throw new AdminAuthError("Invalid or expired session.", 401);

  const admin = getServiceClient();
  const { data: roles, error: rolesErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (rolesErr) throw new AdminAuthError("Could not verify permissions.", 500);

  const allowed = (roles || []).some((r: { role: string }) => r.role === "admin" || r.role === "va");
  if (!allowed) throw new AdminAuthError("Admins only.", 403);

  return { userId: user.id, email: user.email || "admin" };
}

/**
 * Validate the request is from ANY signed-in user (no role requirement).
 * Used by self-service flows (e.g. a contractor signing their own agreement).
 */
export async function requireUser(req: Request): Promise<AdminPrincipal> {
  const token = bearerToken(req);
  if (!token) throw new AdminAuthError("Not signed in.", 401);
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new AdminAuthError("Server auth is not configured.", 500);
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user?.id) throw new AdminAuthError("Invalid or expired session.", 401);
  return { userId: user.id, email: user.email || "" };
}
