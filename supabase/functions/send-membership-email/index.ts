import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { MembershipWelcome } from '../_shared/email-templates/MembershipWelcome.tsx';
import { MembershipRenewal } from '../_shared/email-templates/MembershipRenewal.tsx';
import { CreditAllocated } from '../_shared/email-templates/CreditAllocated.tsx';
import { SubscriptionCancelled } from '../_shared/email-templates/SubscriptionCancelled.tsx';
import { CreditExpiryWarning } from '../_shared/email-templates/CreditExpiryWarning.tsx';

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-MEMBERSHIP-EMAIL] ${step}${detailsStr}`);
};

interface MembershipEmailRequest {
  type: 'welcome' | 'renewal' | 'credit_allocated' | 'subscription_cancelled' | 'credit_expiry_warning' | 'checkout_link';
  email: string;
  data: {
    name?: string;
    plan?: string;
    credits?: number;
    renewalDate?: string;
    amount?: number;
    expiryDate?: string;
    // checkout_link
    url?: string;
    monthlyAmount?: number; // cents
    depositAmount?: number; // cents
    firstServiceDate?: string;
  };
}

const money = (cents?: number) => `$${(((cents ?? 0)) / 100).toFixed(2)}`;

// Simple, self-contained membership checkout-link email (no React template) so
// the customer receives the signup link an internal booking generated.
function renderCheckoutLink(d: MembershipEmailRequest["data"]): string {
  const name = d.name || "there";
  const plan = d.plan || "Membership";
  const depositLine = d.depositAmount && d.depositAmount > 0
    ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;">First-clean deposit at signup: <strong>${money(d.depositAmount)}</strong></p>`
    : "";
  const dateLine = d.firstServiceDate
    ? `<p style="margin:0 0 8px;color:#374151;font-size:14px;">Your first clean: <strong>${d.firstServiceDate}</strong></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#5500FF 0%,#3D00B8 100%);padding:28px 30px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:24px;">Start your ${plan} membership</h1></td></tr>
<tr><td style="padding:30px;">
<p style="margin:0 0 12px;color:#111827;font-size:16px;">Hi ${name},</p>
<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">You're almost set! Tap the button below to securely add your card and activate your Novara ${plan} membership.</p>
<p style="margin:0 0 8px;color:#374151;font-size:14px;">Monthly: <strong>${money(d.monthlyAmount)}/mo</strong></p>
${depositLine}${dateLine}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto;"><tr><td align="center" style="background:linear-gradient(135deg,#5500FF 0%,#3D00B8 100%);border-radius:8px;">
<a href="${d.url}" style="display:inline-block;padding:14px 32px;color:#fff;font-size:16px;font-weight:600;text-decoration:none;">Complete my signup</a></td></tr></table>
<p style="margin:16px 0 0;color:#6B7280;font-size:12px;line-height:1.5;">If the button doesn't work, copy this link:<br><a href="${d.url}" style="color:#5500FF;word-break:break-all;">${d.url}</a></p>
</td></tr>
<tr><td style="background:#fff;border-top:1px solid #E5E7EB;padding:18px;text-align:center;color:#6B7280;font-size:12px;">© ${new Date().getFullYear()} Novara Cleaning</td></tr>
</table></td></tr></table></body></html>`;
}


serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { type, email, data }: MembershipEmailRequest = await req.json();
    logStep("Email request received", { type, email });

    if (!email) {
      throw new Error("Email address is required");
    }

    let html: string;
    let subject: string;

    switch (type) {
      case 'welcome':
        html = await renderAsync(React.createElement(MembershipWelcome, data));
        subject = `Welcome to Novara ${data.plan} Membership! 🎉`;
        break;
      case 'renewal':
        html = await renderAsync(React.createElement(MembershipRenewal, data));
        subject = `Your Novara Membership Has Been Renewed 🔄`;
        break;
      case 'credit_allocated':
        html = await renderAsync(React.createElement(CreditAllocated, data));
        subject = `${data.credits} New Cleaning Credit(s) Added! ✨`;
        break;
      case 'subscription_cancelled':
        html = await renderAsync(React.createElement(SubscriptionCancelled, data));
        subject = `Your Novara Membership Has Been Cancelled`;
        break;
      case 'credit_expiry_warning':
        html = await renderAsync(React.createElement(CreditExpiryWarning, data));
        subject = `⚠️ Your Cleaning Credits Expire Soon!`;
        break;
      case 'checkout_link':
        html = renderCheckoutLink(data);
        subject = `Complete your Novara ${data.plan || "membership"} signup`;
        break;
      default:
        throw new Error(`Unknown email type: ${type}`);
    }

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: [email],
      subject,
      html,
    });

    logStep("Email sent successfully", { messageId: emailResponse });

    return new Response(JSON.stringify({ success: true, messageId: emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    logStep("ERROR sending email", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
