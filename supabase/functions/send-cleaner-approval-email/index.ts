/**
 * Send Cleaner Approval/Rejection Email
 * 
 * Notifies cleaners of their application status
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = "Novara Cleaning <noreply@novaracleaning.com>";

interface EmailRequest {
  cleanerId: string;
  email: string;
  firstName: string;
  approved: boolean;
  reason?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: EmailRequest = await req.json();
    const { email, firstName, approved, reason } = body;

    if (!email || !firstName) {
      throw new Error("Missing required fields: email, firstName");
    }

    const subject = approved
      ? "🎉 Welcome to the Novara Cleaning Team!"
      : "Update on Your Novara Cleaning Application";

    const html = approved
      ? generateApprovalEmail(firstName)
      : generateRejectionEmail(firstName, reason);

    // Send email via Resend
    if (RESEND_API_KEY) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Resend error:", errorText);
        throw new Error("Failed to send email");
      }

      console.log(`[EMAIL] Sent ${approved ? 'approval' : 'rejection'} email to ${email}`);
    } else {
      console.log(`[EMAIL] Resend API key not configured, would send to ${email}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[EMAIL] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateApprovalEmail(firstName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Novara Cleaning!</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #5500FF, #8F7BFD); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
      <span style="font-size: 40px;">✓</span>
    </div>
    <h1 style="color: #5500FF; margin: 0;">Welcome to the Team, ${firstName}!</h1>
  </div>
  
  <div style="background: linear-gradient(135deg, #5500FF10, #8F7BFD10); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 16px 0; font-size: 16px;">
      Great news! Your application to join Novara Cleaning has been <strong style="color: #10B981;">approved</strong>! 🎉
    </p>
    <p style="margin: 0; font-size: 16px;">
      You're now part of our growing team of professional cleaners.
    </p>
  </div>

  <h2 style="color: #5500FF; font-size: 18px;">What's Next?</h2>
  
  <div style="background: #f9f9f9; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
    <ol style="margin: 0; padding-left: 20px;">
      <li style="margin-bottom: 12px;">
        <strong>Set Up Payments</strong><br>
        <span style="color: #666; font-size: 14px;">Complete your Stripe Connect setup to receive instant payouts</span>
      </li>
      <li style="margin-bottom: 12px;">
        <strong>Set Your Availability</strong><br>
        <span style="color: #666; font-size: 14px;">Mark yourself as available to start receiving job offers</span>
      </li>
      <li style="margin-bottom: 12px;">
        <strong>Accept Your First Job</strong><br>
        <span style="color: #666; font-size: 14px;">You'll receive offers via SMS with easy accept/decline links</span>
      </li>
    </ol>
  </div>

  <div style="background: linear-gradient(135deg, #10B98110, #05966910); border: 1px solid #10B98130; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
    <h3 style="color: #059669; margin: 0 0 12px 0; font-size: 16px;">💰 Your Pay Rate</h3>
    <p style="margin: 0; font-size: 14px;">
      You're starting at <strong>$18/hour</strong>. Complete jobs and maintain good ratings to advance through our tier system and earn up to $22/hour!
    </p>
  </div>

  <div style="text-align: center; margin-bottom: 24px;">
    <a href="https://contractor.novaracleaning.com/cleaner/dashboard" style="display: inline-block; background: linear-gradient(135deg, #5500FF, #8F7BFD); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Go to Your Dashboard
    </a>
  </div>

  <div style="border-top: 1px solid #eee; padding-top: 20px; text-align: center; color: #666; font-size: 13px;">
    <p style="margin: 0 0 8px 0;">Questions? Contact us at hello@novaracleaning.com</p>
    <p style="margin: 0;">© ${new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
  </div>
</body>
</html>`;
}

function generateRejectionEmail(firstName: string, reason?: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application Update - Novara Cleaning</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #333; margin: 0;">Application Update</h1>
  </div>
  
  <p>Hi ${firstName},</p>
  
  <p>Thank you for your interest in joining Novara Cleaning.</p>
  
  <p>After careful review, we've decided not to move forward with your application at this time.</p>
  
  ${reason ? `
  <div style="background: #f9f9f9; border-left: 4px solid #DC2626; border-radius: 0 8px 8px 0; padding: 16px; margin: 20px 0;">
    <p style="margin: 0; font-size: 14px;"><strong>Feedback:</strong></p>
    <p style="margin: 8px 0 0 0; color: #666;">${reason}</p>
  </div>
  ` : ''}
  
  <p>We encourage you to apply again in the future if your circumstances change.</p>
  
  <p>Best regards,<br>The Novara Cleaning Team</p>

  <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 13px;">
    <p style="margin: 0 0 8px 0;">Questions? Contact us at hello@novaracleaning.com</p>
    <p style="margin: 0;">© ${new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
  </div>
</body>
</html>`;
}
