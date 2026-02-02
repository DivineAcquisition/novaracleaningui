import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from 'https://esm.sh/resend@4.0.0';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1,react-dom@18.3.1';
import * as React from 'https://esm.sh/react@18.3.1';
import { CleanerVerificationCode } from "../_shared/email-templates/CleanerVerificationCode.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
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
    const { email, firstName, debug } = await req.json();
    
    if (!email) {
      throw new Error("Email is required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error("Invalid email format");
    }

    const normalizedEmail = email.toLowerCase().trim();
    logStep("Generating verification code", { email: normalizedEmail });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      logStep("Missing Supabase configuration");
      throw new Error("Server configuration error");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generate 6-digit code
    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minutes expiry

    // Delete any existing unused codes for this email to prevent duplicates
    const { error: deleteError } = await supabase
      .from("cleaner_verification_codes")
      .delete()
      .eq("email", normalizedEmail)
      .eq("used", false);
    
    if (deleteError) {
      logStep("Delete old codes warning (non-fatal)", { error: deleteError.message });
      // Continue anyway - this is not critical
    }

    // Store code in database
    const { data: insertData, error: insertError } = await supabase
      .from("cleaner_verification_codes")
      .insert({
        email: normalizedEmail,
        code,
        expires_at: expiresAt.toISOString(),
        used: false,
      })
      .select()
      .single();

    if (insertError) {
      logStep("Database insert error", { 
        error: insertError.message, 
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint
      });
      // If table doesn't exist or other DB error, provide helpful message
      if (insertError.code === "42P01") {
        throw new Error("Database table not found. Please contact support.");
      } else if (insertError.code === "42501") {
        throw new Error("Database permission error. Please contact support.");
      }
      throw new Error(`Database error: ${insertError.message}`);
    }
    
    logStep("Code inserted successfully", { id: insertData?.id });

    logStep("Code stored in database", { email: normalizedEmail, expiresAt });

    // Send email with verification code
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      logStep("Missing RESEND_API_KEY");
      throw new Error("Email service not configured");
    }
    
    const resend = new Resend(resendApiKey);
    
    let html = "";
    try {
      html = await renderAsync(
        React.createElement(CleanerVerificationCode, {
          code,
          firstName: firstName || "there",
        })
      );
      logStep("Rendered HTML", { 
        length: html?.length ?? 0, 
        snippet: html?.slice(0, 200) ?? "" 
      });
    } catch (error) {
      const renderError = error instanceof Error ? error : new Error(String(error));
      logStep("Render error", { error: renderError.message });
      // Fallback to simple HTML
      html = `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Your Verification Code</h2>
          <p>Hi ${firstName || "there"},</p>
          <p>Your Novara Cleaning verification code is:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #7C3AED;">${code}</p>
          <p>This code expires in 15 minutes.</p>
        </div>
      `;
    }

    const text = `Your Novara verification code is ${code}. It expires in 15 minutes.`;

    // Debug mode: return HTML without sending
    if (debug) {
      logStep("Debug mode: returning HTML without sending", { email: normalizedEmail });
      return new Response(
        JSON.stringify({ 
          success: true,
          debug: true,
          html,
          text,
          htmlLength: html.length
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    try {
      logStep("Attempting to send email via Resend", { to: normalizedEmail });
      
      // Use Resend's test domain for reliability, or custom domain if verified
      const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Novara Cleaning <onboarding@resend.dev>";
      logStep("Using from email", { from: fromEmail });
      
      const emailResult = await resend.emails.send({
        from: fromEmail,
        to: [normalizedEmail],
        subject: "Your Novara Cleaning Verification Code",
        html,
        text,
      });

      logStep("Resend response", { result: emailResult });

      if (emailResult.error) {
        logStep("Email send failed", { error: emailResult.error });
        throw new Error(`Email service error: ${emailResult.error.message || JSON.stringify(emailResult.error)}`);
      }
      
      if (!emailResult.data?.id) {
        logStep("No email ID returned", { result: emailResult });
        throw new Error("Email send failed - no confirmation received");
      }
      
      logStep("Email sent successfully", { emailId: emailResult.data.id });
    } catch (emailException: any) {
      logStep("Email exception", { 
        message: emailException?.message,
        name: emailException?.name,
        stack: emailException?.stack
      });
      
      // More specific error messages based on common Resend errors
      const errMsg = emailException?.message || "";
      if (errMsg.includes("domain") || errMsg.includes("verified")) {
        throw new Error("Email domain not verified. Please contact support.");
      } else if (errMsg.includes("rate") || errMsg.includes("limit")) {
        throw new Error("Too many emails sent. Please wait a moment and try again.");
      } else if (errMsg.includes("invalid") && errMsg.includes("email")) {
        throw new Error("Invalid email address format.");
      } else {
        throw new Error(`Email service error: ${errMsg || "Unknown error"}`);
      }
    }

    logStep("Verification email sent successfully", { email: normalizedEmail });

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
    const errorStack = error instanceof Error ? error.stack : undefined;
    logStep("ERROR", { message: errorMessage, stack: errorStack });
    
    // Return more specific error for debugging (remove in production)
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        debug_info: process.env.NODE_ENV !== 'production' ? errorStack : undefined
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
