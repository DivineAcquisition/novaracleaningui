// ─── admin-va-provision ─────────────────────────────────────────────────────
//
// Admin-only: the approval gate + access provisioning + offboarding for VAs.
// Provisioning is the reward for completing onboarding — it only happens here,
// after BOTH gates: signed agreement AND explicit admin approval.
//
// Actions (body.action):
//   approve  { onboardingId }
//     Requires va_onboarding.status='submitted' + agreement_signed_at.
//     1. Creates the GHL **USER** (a staff seat with role-scoped permissions
//        cloned from a template user — NOT a contact). Template resolution:
//        app_secrets GHL_VA_TEMPLATE_<ROLE> (OPERATIONS/SALES/RECRUITING/ALL)
//        → falls back to GHL_USER_TEMPLATE_EMAIL. Least privilege by default.
//     2. Grants internal Admin Workspace access via admin-create-team-user
//        (role 'va', invite emailed) — same email = same identity everywhere.
//     3. Emails the VA their CRM login; flips status to 'approved'; logs an
//        events row (who approved, when, what was granted).
//   reject   { onboardingId, reason? }  — no access provisioned, VA notified.
//   offboard { onboardingId } or { email }
//     One action closes every door: deletes the GHL user, strips the
//     workspace roles, bans the auth login, stamps the row, and logs it.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { provisionGhlUserFromTemplate } from "../_shared/ghl-users.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
type DB = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function secret(admin: DB, key: string): Promise<string> {
  try {
    const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch { /* fall through */ }
  return (Deno.env.get(key) || "").trim();
}

function tempPassword(): string {
  return `Novara${Math.random().toString(36).slice(2, 8)}!${new Date().getFullYear()}`;
}

// Fire a VA lifecycle event at the Zapier Catch Hook (ZAPIER_VA_HOOK_URL).
// No-ops until configured; never throws.
async function sendVaZapier(admin: DB, event: string, row: Row, extra: Row = {}) {
  try {
    const hook = await secret(admin, "ZAPIER_VA_HOOK_URL");
    if (!hook.startsWith("https://hooks.zapier.com/")) return;
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event, // va.approved | va.rejected | va.offboarded
        email: row.email,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
        phone: row.phone || "",
        vaRole: row.va_role,
        timezone: row.timezone || "",
        workingHours: row.working_hours || "",
        agreementSignedAt: row.agreement_signed_at || null,
        onboardingId: row.id,
        timestamp: new Date().toISOString(),
        ...extra,
      }),
    });
  } catch (e) {
    console.warn("[admin-va-provision] zapier hook failed (non-blocking)", e instanceof Error ? e.message : String(e));
  }
}

// ── GHL user lookup + delete (offboarding) ──────────────────────────────────
async function ghlFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let body: Row | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, json: body, text };
}

async function findGhlUserIdByEmail(admin: DB, email: string): Promise<string | null> {
  const token = await secret(admin, "GHL_PIT_TOKEN");
  const locationId = await secret(admin, "GHL_LOCATION_ID");
  if (!token || !locationId) return null;
  let companyId = await secret(admin, "GHL_COMPANY_ID");
  if (!companyId) {
    const res = await ghlFetch(token, `/locations/${encodeURIComponent(locationId)}`, { method: "GET" });
    const loc = (res.json?.location as Row | undefined) ?? res.json ?? {};
    companyId = String(loc.companyId || loc.company_id || "");
  }
  if (!companyId) return null;
  const target = email.trim().toLowerCase();
  for (const path of [
    `/users/search?companyId=${encodeURIComponent(companyId)}&email=${encodeURIComponent(email)}`,
    `/users/search?companyId=${encodeURIComponent(companyId)}&query=${encodeURIComponent(email)}`,
  ]) {
    const res = await ghlFetch(token, path, { method: "GET" });
    if (!res.ok) continue;
    const users = (res.json?.users as Row[] | undefined) || [];
    const match = users.find((u) => String(u.email || "").trim().toLowerCase() === target);
    if (match?.id) return String(match.id);
  }
  return null;
}

async function deleteGhlUser(admin: DB, userId: string): Promise<boolean> {
  const token = await secret(admin, "GHL_PIT_TOKEN");
  if (!token) return false;
  const res = await ghlFetch(token, `/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  return res.ok;
}

// deno-lint-ignore no-explicit-any
async function findAuthUserByEmail(admin: any, email: string): Promise<{ id: string } | null> {
  const target = email.trim().toLowerCase();
  let page = 1;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u: Row) => String(u.email || "").toLowerCase() === target);
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
    page++;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    // ── Admin-only gate (provisioning + revocation are high privilege) ──
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
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    if (!(roles || []).some((r: { role: string }) => r.role === "admin")) {
      return json({ error: "Admins only." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    // Resolve the onboarding row by id or email.
    const onboardingId = body?.onboardingId ? String(body.onboardingId) : "";
    const emailKey = body?.email ? String(body.email).trim().toLowerCase() : "";
    let row: Row | null = null;
    if (onboardingId) {
      const { data } = await admin.from("va_onboarding").select("*").eq("id", onboardingId).maybeSingle();
      row = data;
    } else if (emailKey) {
      const { data } = await admin.from("va_onboarding").select("*").ilike("email", emailKey).maybeSingle();
      row = data;
    }
    if (!row) return json({ error: "Onboarding record not found" }, 404);

    const name = `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email;
    const resendKey = Deno.env.get("RESEND_API_KEY");

    // ── approve: BOTH gates enforced, then provision ────────────────────
    if (action === "approve") {
      if (!row.agreement_signed_at) return json({ error: "Agreement is not signed — cannot provision access." }, 403);
      if (row.status !== "submitted") return json({ error: `Onboarding is '${row.status}', not 'submitted'.` }, 409);

      // 1) GHL USER seat (role-scoped template; least privilege).
      const roleKey = String(row.va_role || "operations").toUpperCase();
      const templateEmail =
        (await secret(admin, `GHL_VA_TEMPLATE_${roleKey}`)) ||
        (await secret(admin, "GHL_USER_TEMPLATE_EMAIL")) ||
        undefined;
      const ghlPassword = tempPassword();
      const ghl = await provisionGhlUserFromTemplate(admin, {
        email: row.email,
        firstName: row.first_name || "VA",
        lastName: row.last_name || "",
        phone: row.phone || null,
        password: ghlPassword,
        templateEmail,
      });
      if (ghl.error) return json({ error: `GHL user creation failed: ${ghl.error}` }, 502);

      // 2) Internal Admin Workspace access ('va' role + invite email) via the
      //    existing team-user function — forwarding the caller's admin JWT.
      let portalUserId: string | null = null;
      let workspaceInviteSent = false;
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-create-team-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({
            action: "create",
            email: row.email,
            firstName: row.first_name || "",
            lastName: row.last_name || "",
            role: "va",
          }),
        });
        const j = await res.json();
        if (j?.userId) portalUserId = String(j.userId);
        workspaceInviteSent = !!j?.inviteSent;
      } catch (e) {
        console.warn("[admin-va-provision] workspace grant failed", e instanceof Error ? e.message : String(e));
      }

      // 3) Stamp the record.
      await admin.from("va_onboarding").update({
        status: "approved",
        approved_by: callerId,
        approved_at: new Date().toISOString(),
        ghl_user_id: ghl.ghlUserId,
        portal_user_id: portalUserId,
        provisioned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);

      // 4) Audit log (who approved, what was granted).
      await admin.from("events").insert({
        event_type: "va.provisioned",
        source: "admin-va-provision",
        summary: `✅ VA approved & provisioned — ${name} (${row.email}, ${row.va_role}). GHL user ${ghl.created ? "created" : "already existed"}; workspace access granted.`,
        data: { vaOnboardingId: row.id, email: row.email, vaRole: row.va_role, ghlUserId: ghl.ghlUserId, portalUserId, approvedBy: callerId },
      }).then(() => undefined, () => undefined);

      // 5) Send the VA their CRM login (workspace invite arrives separately),
      //    including the team Discord invite when configured.
      let vaEmailSent = false;
      try {
        if (resendKey) {
          const discordInvite = await secret(admin, "DISCORD_INVITE_URL");
          const resend = new Resend(resendKey);
          await resend.emails.send({
            from: "Novara Team <hello@novaracleaning.com>",
            to: [row.email],
            subject: "You're approved — your Novara access is ready 🎉",
            html: `
              <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e1b2e">
                <h2 style="color:#6d28d9">Welcome to the Novara team, ${row.first_name || ""}!</h2>
                <p>Your onboarding was approved and your access has been provisioned for the <strong>${row.va_role}</strong> role.</p>
                <div style="border:1px solid #e9e6f7;border-radius:10px;padding:14px 16px;margin:14px 0">
                  <p style="margin:0 0 6px"><strong>1. CRM (GoHighLevel)</strong></p>
                  <p style="margin:0;font-size:14px">Log in at <a href="https://app.gohighlevel.com">app.gohighlevel.com</a><br/>
                  Email: <strong>${row.email}</strong><br/>
                  Temporary password: <strong>${ghl.created ? ghlPassword : "use your existing password / reset via the login page"}</strong></p>
                  <p style="margin:6px 0 0;font-size:12px;color:#64748b">Change your password after first login.</p>
                </div>
                <div style="border:1px solid #e9e6f7;border-radius:10px;padding:14px 16px;margin:14px 0">
                  <p style="margin:0 0 6px"><strong>2. Admin Workspace</strong></p>
                  <p style="margin:0;font-size:14px">${workspaceInviteSent
                    ? "A separate invite email with your workspace access is on its way."
                    : `Access <a href="https://admin.novaracleaning.com">admin.novaracleaning.com</a> — if you don't receive an invite, ask your admin to resend it.`}</p>
                </div>
                ${discordInvite ? `
                <div style="border:1px solid #dfe2fb;border-radius:10px;padding:14px 16px;margin:14px 0;background:#f5f6ff">
                  <p style="margin:0 0 6px"><strong>3. Team Discord</strong></p>
                  <p style="margin:0;font-size:14px">Announcements, dispatch, and day-to-day comms happen here:<br/>
                  <a href="${discordInvite}" style="display:inline-block;margin-top:8px;background:#5865F2;color:#fff;padding:9px 18px;border-radius:8px;text-decoration:none;font-weight:600">Join the Novara Discord</a></p>
                </div>` : ""}
                <p style="font-size:13px;color:#3f3d56">Your access matches your role — if something you need is missing, ask your admin.</p>
                <p style="font-size:13px">— Novara Cleaning</p>
              </div>`,
          });
          vaEmailSent = true;
        }
      } catch (e) {
        console.warn("[admin-va-provision] VA email failed", e instanceof Error ? e.message : String(e));
      }

      // Zapier lifecycle event.
      await sendVaZapier(admin, "va.approved", row, { ghlUserId: ghl.ghlUserId, portalUserId });

      return json({
        ok: true,
        approved: true,
        ghlUserId: ghl.ghlUserId,
        ghlUserCreated: ghl.created,
        portalUserId,
        workspaceInviteSent,
        vaEmailSent,
      });
    }

    // ── reject ──────────────────────────────────────────────────────────
    if (action === "reject") {
      if (["approved", "offboarded"].includes(String(row.status))) {
        return json({ error: `Cannot reject an ${row.status} VA — use offboard.` }, 409);
      }
      const reason = String(body?.reason || "").trim();
      await admin.from("va_onboarding").update({
        status: "rejected",
        rejected_reason: reason || null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      await admin.from("events").insert({
        event_type: "va.onboarding_submitted",
        source: "admin-va-provision",
        summary: `❌ VA application rejected — ${name} (${row.email}).${reason ? ` Reason: ${reason}` : ""} No access was provisioned.`,
        data: { vaOnboardingId: row.id, email: row.email, rejectedBy: callerId, reason: reason || null },
      }).then(() => undefined, () => undefined);
      await sendVaZapier(admin, "va.rejected", row, { reason: reason || null });
      return json({ ok: true, rejected: true });
    }

    // ── offboard: one action closes every door, keyed to the email ─────
    if (action === "offboard") {
      const email = String(row.email).toLowerCase();
      const results: Row = { ghlDeleted: false, workspaceRevoked: false, authBanned: false };

      // GHL user seat.
      const ghlUserId = row.ghl_user_id || (await findGhlUserIdByEmail(admin, email));
      if (ghlUserId) results.ghlDeleted = await deleteGhlUser(admin, String(ghlUserId));

      // Workspace roles + login.
      const authUser = row.portal_user_id
        ? { id: String(row.portal_user_id) }
        : await findAuthUserByEmail(admin, email);
      if (authUser?.id) {
        const { error: roleErr } = await admin.from("user_roles").delete()
          .eq("user_id", authUser.id).in("role", ["va", "admin"]);
        results.workspaceRevoked = !roleErr;
        try {
          await admin.auth.admin.updateUserById(authUser.id, { ban_duration: "87600h" });
          results.authBanned = true;
        } catch { /* role removal already blocks the workspace */ }
      }

      await admin.from("va_onboarding").update({
        status: "offboarded",
        offboarded_at: new Date().toISOString(),
        offboarded_by: callerId,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);

      await admin.from("events").insert({
        event_type: "va.offboarded",
        source: "admin-va-provision",
        summary: `🔒 VA offboarded — ${name} (${email}). GHL user ${results.ghlDeleted ? "deleted" : "not found/failed"}, workspace roles ${results.workspaceRevoked ? "revoked" : "not found"}, login ${results.authBanned ? "banned" : "n/a"}.`,
        data: { vaOnboardingId: row.id, email, offboardedBy: callerId, ...results },
      }).then(() => undefined, () => undefined);

      await sendVaZapier(admin, "va.offboarded", row, results);

      return json({ ok: true, offboarded: true, ...results });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-va-provision]", msg);
    return json({ error: msg }, 500);
  }
});
