import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import React from "https://esm.sh/react@18.3.1";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";
import { BookingReminder } from "../_shared/email-templates/BookingReminder.tsx";
import { deliverCompliantEmail } from "../_shared/email-compliance-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-BOOKING-REMINDER-EMAIL] ${step}${detailsStr}`);
};

function subjectFor(type: string | undefined, firstName?: string): string {
  const name = firstName?.trim();
  switch (type) {
    case "2_hour":
      return name
        ? `${name}, your cleaning spot is still held`
        : "Your cleaning spot is still held — continue booking";
    case "next_day_noon":
      return name
        ? `Good afternoon ${name} — your Novara booking is still open`
        : "Good afternoon — your Novara booking is still open";
    case "day_2":
    case "24_hour":
      return "Final reminder: complete your Novara booking";
    case "10_minute":
    default:
      return "You're almost done — finish your booking & save $30";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { email, data } = await req.json();
    logStep("Email request received", {
      email,
      reminderType: data?.reminderType,
    });

    if (!email) throw new Error("Email address is required");

    const html = await renderAsync(React.createElement(BookingReminder, data));
    const subject = subjectFor(data?.reminderType, data?.firstName);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const emailResponse = await deliverCompliantEmail(supabase, {
      apiKey: Deno.env.get("RESEND_API_KEY") || "",
      to: email,
      subject,
      html,
      templateKey: "booking_reminder",
      category: "offers",
      bookingId: data?.bookingId || null,
    });
    if (!emailResponse.ok) {
      logStep("Email not sent", { blocked: emailResponse.blocked, error: emailResponse.error });
      return new Response(JSON.stringify({ success: false, blocked: emailResponse.blocked, error: emailResponse.error }), {
        status: emailResponse.blocked ? 409 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logStep("Email sent successfully", { messageId: emailResponse.id, type: emailResponse.type });

    return new Response(
      JSON.stringify({ success: true, messageId: emailResponse.id, warnings: emailResponse.warnings }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR sending email", { message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
