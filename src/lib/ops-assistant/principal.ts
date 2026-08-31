// ─── Who may talk to the Ops Assistant ────────────────────────────────────
//
// Same gate as the workspace and the docs site: a signed-in
// @novaracleaning.com account holding admin or va. The workspace sends a
// Bearer token (localStorage session). The docs site sends a cookie. Both
// doors must resolve to the same user id so conversation history is shared.

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { AdminAuthError } from "@/lib/admin-auth";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/public-env";
import type { AssistantRole } from "./types";

export interface OpsPrincipal {
  userId: string;
  email: string;
  role: AssistantRole;
  isAdmin: boolean;
}

function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

async function rolesFor(userId: string): Promise<string[]> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Without the service role we cannot read user_roles (RLS). Cookie/JWT
    // identity still proves they signed in; treat as VA — the conservative
    // permission set — rather than failing closed on a missing key in preview.
    return ["va"];
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new AdminAuthError("Could not verify permissions.", 500);
  return (data || []).map((r: { role: string }) => r.role);
}

function toPrincipal(userId: string, email: string, roles: string[]): OpsPrincipal {
  const allowed = roles.includes("admin") || roles.includes("va");
  if (!allowed) throw new AdminAuthError("Admins only.", 403);
  const isAdmin = roles.includes("admin");
  return {
    userId,
    email: email || "unknown",
    role: isAdmin ? "admin" : "va",
    isAdmin,
  };
}

async function fromJwt(token: string): Promise<OpsPrincipal> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
  const userClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id) throw new AdminAuthError("Invalid or expired session.", 401);
  const email = String(user.email || "").trim().toLowerCase();
  if (!email.endsWith("@novaracleaning.com")) throw new AdminAuthError("Wrong domain.", 403);
  const roles = await rolesFor(user.id);
  return toPrincipal(user.id, email, roles);
}

async function fromCookies(): Promise<OpsPrincipal> {
  const cookieStore = cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Route handlers that only read the session must not try to refresh
        // cookies — some render paths cannot set them.
      },
    },
  });
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user?.id) throw new AdminAuthError("Not signed in.", 401);
  const email = String(user.email || "").trim().toLowerCase();
  if (!email.endsWith("@novaracleaning.com")) throw new AdminAuthError("Wrong domain.", 403);
  const roles = await rolesFor(user.id);
  return toPrincipal(user.id, email, roles);
}

/**
 * Workspace (Bearer) or docs (cookie). Same user id either way.
 */
export async function requireOpsAssistant(req: Request): Promise<OpsPrincipal> {
  const token = bearerToken(req);
  if (token) return fromJwt(token);
  return fromCookies();
}
