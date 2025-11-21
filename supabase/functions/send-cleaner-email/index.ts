import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";
import * as React from "https://esm.sh/react@18.3.1";
import { CleanerInvitation } from "../_shared/email-templates/CleanerInvitation.tsx";
import { CleanerAssignment } from "../_shared/email-templates/CleanerAssignment.tsx";
import { BookingCompletion } from "../_shared/email-templates/BookingCompletion.tsx";
import { PayoutConfirmation } from "../_shared/email-templates/PayoutConfirmation.tsx";
import { CleanerCredentials } from "../_shared/email-templates/CleanerCredentials.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-CLEANER-EMAIL] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, email, data } = await req.json();
    logStep("Sending cleaner email", { type, email });

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    let subject = "";
    let html = "";

    switch (type) {
      case "invitation":
        subject = "Welcome to Novara Cleaning Team!";
        html = await renderAsync(
          React.createElement(CleanerInvitation, {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            onboardingUrl: data.onboardingUrl,
          })
        );
        break;

      case "assignment":
        subject = "New Booking Assignment";
        html = await renderAsync(
          React.createElement(CleanerAssignment, {
            cleanerFirstName: data.cleanerFirstName,
            bookingId: data.bookingId,
            customerName: data.customerName,
            serviceDate: data.serviceDate,
            timeSlot: data.timeSlot,
            serviceType: data.serviceType,
            address: data.address,
            city: data.city,
            state: data.state,
            zipCode: data.zipCode,
            estimatedEarnings: data.estimatedEarnings,
            dashboardUrl: data.dashboardUrl,
          })
        );
        break;

      case "completion":
        subject = "Booking Completed - Payout Initiated";
        html = await renderAsync(
          React.createElement(BookingCompletion, {
            cleanerFirstName: data.cleanerFirstName,
            bookingId: data.bookingId,
            serviceDate: data.serviceDate,
            customerName: data.customerName,
            earnings: data.earnings,
            payoutStatus: data.payoutStatus,
          })
        );
        break;

      case "payout":
        subject = "Payment Sent to Your Account";
        html = await renderAsync(
          React.createElement(PayoutConfirmation, {
            cleanerFirstName: data.cleanerFirstName,
            bookingId: data.bookingId,
            amount: data.amount,
            transferId: data.transferId,
            transferDate: data.transferDate,
          })
        );
        break;

      case "credentials":
        subject = "Your Novara Cleaning Account - Login Credentials";
        html = await renderAsync(
          React.createElement(CleanerCredentials, {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            password: data.password,
            loginUrl: data.loginUrl,
          })
        );
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

    logStep("Email sent successfully", { data: emailResponse.data });

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
