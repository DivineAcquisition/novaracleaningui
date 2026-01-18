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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const email = body?.email?.trim()?.toLowerCase();
    const firstName = body?.firstName || "";
    
    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    logStep("Generating verification code", { email });

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

    // Generate 6-digit code
    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minutes expiry

    // Delete any existing unused codes for this email first
    await supabase
      .from("cleaner_verification_codes")
      .delete()
      .eq("email", email)
      .eq("used", false);

    // Store new code in database
    const { error: insertError } = await supabase
      .from("cleaner_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt.toISOString(),
        used: false,
      });

    if (insertError) {
      logStep("Failed to store code", { error: insertError.message });
      return new Response(
        JSON.stringify({ error: "Failed to generate verification code. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Code stored in database", { email, expiresAt: expiresAt.toISOString() });

    // Try to send email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      logStep("RESEND_API_KEY not configured - code stored but email not sent");
      // Return success anyway since code was stored - user might be testing
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Verification code generated (email service not configured)",
          debug: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Send email using Resend REST API directly (more reliable than SDK)
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%); padding: 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">🧹 Welcome to Novara!</h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Verify your email to get started</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; color: #374151; line-height: 1.6;">
                Hi ${firstName || 'there'},
              </p>
              <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151; line-height: 1.6;">
                Thanks for joining Novara Cleaning! Enter this verification code to continue:
              </p>
              <!-- Code Box -->
              <div style="background: linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 40px; font-weight: 700; color: #ffffff; letter-spacing: 12px; font-family: 'Courier New', monospace;">
                  ${code}
                </span>
              </div>
              <!-- Warning -->
              <div style="background-color: #FFF7ED; border-left: 4px solid #F59E0B; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 14px; color: #92400E;">
                  <strong>⏰ This code expires in 15 minutes</strong><br>
                  Enter the code in the app to continue.
                </p>
              </div>
              <p style="margin: 0; font-size: 14px; color: #6B7280; line-height: 1.6;">
                If you didn't request this code, please ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px; background-color: #F9FAFB; text-align: center; border-top: 1px solid #E5E7EB;">
              <p style="margin: 0; font-size: 13px; color: #9CA3AF;">
                © ${new Date().getFullYear()} Novara Cleaning. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

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
          text: `Your Novara Cleaning verification code is ${code}. It expires in 15 minutes. If you didn't request this, please ignore this email.`,
        }),
      });

      const emailResult = await emailResponse.json();

      if (!emailResponse.ok) {
        logStep("Email send failed", { status: emailResponse.status, result: emailResult });
        // Still return success since code was stored - they can use resend
        return new Response(
          JSON.stringify({ 
            success: true,
            message: "Code generated. If you don't receive the email, try resending.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      logStep("Verification email sent successfully", { email, messageId: emailResult.id });

      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Verification code sent successfully"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );

    } catch (emailError) {
      logStep("Email send exception", { error: emailError instanceof Error ? emailError.message : String(emailError) });
      // Still return success since code was stored
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
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
