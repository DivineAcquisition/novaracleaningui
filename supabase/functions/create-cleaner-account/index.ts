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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // payTier accepts 'foundation' | 'proven' | 'elite' (defaults to
    // foundation/40%). payRateHr is accepted for back-compat but ignored
    // — the pay model is now flat revenue share, not hourly.
    const { email, firstName, lastName, phone, state, homeZip, serviceZipCodes, payTier } = await req.json();
    logStep("Creating cleaner account", { email, firstName, lastName, state, homeZip, payTier });

    const tier = ["foundation", "proven", "elite"].includes(String(payTier || "").toLowerCase())
      ? String(payTier).toLowerCase()
      : "foundation";
    const payPercentage = tier === "elite" ? 45 : tier === "proven" ? 40 : 35;

    // Generate password: firstInitial + fullLastName + nv2025!
    const password = `${firstName[0].toLowerCase()}${lastName}nv2025!`;
    logStep("Generated password", { passwordLength: password.length });

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Create auth user with auto-generated password
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email confirmation
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
      }
    });

    if (authError) {
      logStep("ERROR creating auth user", { error: authError.message });
      throw new Error(`Failed to create auth user: ${authError.message}`);
    }

    logStep("Auth user created", { userId: authData.user.id });

    // Create cleaner record with user_id, approved=true, and operational fields
    const { data: cleanerData, error: cleanerError } = await supabaseAdmin
      .from("cleaners")
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        state: state || null,
        home_zip: homeZip || null,
        service_zip_codes: serviceZipCodes || [],
        pay_tier: tier,
        pay_percentage: payPercentage,
        user_id: authData.user.id,
        status: "active",
        approved: true,
        invited_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (cleanerError) {
      logStep("ERROR creating cleaner record", { error: cleanerError.message });
      // Rollback: delete the auth user if cleaner creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw new Error(`Failed to create cleaner: ${cleanerError.message}`);
    }

    logStep("Cleaner record created successfully", { cleanerId: cleanerData.id });

    return new Response(
      JSON.stringify({ 
        success: true, 
        cleanerId: cleanerData.id,
        password: password // Return password so it can be emailed
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
