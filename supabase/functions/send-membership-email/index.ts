import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { MembershipWelcome } from '../_shared/email-templates/MembershipWelcome.tsx';
import { MembershipRenewal } from '../_shared/email-templates/MembershipRenewal.tsx';
import { CreditAllocated } from '../_shared/email-templates/CreditAllocated.tsx';
import { SubscriptionCancelled } from '../_shared/email-templates/SubscriptionCancelled.tsx';
import { CreditExpiryWarning } from '../_shared/email-templates/CreditExpiryWarning.tsx';
import { RecurringPaused } from '../_shared/email-templates/RecurringPaused.tsx';
import { buildEmailCard } from '../_shared/email-compliance.ts';

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
  type: 'welcome' | 'renewal' | 'credit_allocated' | 'subscription_cancelled' | 'credit_expiry_warning' | 'checkout_link' | 'recurring_paused' | 'recurring_resumed';
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
    // recurring_paused / recurring_resumed
    reason?: string;
    when?: string;
    chargedLabel?: string;
    cadence?: string;
    subject?: string;
  };
}

const money = (cents?: number) => `$${(((cents ?? 0)) / 100).toFixed(2)}`;

// Simple, self-contained membership checkout-link email (no React template) so
// the customer receives the signup link an internal booking generated.
function renderCheckoutLink(d: MembershipEmailRequest["data"]): string {
  const name = d.name || "there";
  const plan = d.plan || "Membership";
  const depositLine = d.depositAmount && d.depositAmount > 0
    ? `<p style="margin:0 0 8px;font-size:14px;">First-clean deposit at signup: <strong>${money(d.depositAmount)}</strong></p>`
    : "";
  const dateLine = d.firstServiceDate
    ? `<p style="margin:0 0 8px;font-size:14px;">Your first clean: <strong>${d.firstServiceDate}</strong></p>`
    : "";
  return buildEmailCard({
    title: `Start your ${plan} membership`,
    bodyHtml: `<p style="margin:0 0 12px;">Hi ${name},</p>
<p style="margin:0 0 16px;">You're almost set. Use the button to add your card and activate your Novara ${plan} membership.</p>
<p style="margin:0 0 8px;">Monthly: <strong>${money(d.monthlyAmount)}/mo</strong></p>
${depositLine}${dateLine}`,
    buttonHref: d.url || "",
    buttonLabel: "Complete my signup",
  });
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
      case 'recurring_paused':
        html = await renderAsync(React.createElement(RecurringPaused, data));
        subject = data.subject || "Your Novara recurring cleaning is paused";
        break;
      case 'recurring_resumed': {
        const who = data.name || "there";
        const when = data.when || "your usual day";
        const charged = data.chargedLabel
          ? `<p style="margin:0 0 16px;">We charged <strong>${data.chargedLabel}</strong> to the card on file.</p>`
          : "";
        subject = data.subject || "Your Novara recurring cleaning is back on";
        html = buildEmailCard({
          title: "Your cleaning is back on",
          bodyHtml: `<p style="margin:0 0 16px;">Hi ${who},</p>
<p style="margin:0 0 16px;">Your recurring cleaning has resumed. Next visit: <strong>${when}</strong>.</p>
${charged}
<p style="margin:0;">Questions? Call (844) 735-2070.</p>`,
        });
        break;
      }
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
