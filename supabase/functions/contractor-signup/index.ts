// ─── contractor-signup ──────────────────────────────────────────────────────
//
// Public, anon-callable cleaner signup that creates the auth user
// ALREADY email-confirmed (email_confirm: true) so the contractor can sign
// in immediately — no confirmation email required. This removes the
// dependency on email deliverability for the contractor onboarding flow.
//
// The frontend calls this, then signs in with the same password.
//
// Body: { email, password, firstName?, lastName? }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const password = body?.password ? String(body.password) : "";
    const firstName = body?.firstName ? String(body.firstName).trim() : undefined;
    const lastName = body?.lastName ? String(body.lastName).trim() : undefined;

    if (!email.includes("@")) return json({ error: "A valid email is required." }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        is_cleaner: true,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
      },
    });

    if (error) {
      // Existing account — fine. The client will just sign in with the
      // password they entered. Don't reveal whether the email existed.
      if (/regist|already|exist|duplicate/i.test(error.message)) {
        return json({ ok: true, existing: true });
      }
      console.error("[contractor-signup] createUser failed", error.message);
      return json({ error: error.message }, 400);
    }

    // Make sure any pre-existing cleaner row (created during application)
    // is linked to this fresh auth user so onboarding resumes cleanly.
    try {
      const userId = data.user?.id;
      if (userId) {
        await admin
          .from("cleaners")
          .update({ user_id: userId })
          .eq("email", email)
          .is("user_id", null);
      }
    } catch (linkErr) {
      console.warn("[contractor-signup] cleaner link skipped", linkErr);
    }

    return json({ ok: true, userId: data.user?.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
