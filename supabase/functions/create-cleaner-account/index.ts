import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CLEANER-ACCOUNT] ${step}${detailsStr}`);
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// Find an existing auth user by email. supabase-js v2 has no
// getUserByEmail, so we paginate listUsers. The Novara user base is
// small enough that a few pages cover it; we cap at 20 pages (20k users).
async function findAuthUserByEmail(admin: any, email: string): Promise<any | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      logStep("listUsers error (non-fatal)", { error: error.message, page });
      return null;
    }
    const users = data?.users ?? [];
    const match = users.find((u: any) => (u.email || "").toLowerCase() === target);
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // payTier accepts 'foundation' | 'proven' | 'elite'. The pay model is
    // a flat revenue share (foundation 35 / proven 40 / elite 45).
    const body = await req.json().catch(() => ({}));
    const {
      email: rawEmail,
      firstName,
      lastName,
      phone,
      state,
      homeZip,
      serviceZipCodes,
      payTier,
    } = body || {};

    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email || !firstName || !lastName || !phone) {
      return json({ error: "firstName, lastName, email, and phone are required." }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ─── Authorize the caller (admin or va) ───────────────────────────
    // config.toml enforces verify_jwt=true at the gateway, but we also
    // verify the role here so only staff can mint cleaner accounts.
    try {
      const authHeader = req.headers.get("Authorization") || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "Not signed in." }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: `Bearer ${jwt}` } } },
      );
      const { data: u } = await userClient.auth.getUser();
      const callerId = u?.user?.id;
      if (!callerId) return json({ error: "Not signed in." }, 401);
      const { data: roles } = await supabaseAdmin
        .from("user_roles").select("role").eq("user_id", callerId);
      const allowed = (roles || []).some((r: any) => ["admin", "va"].includes(r.role));
      if (!allowed) return json({ error: "You don't have permission to add cleaners." }, 403);
    } catch (e) {
      return json({ error: "Authorization failed." }, 403);
    }

    const tier = ["foundation", "proven", "elite"].includes(String(payTier || "").toLowerCase())
      ? String(payTier).toLowerCase()
      : "foundation";
    const payPercentage = tier === "elite" ? 45 : tier === "proven" ? 40 : 35;

    // Generate password: firstInitial + fullLastName + nv2025!
    const password = `${String(firstName)[0].toLowerCase()}${String(lastName).replace(/\s+/g, "")}nv2025!`;
    logStep("Creating cleaner account", { email, firstName, lastName, state, homeZip, payTier: tier });

    // ─── Resolve or create the auth user ──────────────────────────────
    // Cleaners frequently already have an auth user (e.g. they completed
    // the email-verification step of self-onboarding, which creates an
    // auth user). In that case createUser would 500 with "already
    // registered" — so we look the user up and reuse it, resetting the
    // password so the admin can hand over fresh credentials.
    let userId: string;
    let reusedAuthUser = false;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });

    if (authError) {
      const msg = (authError.message || "").toLowerCase();
      const isDuplicate =
        msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (!isDuplicate) {
        logStep("ERROR creating auth user", { error: authError.message });
        return json({ error: `Failed to create login: ${authError.message}` }, 500);
      }
      const existing = await findAuthUserByEmail(supabaseAdmin, email);
      if (!existing) {
        return json({
          error: "An account with this email already exists but couldn't be located. Check the cleaner directory.",
        }, 409);
      }
      userId = existing.id;
      reusedAuthUser = true;
      // Reset their password so the admin can share working credentials.
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName },
      });
      logStep("Reusing existing auth user", { userId });
    } else {
      userId = authData.user.id;
      logStep("Auth user created", { userId });
    }

    // ─── Upsert the cleaner row ───────────────────────────────────────
    // A cleaner row may already exist (matched by email or user_id) from a
    // partial onboarding or a previous admin attempt. Update it instead of
    // inserting to avoid the UNIQUE(email) violation that produced the 500.
    const { data: existingCleaner } = await supabaseAdmin
      .from("cleaners")
      .select("id")
      .or(`email.eq.${email},user_id.eq.${userId}`)
      .maybeSingle();

    const cleanerFields = {
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      state: state || null,
      home_zip: homeZip || null,
      service_zip_codes: serviceZipCodes || [],
      pay_tier: tier,
      pay_percentage: payPercentage,
      user_id: userId,
      status: "active",
      approved: true,
      available_for_bookings: true,
      onboarding_complete: true,
      activated_at: new Date().toISOString(),
      invited_at: new Date().toISOString(),
    };

    let cleanerData: any;
    if (existingCleaner?.id) {
      const { data, error: updErr } = await supabaseAdmin
        .from("cleaners")
        .update(cleanerFields)
        .eq("id", existingCleaner.id)
        .select()
        .single();
      if (updErr) {
        logStep("ERROR updating cleaner record", { error: updErr.message });
        return json({ error: `Failed to update cleaner: ${updErr.message}` }, 500);
      }
      cleanerData = data;
      logStep("Cleaner record updated", { cleanerId: cleanerData.id });
    } else {
      const { data, error: insErr } = await supabaseAdmin
        .from("cleaners")
        .insert(cleanerFields)
        .select()
        .single();
      if (insErr) {
        logStep("ERROR creating cleaner record", { error: insErr.message });
        // Roll back the auth user only if WE created it in this request.
        if (!reusedAuthUser) {
          await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
        }
        return json({ error: `Failed to create cleaner: ${insErr.message}` }, 500);
      }
      cleanerData = data;
      logStep("Cleaner record created", { cleanerId: cleanerData.id });
    }


    // GHL contact + contractor pipeline + location user (non-blocking).
    try {
      await supabaseAdmin.functions.invoke("sync-cleaner-to-ghl", {
        body: { cleanerId: cleanerData.id },
      });
      logStep("GHL sync invoked");
    } catch (ghlErr) {
      logStep("GHL sync invoke failed (non-critical)", {
        error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr),
      });
    }

    return json({
      success: true,
      cleanerId: cleanerData.id,
      password,
      reusedExistingLogin: reusedAuthUser,
    }, 200);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    return json({ error: errorMessage }, 500);
  }
});
