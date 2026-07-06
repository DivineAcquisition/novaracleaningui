// admin-impersonate-cleaner
//
// Admin-only: mint a single-use magic link that signs the admin into a
// cleaner's contractor-portal account so they can view AND act as that
// cleaner (full session - every action runs under the cleaner's RLS). The
// link is returned to the admin UI (NOT emailed to the cleaner). Audited.
//
// Security: gated to role === 'admin' (stricter than the admin/va default,
// since impersonation is higher-privilege). Magic links are single-use and
// short-lived (Supabase default ~1h). Every use writes an audit event.
//
// Body: { cleanerId: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CONTRACTOR_BASE = "https://contractor.novaracleaning.com";
const REDIRECT = `${CONTRACTOR_BASE}/cleaner/dashboard`;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

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
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const isAdmin = (roles || []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) return json({ error: "Admins only." }, 403);

    const body = await req.json();
    const cleanerId = String(body.cleanerId || "");
    if (!cleanerId) return json({ error: "cleanerId required" }, 400);

    const { data: cleaner } = await admin.from("cleaners").select("id, user_id, email, first_name, last_name").eq("id", cleanerId).maybeSingle();
    if (!cleaner?.email) return json({ error: "Cleaner not found or has no email" }, 404);
    const email = String(cleaner.email).toLowerCase();

    // deno-lint-ignore no-explicit-any
    const mintLink = () => admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: REDIRECT },
    }) as Promise<{ data: any; error: any }>;

    let { data: linkData, error: linkErr } = await mintLink();

    // Cleaners invited by admin (or migrated in) may have no auth user yet
    // — magic links can't be minted for a non-existent user. Create the
    // account (pre-confirmed, no email sent) and retry once.
    if (linkErr && /not.*found|does not exist/i.test(String(linkErr.message || ""))) {
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { created_via: "admin_impersonation" },
      });
      if (createErr && !/already/i.test(String(createErr.message || ""))) {
        return json({ error: `Cleaner has no login yet and one could not be created: ${createErr.message}` }, 500);
      }
      ({ data: linkData, error: linkErr } = await mintLink());
    }
    if (linkErr) return json({ error: `Could not create session link: ${linkErr.message}` }, 500);

    // Prefer a token_hash deep link straight into the contractor portal's
    // own auth callback (verified client-side via verifyOtp). The hosted
    // action_link depends on the Supabase redirect allow-list — when the
    // contractor URL isn't allow-listed, it bounces the admin to the
    // default site URL and the sign-in silently "does nothing". The
    // token_hash route has no such dependency.
    const hashedToken = linkData?.properties?.hashed_token as string | undefined;
    const actionLink = linkData?.properties?.action_link as string | undefined;
    const url = hashedToken
      ? `${CONTRACTOR_BASE}/cleaner/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&impersonated=1`
      : actionLink;
    if (!url) return json({ error: "No session link returned" }, 500);

    await admin.from("events").insert({
      event_type: "admin.impersonate_cleaner",
      cleaner_id: cleanerId,
      source: "admin",
      summary: `Admin signed in as cleaner ${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
      data: { by: callerId, cleaner_email: cleaner.email },
    }).then(() => undefined, () => undefined);

    return json({ ok: true, url, cleanerName: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-impersonate-cleaner]", msg);
    return json({ error: msg }, 500);
  }
});
