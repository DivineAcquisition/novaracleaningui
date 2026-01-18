import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-CODE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const email = body?.email?.trim()?.toLowerCase();
    const code = body?.code?.trim();
    
    if (!email || !code) {
      return new Response(
        JSON.stringify({ error: "Email and code are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      return new Response(
        JSON.stringify({ error: "Invalid code format. Please enter a 6-digit code." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      logStep("Missing Supabase configuration");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    logStep("Verifying code", { email });

    // Find the most recent unused code for this email
    const { data: verification, error: fetchError } = await supabase
      .from("cleaner_verification_codes")
      .select("*")
      .eq("email", email)
      .eq("code", code)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      logStep("Database error", { error: fetchError.message });
      return new Response(
        JSON.stringify({ error: "Unable to verify code. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!verification) {
      logStep("Code not found or already used", { email });
      return new Response(
        JSON.stringify({ error: "Invalid verification code. Please check and try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Check if code is expired
    const expiresAt = new Date(verification.expires_at);
    const now = new Date();
    
    if (now > expiresAt) {
      logStep("Code expired", { email, expiredAt: verification.expires_at });
      
      // Mark as used to prevent reuse
      await supabase
        .from("cleaner_verification_codes")
        .update({ used: true })
        .eq("id", verification.id);
      
      return new Response(
        JSON.stringify({ error: "Verification code has expired. Please request a new one." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    logStep("Code verified successfully", { email });

    // Mark code as used
    const { error: updateError } = await supabase
      .from("cleaner_verification_codes")
      .update({ used: true })
      .eq("id", verification.id);

    if (updateError) {
      logStep("Failed to mark code as used", { error: updateError.message });
      // Continue anyway - code was valid
    }

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email);

    let userId: string;
    
    if (!existingUser) {
      // Create new user with auto-generated password
      const tempPassword = `${crypto.randomUUID()}-${Date.now()}`;
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          onboarding: true,
          is_cleaner: true,
        }
      });

      if (createError || !newUser.user) {
        logStep("Failed to create user", { error: createError?.message });
        return new Response(
          JSON.stringify({ error: "Failed to create account. Please try again." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
      
      userId = newUser.user.id;
      logStep("New user created", { email, userId });
    } else {
      userId = existingUser.id;
      
      // Update metadata for existing user
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          onboarding: true,
          is_cleaner: true,
        }
      });
      
      logStep("Existing user found", { email, userId });
    }

    // Generate a secure temporary password for session creation
    const sessionPassword = `${crypto.randomUUID()}-${Date.now()}`;
    
    // Update user with temporary password to enable sign-in
    const { error: passwordUpdateError } = await supabase.auth.admin.updateUserById(userId, {
      password: sessionPassword,
      user_metadata: {
        onboarding: true,
        is_cleaner: true,
      }
    });

    if (passwordUpdateError) {
      logStep("Failed to update user password", { error: passwordUpdateError.message });
      return new Response(
        JSON.stringify({ error: "Failed to establish session. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("User password updated for session creation");

    // Sign in programmatically to get real session tokens
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email,
      password: sessionPassword,
    });

    if (signInError || !signInData.session) {
      logStep("Failed to create session", { error: signInError?.message });
      return new Response(
        JSON.stringify({ error: "Failed to create session. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Session created successfully", { email, userId });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Code verified successfully",
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        email: email,
        userId: userId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
