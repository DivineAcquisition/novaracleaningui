import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { BookingConfirmation } from '../_shared/email-templates/BookingConfirmation.tsx';
import { PaymentReceipt } from '../_shared/email-templates/PaymentReceipt.tsx';

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-BOOKING-EMAIL] ${step}${detailsStr}`);
};

interface BookingEmailRequest {
  type: 'confirmation' | 'payment_receipt';
  email: string;
  data: {
    firstName?: string;
    lastName?: string;
    bookingId?: string;
    serviceDate?: string;
    timeSlot?: string;
    serviceType?: string;
    homeSize?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    totalAmount?: number;
    depositAmount?: number;
    balanceAmount?: number;
    paymentOption?: string;
    useCredit?: boolean;
    addOns?: string[];
  };
}


serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { type, email, data }: BookingEmailRequest = await req.json();
    logStep("Email request received", { type, email });

    if (!email) {
      throw new Error("Email address is required");
    }

    let html: string;
    let subject: string;

    if (type === 'confirmation') {
      html = await renderAsync(React.createElement(BookingConfirmation, data));
      const formattedDate = data.serviceDate
        ? new Date(data.serviceDate).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '';
      subject = `Booking Confirmed! Your Novara Cleaning on ${formattedDate} ✨`;
    } else if (type === 'payment_receipt') {
      html = await renderAsync(React.createElement(PaymentReceipt, data));
      subject = `Payment Received - Novara Cleaning Receipt`;
    } else {
      throw new Error(`Unknown email type: ${type}`);
    }

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <onboarding@resend.dev>",
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
