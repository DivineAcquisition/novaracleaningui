import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ENROLL-CLEANER] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate via x-webhook-secret header
    const webhookSecret = req.headers.get("x-webhook-secret");
    const expectedSecret = Deno.env.get("CLEANER_ENROLLMENT_WEBHOOK_SECRET");

    if (!expectedSecret || webhookSecret !== expectedSecret) {
      logStep("AUTH FAILED", { provided: !!webhookSecret });
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const body = await req.json();
    const {
      email,
      first_name,
      last_name,
      phone,
      state,
      home_zip,
      service_zip_codes,
      max_travel_miles = 20,
      preferred_work_days,
      skillset,
      pay_tier,
    } = body;

    const tierNorm = ["foundation", "proven", "elite"].includes(String(pay_tier || "").toLowerCase())
      ? String(pay_tier).toLowerCase()
      : "foundation";
    const payPercentage = tierNorm === "elite" ? 45 : tierNorm === "proven" ? 40 : 35;

    // Validate required fields
    if (!email || !first_name || !last_name || !phone) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, first_name, last_name, phone" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    logStep("Enrolling cleaner", { email, first_name, last_name });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Check for duplicate by email
    const { data: existingCleaner } = await supabaseAdmin
      .from("cleaners")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingCleaner) {
      logStep("Duplicate detected, returning existing", { cleanerId: existingCleaner.id });
      return new Response(
        JSON.stringify({ success: true, cleanerId: existingCleaner.id, duplicate: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Create auth user
    const password = `${first_name[0].toLowerCase()}${last_name}nv2025!`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name, last_name },
    });

    if (authError) {
      logStep("ERROR creating auth user", { error: authError.message });
      throw new Error(`Auth user creation failed: ${authError.message}`);
    }

    logStep("Auth user created", { userId: authData.user.id });

    // Geocode home_zip if provided
    let homeLat: number | null = null;
    let homeLng: number | null = null;

    if (home_zip) {
      try {
        const geocodeResponse = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/geocode-address`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({ zip: home_zip }),
          }
        );
        const geocodeData = await geocodeResponse.json();
        if (geocodeData.lat && geocodeData.lng) {
          homeLat = geocodeData.lat;
          homeLng = geocodeData.lng;
          logStep("Geocoded successfully", { lat: homeLat, lng: homeLng });
        }
      } catch (geoErr) {
        logStep("Geocoding failed (non-critical)", { error: geoErr });
      }
    }

    // Create cleaner record
    const { data: cleanerData, error: cleanerError } = await supabaseAdmin
      .from("cleaners")
      .insert({
        email,
        first_name,
        last_name,
        phone,
        state: state || null,
        home_zip: home_zip || null,
        home_lat: homeLat,
        home_lng: homeLng,
        service_zip_codes: service_zip_codes || (home_zip ? [home_zip] : []),
        max_travel_miles,
        preferred_work_days: preferred_work_days || [],
        skillset: skillset || ["Standard Cleaning"],
        pay_tier: tierNorm,
        pay_percentage: payPercentage,
        user_id: authData.user.id,
        status: "active",
        approved: true,
        onboarding_complete: true,
        activated_at: new Date().toISOString(),
        invited_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (cleanerError) {
      logStep("ERROR creating cleaner record", { error: cleanerError.message });
      // Rollback auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw new Error(`Cleaner record creation failed: ${cleanerError.message}`);
    }

    logStep("Cleaner enrolled successfully", { cleanerId: cleanerData.id });
    try {
      await supabaseAdmin.functions.invoke("sync-cleaner-to-ghl", {
        body: { cleanerId: cleanerData.id },
      });
      logStep("GHL sync invoked");
    } catch (ghlErr) {
      logStep("GHL sync failed (non-critical)", ghlErr);
    }


    return new Response(
      JSON.stringify({
        success: true,
        cleanerId: cleanerData.id,
        credentials: { email, password },
        geocoded: homeLat !== null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
