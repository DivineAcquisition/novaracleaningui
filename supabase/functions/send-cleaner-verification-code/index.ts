import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  logStep("Function invoked", { method: req.method });

  try {
    // Parse request body
    let body;
    try {
      body = await req.json();
      logStep("Request body parsed", { hasEmail: !!body?.email });
    } catch (parseError) {
      logStep("Failed to parse request body", { error: String(parseError) });
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const email = body?.email?.trim()?.toLowerCase();
    const firstName = body?.firstName || "";
    
    if (!email) {
      logStep("Email missing");
      return new Response(
        JSON.stringify({ success: false, error: "Email is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logStep("Invalid email format", { email });
      return new Response(
        JSON.stringify({ success: false, error: "Invalid email format" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    logStep("Generating verification code", { email });

    // Check environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      logStep("Missing Supabase configuration", { 
        hasUrl: !!supabaseUrl, 
        hasKey: !!supabaseKey 
      });
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error. Please contact support." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generate 6-digit code
    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    logStep("Code generated", { code: code.substring(0, 2) + "****", expiresAt: expiresAt.toISOString() });

    // Try to delete existing unused codes for this email (non-critical)
    try {
      const { error: deleteError } = await supabase
        .from("cleaner_verification_codes")
        .delete()
        .eq("email", email)
        .eq("used", false);
      
      if (deleteError) {
        logStep("Could not delete old codes (non-critical)", { error: deleteError.message });
      }
    } catch (deleteErr) {
      logStep("Delete old codes exception (non-critical)", { error: String(deleteErr) });
    }

    // Store new code in database
    logStep("Inserting code into database");
    const { data: insertData, error: insertError } = await supabase
      .from("cleaner_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt.toISOString(),
        used: false,
      })
      .select()
      .single();

    if (insertError) {
      logStep("Failed to store code in database", { 
        error: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint
      });
      
      // Check if it's a table not found error
      if (insertError.message?.includes("relation") || insertError.code === "42P01") {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "Database setup incomplete. Please contact support.",
            debug: { errorCode: insertError.code }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Failed to generate verification code. Please try again.",
          debug: { errorMessage: insertError.message }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    logStep("Code stored successfully", { id: insertData?.id });

    // Try to send email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      logStep("RESEND_API_KEY not configured - returning code in debug mode");
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Code generated (email service not configured)",
          debug: true,
          // Only include code in development/debug scenarios
          testCode: code
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%); padding: 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">🧹 Novara Cleaning</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Your verification code</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151;">Hi ${firstName || 'there'},</p>
              <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">Enter this code to verify your email:</p>
              <div style="background: linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 36px; font-weight: 700; color: #ffffff; letter-spacing: 8px; font-family: monospace;">${code}</span>
              </div>
              <p style="margin: 0; font-size: 14px; color: #6B7280; background: #FFF7ED; padding: 12px; border-radius: 8px; border-left: 4px solid #F59E0B;">
                ⏰ This code expires in 15 minutes
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px; background-color: #F9FAFB; text-align: center; border-top: 1px solid #E5E7EB;">
              <p style="margin: 0; font-size: 12px; color: #9CA3AF;">If you didn't request this code, ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    logStep("Sending email via Resend");
    
    try {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Novara Cleaning <hello@novaracleaning.com>",
          to: [email],
          subject: `${code} is your Novara verification code`,
          html: emailHtml,
          text: `Your Novara Cleaning verification code is ${code}. It expires in 15 minutes.`,
        }),
      });

      const emailResult = await emailResponse.json();
      logStep("Resend API response", { 
        status: emailResponse.status, 
        ok: emailResponse.ok,
        result: emailResult 
      });

      if (!emailResponse.ok) {
        logStep("Email send failed but code was stored", { error: emailResult });
        return new Response(
          JSON.stringify({ 
            success: true,
            message: "Code generated. Check your spam folder if you don't see the email.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      logStep("Email sent successfully", { messageId: emailResult.id });

      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Verification code sent! Check your email."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );

    } catch (emailError) {
      logStep("Email send exception", { error: String(emailError) });
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Code generated. If you don't receive the email, try resending.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("FATAL ERROR", { message: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "An unexpected error occurred. Please try again.",
        debug: { message: errorMessage }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
