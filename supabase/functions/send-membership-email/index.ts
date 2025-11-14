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
  type: 'welcome' | 'renewal' | 'credit_allocated' | 'subscription_cancelled' | 'credit_expiry_warning';
  email: string;
  data: {
    name?: string;
    plan?: string;
    credits?: number;
    renewalDate?: string;
    amount?: number;
    expiryDate?: string;
  };
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
      default:
        throw new Error(`Unknown email type: ${type}`);
    }

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <hello@notify.novaracleaning.com>",
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
