// admin-create-team-user
//
// Admin-only management of internal portal users (admins + VAs).
// VAs operate the admin console; admins manage the team. This function
// is the ONLY way to grant/revoke portal roles, because user_roles has
// no VA-writable RLS policy (prevents self-escalation).
//
// Actions (body.action):
//   • "list"         → { users: [{ userId, email, roles: [...] }] }
//   • "create"       → { email, firstName?, lastName?, role: 'va'|'admin' }
//                      creates (or reuses) an auth user, assigns the role,
//                      and emails a Resend invite to accept workspace access.
//   • "resend_invite"→ { userId } or { email } — resend workspace invite
//   • "set_role"     → { userId, role }      (add a role)
//   • "remove_role"  → { userId, role }      (revoke a role)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { sendThroughCompliance } from "../_shared/email-compliance-send.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { deleteUnusedStaffCustomerAccount } from "../_shared/staff-customer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PORTAL_ROLES = new Set(["admin", "va"]);
const ADMIN_PORTAL_URL = "https://admin.novaracleaning.com";
const ADMIN_CALLBACK = `${ADMIN_PORTAL_URL}/admin/auth/callback`;
const NOVARA_EMAIL_RE = /^[^@\s]+@novaracleaning\.com$/i;

function isNovaraEmail(email: string): boolean {
  return NOVARA_EMAIL_RE.test(String(email || "").trim());
}

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

function roleLabel(role: string): string {
  return role === "admin" ? "Admin" : "VA (Virtual Assistant)";
}

function renderInviteHtml(opts: {
  firstName: string;
  role: string;
  link: string;
  isExistingAccount: boolean;
}): { subject: string; html: string; text: string } {
  const greeting = opts.firstName ? `Hi ${opts.firstName},` : "Hi there,";
  const roleName = roleLabel(opts.role);
  const subject = `You're invited to the Novara admin workspace`;
  const bodyHtml = opts.isExistingAccount
    ? `<p>${greeting}</p><p>You've been granted <strong>${roleName}</strong> access to the Novara admin workspace. Click below to sign in and start working in the console.</p>`
    : `<p>${greeting}</p><p>You've been invited to join the Novara team as a <strong>${roleName}</strong>. Click below to accept your invitation, set your password, and open the admin workspace.</p>`;
  const ctaLabel = opts.isExistingAccount ? "Open admin workspace" : "Accept invitation";
  const expiryNote = opts.isExistingAccount
    ? "This sign-in link expires in 1 hour and can only be used once."
    : "This invitation expires in 24 hours.";

  const html = `<h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">Workspace invitation</h1>
${bodyHtml}
<p>Console: <a href="${ADMIN_PORTAL_URL}">${ADMIN_PORTAL_URL}</a></p>
<p style="margin:22px 0 0;"><a class="novara-btn" href="${opts.link}" style="display:inline-block;padding:14px 28px;background:#e7e7ea;color:#18181b;text-decoration:none;border-radius:12px;font-weight:600;">${ctaLabel}</a></p>
<p style="margin:16px 0 0;font-size:14px;">${expiryNote}</p>`;

  const text = `${greeting}\n\nYou've been invited to the Novara admin workspace as ${roleName}.\n\nAccept your invitation:\n${opts.link}\n\n${expiryNote}\n\nConsole: ${ADMIN_PORTAL_URL}`;
  return { subject, html, text };
}

async function generateWorkspaceInviteLink(
  admin: any,
  email: string,
  isExistingAccount: boolean,
): Promise<{ link: string } | { error: string }> {
  const type = isExistingAccount ? "magiclink" : "invite";
  const { data, error } = await admin.auth.admin.generateLink({
    type,
    email: email.trim().toLowerCase(),
    options: { redirectTo: ADMIN_CALLBACK },
  });
  if (error) return { error: error.message };
  const link = data?.properties?.action_link as string | undefined;
  if (!link) return { error: "no action_link in generateLink response" };
  return { link };
}

async function sendWorkspaceInviteEmail(
  admin: any,
  opts: {
    email: string;
    firstName: string;
    role: string;
    isExistingAccount: boolean;
  },
): Promise<{ sent: boolean; emailId?: string; error?: string }> {
  const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
  if (!resendKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  const linkResult = await generateWorkspaceInviteLink(
    admin,
    opts.email,
    opts.isExistingAccount,
  );
  if ("error" in linkResult) {
    return { sent: false, error: linkResult.error };
  }

  const { subject, html, text } = renderInviteHtml({
    firstName: opts.firstName,
    role: opts.role,
    link: linkResult.link,
    isExistingAccount: opts.isExistingAccount,
  });

  try {
    const result = await sendThroughCompliance(resendKey, {
      to: opts.email,
      subject,
      html,
      text,
      templateKey: "va_onboarding",
      declaredType: "internal_admin",
      staffRecipient: true,
    }, admin);
    if ((result as any)?.error) {
      return { sent: false, error: String((result as any).error?.message || (result as any).error) };
    }
    return { sent: true, emailId: (result as any)?.data?.id };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
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
        if (!isNovaraEmail(email)) {
          return json({
            error: "Admin workspace access is limited to @novaracleaning.com emails.",
          }, 400);
        }

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

        await deleteUnusedStaffCustomerAccount(admin, email);

        const invite = await sendWorkspaceInviteEmail(admin, {
          email,
          firstName,
          role,
          isExistingAccount: reused,
        });

        if (!invite.sent) {
          console.error("[admin-create-team-user] invite email failed", invite.error);
          return json({
            success: true,
            userId,
            email,
            role,
            reusedExistingLogin: reused,
            inviteSent: false,
            inviteError: invite.error || "Failed to send invite email",
            // Fallback so admin can still onboard manually if Resend fails
            password,
          });
        }

        return json({
          success: true,
          userId,
          email,
          role,
          reusedExistingLogin: reused,
          inviteSent: true,
          emailId: invite.emailId,
        });
      }

      case "resend_invite": {
        const userId = String(body?.userId || "").trim();
        let email = String(body?.email || "").trim().toLowerCase();
        let firstName = body?.firstName ? String(body.firstName) : "";
        let role = String(body?.role || "va").trim().toLowerCase();
        let reused = true;

        if (userId) {
          const { data } = await admin.auth.admin.getUserById(userId);
          if (!data?.user?.email) return json({ error: "user not found" }, 404);
          email = data.user.email.toLowerCase();
          firstName = (data.user.user_metadata?.first_name as string) || firstName;
          const { data: roleRows } = await admin
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .in("role", ["admin", "va"]);
          const portalRole = (roleRows || []).find((r: any) => r.role === "admin" || r.role === "va");
          if (portalRole) role = portalRole.role;
        }

        if (!email) return json({ error: "userId or email required" }, 400);
        if (!PORTAL_ROLES.has(role)) return json({ error: "role must be 'va' or 'admin'" }, 400);

        const existing = await findAuthUserByEmail(admin, email);
        if (!existing) return json({ error: "No auth user for that email" }, 404);
        reused = true;

        const invite = await sendWorkspaceInviteEmail(admin, {
          email,
          firstName,
          role,
          isExistingAccount: reused,
        });
        if (!invite.sent) {
          return json({ error: invite.error || "Failed to send invite email" }, 500);
        }
        return json({ success: true, email, inviteSent: true, emailId: invite.emailId });
      }

      case "set_role": {
        const userId = String(body?.userId || "").trim();
        const role = String(body?.role || "").trim().toLowerCase();
        if (!userId) return json({ error: "userId required" }, 400);
        if (!PORTAL_ROLES.has(role)) return json({ error: "role must be 'va' or 'admin'" }, 400);
        const { data: targetUser } = await admin.auth.admin.getUserById(userId);
        const targetEmail = String(targetUser?.user?.email || "").trim().toLowerCase();
        if (!isNovaraEmail(targetEmail)) {
          return json({
            error: "Admin workspace access is limited to @novaracleaning.com emails.",
          }, 400);
        }
        const { error } = await admin
          .from("user_roles")
          .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
        if (error) throw error;
        await deleteUnusedStaffCustomerAccount(admin, targetEmail);
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
