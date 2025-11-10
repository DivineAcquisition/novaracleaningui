import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { BookingReminder } from '../_shared/email-templates/BookingReminder.tsx';

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-BOOKING-REMINDER-EMAIL] ${step}${detailsStr}`);
};


serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { email, data } = await req.json();
    logStep("Email request received", { email, reminderType: data.reminderType });

    if (!email) {
      throw new Error("Email address is required");
    }

    const html = await renderAsync(React.createElement(BookingReminder, data));
    
    const is24Hour = data.reminderType === '24_hour';
    const subject = is24Hour 
      ? '⚠️ Last Chance: Complete Your Novara Booking'
      : '🧹 Complete Your Novara Cleaning Booking';

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
