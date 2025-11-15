import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from 'https://esm.sh/resend@2.0.0';
import { render } from 'https://esm.sh/@react-email/render@1.0.1';
import * as React from 'https://esm.sh/react@18.3.1';
import { CleanerVerificationCode } from "../_shared/email-templates/CleanerVerificationCode.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-VERIFICATION-CODE] ${step}${detailsStr}`);
};

const generateCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, firstName } = await req.json();
    
    if (!email) {
      throw new Error("Email is required");
    }

    logStep("Generating verification code", { email });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Generate 6-digit code
    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minutes expiry

    // Store code in database
    const { error: insertError } = await supabase
      .from("cleaner_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt.toISOString(),
        used: false,
      });

    if (insertError) {
      throw new Error(`Failed to store verification code: ${insertError.message}`);
    }

    logStep("Code stored in database", { email, expiresAt });

    // Send email with verification code
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    
    const html = await render(
      React.createElement(CleanerVerificationCode, {
        code,
        firstName: firstName || "there",
      })
    );

    const { error: emailError } = await resend.emails.send({
      from: "Novara Cleaning <onboarding@novaracleaning.com>",
      to: [email],
      subject: "Your Cleaner Verification Code",
      html,
    });

    if (emailError) {
      logStep("Email send failed", { error: emailError });
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    logStep("Verification email sent successfully", { email });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Verification code sent successfully"
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
