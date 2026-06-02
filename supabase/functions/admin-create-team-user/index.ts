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
import { Resend } from "https://esm.sh/resend@4.0.0";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PORTAL_ROLES = new Set(["admin", "va"]);
const ADMIN_PORTAL_URL = "https://admin.novaracleaning.com";
const ADMIN_CALLBACK = `${ADMIN_PORTAL_URL}/admin/auth/callback`;
const FROM_ADDRESS = "Novara Cleaning <hello@novaracleaning.com>";

const BRAND = {
  name: "Novara Cleaning",
  primary: "#16A34A",
  primaryDark: "#0E7C3A",
  gradient: "linear-gradient(135deg, #16A34A 0%, #0E7C3A 100%)",
  gray50: "#F9FAFB",
  gray200: "#E5E7EB",
  gray600: "#6B7280",
  gray700: "#374151",
  gray900: "#111827",
  logo: "https://app.novaracleaning.com/novara-logo.png",
  supportEmail: "support@novaracleaning.com",
};

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
  const preheader = `Accept your invitation to join the Novara ${roleName} console.`;
  const bodyHtml = opts.isExistingAccount
    ? `<p>${greeting}</p><p>You've been granted <strong>${roleName}</strong> access to the Novara admin workspace. Click below to sign in and start working in the console.</p>`
    : `<p>${greeting}</p><p>You've been invited to join the Novara team as a <strong>${roleName}</strong>. Click below to accept your invitation, set your password, and open the admin workspace.</p>`;
  const ctaLabel = opts.isExistingAccount ? "Open admin workspace" : "Accept invitation";
  const expiryNote = opts.isExistingAccount
    ? "This sign-in link expires in 1 hour and can only be used once."
    : "This invitation expires in 24 hours.";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${subject}</title><meta name="x-preheader" content="${preheader}"></head><body style="margin:0;padding:0;background:${BRAND.gray50};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray900};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.gray50};padding:20px 0;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;padding:20px;text-align:center;">
<img src="${BRAND.logo}" alt="${BRAND.name}" width="140" height="48" style="display:block;margin:0 auto 8px;" />
<div style="font-size:14px;font-weight:700;letter-spacing:.04em;color:${BRAND.primary};text-transform:uppercase;">Admin workspace</div>
</td></tr>
<tr><td style="background:${BRAND.gradient};color:#ffffff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">
<h1 style="margin:0;font-size:26px;font-weight:bold;color:#ffffff;">Workspace invitation</h1>
</td></tr>
<tr><td style="background:#ffffff;padding:30px;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};font-size:16px;line-height:1.6;color:${BRAND.gray700};">
${bodyHtml}
<p style="font-size:14px;color:${BRAND.gray600};">Console URL: <a href="${ADMIN_PORTAL_URL}" style="color:${BRAND.primary};">${ADMIN_PORTAL_URL}</a></p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td align="center" style="background:${BRAND.gradient};border-radius:8px;"><a href="${opts.link}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${ctaLabel}</a></td></tr></table>
<p style="font-size:13px;color:${BRAND.gray600};margin:16px 0 8px;text-align:center;">${expiryNote}</p>
<p style="font-size:12px;color:${BRAND.gray600};word-break:break-all;margin:8px 0 0;text-align:center;"><a href="${opts.link}" style="color:${BRAND.primary};">${opts.link}</a></p>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;padding:20px;text-align:center;font-size:13px;color:${BRAND.gray600};">
<div style="margin:8px 0;">Questions? Email <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a></div>
<div style="margin:8px 0;">&copy; ${new Date().getFullYear()} ${BRAND.name}</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

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
    const resend = new Resend(resendKey);
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [opts.email],
      subject,
      html,
      text,
      replyTo: BRAND.supportEmail,
    });
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
