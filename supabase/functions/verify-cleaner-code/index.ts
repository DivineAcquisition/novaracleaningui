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
    const { email, code, redirectTo } = await req.json();
    
    if (!email || !code) {
      throw new Error("Email and code are required");
    }

    if (code.length !== 6) {
      throw new Error("Invalid code format");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

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
      throw new Error(`Database error: ${fetchError.message}`);
    }

    if (!verification) {
      throw new Error("Invalid or expired verification code");
    }

    // Check if code is expired
    const expiresAt = new Date(verification.expires_at);
    const now = new Date();
    
    if (now > expiresAt) {
      // Mark as used to prevent reuse
      await supabase
        .from("cleaner_verification_codes")
        .update({ used: true })
        .eq("id", verification.id);
      
      throw new Error("Verification code has expired");
    }

    logStep("Code verified successfully", { email });

    // Mark code as used
    const { error: updateError } = await supabase
      .from("cleaner_verification_codes")
      .update({ used: true })
      .eq("id", verification.id);

    if (updateError) {
      throw new Error(`Failed to mark code as used: ${updateError.message}`);
    }

    // Check if user already exists
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const user = existingUser?.users.find(u => u.email === email);

    let userId: string;
    
    if (!user) {
      // Create new user with auto-generated password
      const tempPassword = `${Math.random().toString(36).slice(-8)}${Date.now()}`;
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
        throw new Error(`Failed to create user: ${createError?.message}`);
      }
      
      userId = newUser.user.id;
      logStep("New user created", { email, userId });
    } else {
      userId = user.id;
      
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
    const tempPassword = `${crypto.randomUUID()}-${Date.now()}`;
    
    logStep("Generated temp password for session creation");

    // Update user with temporary password to enable sign-in
    const { error: passwordUpdateError } = await supabase.auth.admin.updateUserById(userId, {
      password: tempPassword,
      user_metadata: {
        onboarding: true,
        is_cleaner: true,
      }
    });

    if (passwordUpdateError) {
      throw new Error(`Failed to update user password: ${passwordUpdateError.message}`);
    }

    logStep("User password updated");

    // Sign in programmatically to get real session tokens
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email,
      password: tempPassword,
    });

    if (signInError || !signInData.session) {
      throw new Error(`Failed to create session: ${signInError?.message}`);
    }

    logStep("Session created successfully", { email });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Code verified successfully",
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        email: email,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
