import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { BookingConfirmation } from '../_shared/email-templates/BookingConfirmation.tsx';
import { PaymentReceipt } from '../_shared/email-templates/PaymentReceipt.tsx';
import { generateICalFile } from '../_shared/calendar-utils.ts';

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
    newCustomerDiscount?: number;
    membershipDiscount?: number;
    fullPaymentDiscount?: number;
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
    let attachments: any[] = [];

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

      // Generate calendar attachment
      if (data.serviceDate && data.timeSlot) {
        try {
          const timeSlotParts = data.timeSlot.split('-');
          const startHour = parseInt(timeSlotParts[0]);
          const endHour = parseInt(timeSlotParts[1]);
          
          const serviceDate = new Date(data.serviceDate);
          const startDate = new Date(serviceDate);
          startDate.setHours(startHour, 0, 0, 0);
          
          const endDate = new Date(serviceDate);
          endDate.setHours(endHour, 0, 0, 0);

          const serviceTypeLabels: Record<string, string> = {
            standard: 'Standard Cleaning',
            deep: 'Deep Cleaning',
            moveInOut: 'Move In/Out Cleaning',
          };

          const calendarEvent = {
            title: `Novara Cleaning - ${serviceTypeLabels[data.serviceType || 'standard'] || 'Cleaning Service'}`,
            description: `${serviceTypeLabels[data.serviceType || 'standard'] || 'Cleaning'} for ${data.homeSize || 'your home'}.\n\nBooking ID: ${data.bookingId}\nContact: Novara Cleaning\nPhone: (555) 123-4567`,
            location: `${data.address}, ${data.city}, ${data.state} ${data.zipCode}`,
            startDate,
            endDate,
          };

          const icalContent = generateICalFile(calendarEvent);
          const base64Content = btoa(icalContent);
          
          attachments.push({
            filename: `novara-cleaning-${data.bookingId || 'booking'}.ics`,
            content: base64Content,
          });

          logStep("Calendar attachment generated", { bookingId: data.bookingId });
        } catch (calError) {
          logStep("Error generating calendar attachment", { error: calError.message });
          // Continue without attachment if calendar generation fails
        }
      }
    } else if (type === 'payment_receipt') {
      html = await renderAsync(React.createElement(PaymentReceipt, data));
      subject = `Payment Received - Novara Cleaning Receipt`;
    } else {
      throw new Error(`Unknown email type: ${type}`);
    }

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <hello@notify.novaracleaning.com>",
      to: [email],
      subject,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
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
