// admin-create-team-user
//
// Admin-only management of internal portal users (admins + VAs).
// VAs operate the admin console; admins manage the team. This function
// is the ONLY way to grant/revoke portal roles, because user_roles has
// no VA-writable RLS policy (prevents self-escalation).
//
// Actions (body.action):
//   • "list"      → { users: [{ userId, email, roles: [...] }] }
//   • "create"    → { email, firstName?, lastName?, role: 'va'|'admin' }
//                   creates (or reuses) an auth user, sets a temp
//                   password, assigns the role. Returns { password }.
//   • "set_role"  → { userId, role }      (add a role)
//   • "remove_role" → { userId, role }    (revoke a role)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PORTAL_ROLES = new Set(["admin", "va"]);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

async function findAuthUserByEmail(admin: any, email: string): Promise<any | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const users = data?.users ?? [];
    const match = users.find((u: any) => (u.email || "").toLowerCase() === target);
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ─── Require ADMIN (not va) — only admins manage the team ───────────
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: u } = await userClient.auth.getUser();
    const callerId = u?.user?.id;
    if (!callerId) return json({ error: "Not signed in." }, 401);
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", callerId);
    const isAdmin = (roles || []).some((r: any) => r.role === "admin");
    if (!isAdmin) return json({ error: "Admins only." }, 403);
  } catch {
    return json({ error: "Authorization failed." }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const action = String(body?.action || "").trim();

  try {
    switch (action) {
      case "list": {
        const { data: roleRows, error } = await admin
          .from("user_roles")
          .select("user_id, role, created_at")
          .in("role", ["admin", "va"]);
        if (error) throw error;
        const byUser: Record<string, { userId: string; roles: string[]; created_at: string }> = {};
        for (const r of roleRows || []) {
          const id = r.user_id as string;
          if (!byUser[id]) byUser[id] = { userId: id, roles: [], created_at: r.created_at };
          byUser[id].roles.push(r.role);
        }
        const users = await Promise.all(
          Object.values(byUser).map(async (entry) => {
            const { data } = await admin.auth.admin.getUserById(entry.userId);
            return {
              userId: entry.userId,
              email: data?.user?.email || null,
              roles: entry.roles,
              created_at: entry.created_at,
            };
          }),
        );
        users.sort((a, b) => (a.email || "").localeCompare(b.email || ""));
        return json({ users });
      }

      case "create": {
        const email = String(body?.email || "").trim().toLowerCase();
        const role = String(body?.role || "va").trim().toLowerCase();
        const firstName = body?.firstName ? String(body.firstName) : "";
        const lastName = body?.lastName ? String(body.lastName) : "";
        if (!email) return json({ error: "email required" }, 400);
        if (!PORTAL_ROLES.has(role)) return json({ error: "role must be 'va' or 'admin'" }, 400);

        const password = `Novara${Math.random().toString(36).slice(2, 8)}!${new Date().getFullYear()}`;

        let userId: string;
        let reused = false;
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { first_name: firstName, last_name: lastName },
        });
        if (createErr) {
          const msg = (createErr.message || "").toLowerCase();
          if (!(msg.includes("already") || msg.includes("registered") || msg.includes("exists"))) {
            throw createErr;
          }
          const existing = await findAuthUserByEmail(admin, email);
          if (!existing) return json({ error: "User exists but could not be located." }, 409);
          userId = existing.id;
          reused = true;
          await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
        } else {
          userId = created.user.id;
        }

        const { error: roleErr } = await admin
          .from("user_roles")
          .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
        if (roleErr) throw roleErr;

        return json({ success: true, userId, email, role, password, reusedExistingLogin: reused });
      }

      case "set_role": {
        const userId = String(body?.userId || "").trim();
        const role = String(body?.role || "").trim().toLowerCase();
        if (!userId) return json({ error: "userId required" }, 400);
        if (!PORTAL_ROLES.has(role)) return json({ error: "role must be 'va' or 'admin'" }, 400);
        const { error } = await admin
          .from("user_roles")
          .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
        if (error) throw error;
        return json({ success: true, userId, role });
      }

      case "remove_role": {
        const userId = String(body?.userId || "").trim();
        const role = String(body?.role || "").trim().toLowerCase();
        if (!userId) return json({ error: "userId required" }, 400);
        if (!PORTAL_ROLES.has(role)) return json({ error: "role must be 'va' or 'admin'" }, 400);
        const { error } = await admin
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", role);
        if (error) throw error;
        return json({ success: true, userId, role });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[admin-create-team-user]", message);
    return json({ error: message }, 500);
  }
});
