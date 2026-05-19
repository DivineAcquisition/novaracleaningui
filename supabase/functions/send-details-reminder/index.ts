// send-details-reminder
//
// Sends a Telnyx SMS + Resend email asking a NovaraCleaning customer to
// finish the home-detail questionnaire on /book/details. Two trigger
// modes:
//
//   1. trigger: "payment_succeeded"
//      Fired immediately by stripe-webhook when payment_intent.succeeded
//      finds a booking that paid but skipped the property questionnaire.
//      Throttled to one reminder per 30 minutes per booking so duplicate
//      webhook deliveries don't pile messages on the customer.
//
//   2. trigger: "cron"
//      Designed to be invoked on a schedule (every ~6 hours) by Supabase
//      Cron. Picks up every booking that's been sitting in
//      pending_details for >30 minutes and hasn't had a reminder in the
//      last 12 hours. Caps at 6 reminders so a customer who ghosted
//      stops getting nudged after ~3 days.
//
// All SMS is sent through the existing _shared/sms.ts helper, which
// routes through Telnyx and honors the existing opt-out + retry queue.
// All email is sent through Resend so it inherits the new green-branded
// EmailLayout (with the Novara logo at the top).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from "https://esm.sh/react@18.3.1";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";
import { sendSms } from "../_shared/sms.ts";
import { BRAND } from "../_shared/email-templates/brand.ts";
import { EmailLayout } from "../_shared/email-templates/components/EmailLayout.tsx";
import { Button } from "../_shared/email-templates/components/Button.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[DETAILS-REMINDER] ${step}${tail}`);
};

interface ReminderRequest {
  bookingId?: string;
  trigger?: "payment_succeeded" | "cron" | "manual";
}

const COMPLETE_DETAILS_URL = (bookingId: string) =>
  `https://app.novaracleaning.com/book/details?booking_id=${bookingId}`;

const MAX_REMINDERS = 6;
const MIN_GAP_MS_PAYMENT = 30 * 60 * 1000;       // 30 minutes after first send
const MIN_GAP_MS_CRON = 12 * 60 * 60 * 1000;     // 12 hours between cron reminders

const DetailsReminderEmail = ({
  firstName,
  url,
  serviceDate,
}: {
  firstName: string;
  url: string;
  serviceDate?: string;
}) => {
  return React.createElement(
    EmailLayout,
    {
      title: "One quick step left",
      subtitle: "Tell us about your home and we'll lock it in",
      previewText: "Finish your booking — share your home details",
      footerNote: "This link is unique to your booking and expires when complete.",
    },
    React.createElement(
      "div",
      null,
      React.createElement(
        "p",
        { style: { fontSize: "16px", lineHeight: "1.6", color: BRAND.colors.gray[700] } },
        `Hi ${firstName || "there"},`,
      ),
      React.createElement(
        "p",
        { style: { fontSize: "16px", lineHeight: "1.6", color: BRAND.colors.gray[700] } },
        `Your payment cleared — thank you! Before we can confirm your cleaning${
          serviceDate ? ` on ${serviceDate}` : ""
        } and dispatch a cleaner, we need a few quick details about your home (bedrooms, bathrooms, access notes, etc.).`,
      ),
      React.createElement(
        "p",
        {
          style: {
            fontSize: "16px",
            lineHeight: "1.6",
            color: BRAND.colors.gray[700],
            fontWeight: 600,
          },
        },
        "Your booking is NOT confirmed until this step is complete.",
      ),
      React.createElement(
        "div",
        { style: { textAlign: "center", margin: "24px 0" } },
        React.createElement(Button, { href: url }, "Complete Home Details"),
      ),
      React.createElement(
        "p",
        {
          style: {
            fontSize: "14px",
            lineHeight: "1.6",
            color: BRAND.colors.gray[600],
          },
        },
        "It takes under a minute. If you need help, reply to this email or text us at ",
        BRAND.contact.phone,
        " and the Novara team will finish it with you.",
      ),
    ),
  );
};

async function sendReminderEmail(opts: {
  to: string;
  firstName: string;
  bookingId: string;
  serviceDate?: string;
}) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    logStep("RESEND_API_KEY missing — skipping email");
    return;
  }
  const resend = new Resend(resendKey);
  const html = await renderAsync(
    React.createElement(DetailsReminderEmail, {
      firstName: opts.firstName,
      url: COMPLETE_DETAILS_URL(opts.bookingId),
      serviceDate: opts.serviceDate,
    }),
  );
  await resend.emails.send({
    from: "Novara Cleaning <hello@novaracleaning.com>",
    to: [opts.to],
    subject: "Finish your Novara booking — home details needed",
    html,
  });
}

async function processBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  trigger: ReminderRequest["trigger"],
) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();
  if (error || !booking) {
    logStep("Booking not found", { bookingId, error });
    return { ok: false, reason: "not_found" };
  }

  // Skip if booking is already past pending_details (e.g. finalized,
  // cancelled, or details since saved).
  if (booking.status !== "pending_details") {
    logStep("Booking no longer pending_details — skip", {
      bookingId,
      status: booking.status,
    });
    return { ok: false, reason: "wrong_status" };
  }

  // Cap reminders.
  const sentCount = booking.details_reminder_count || 0;
  if (sentCount >= MAX_REMINDERS) {
    logStep("Reminder cap reached", { bookingId, sentCount });
    return { ok: false, reason: "cap" };
  }

  // Throttle on trigger type.
  const lastSent = booking.details_reminder_sent_at
    ? new Date(booking.details_reminder_sent_at).getTime()
    : 0;
  const now = Date.now();
  const elapsed = now - lastSent;
  const gap = trigger === "cron" ? MIN_GAP_MS_CRON : MIN_GAP_MS_PAYMENT;
  if (lastSent && elapsed < gap) {
    logStep("Throttled — within minimum gap", {
      bookingId,
      elapsedMs: elapsed,
      gapMs: gap,
    });
    return { ok: false, reason: "throttle" };
  }

  // Compose a friendly SMS — short enough to fit in a single segment.
  const url = COMPLETE_DETAILS_URL(bookingId);
  const dateLabel = booking.service_date
    ? new Date(booking.service_date as string).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";
  const smsMsg =
    `NovaraCleaning: Thanks for your payment! ` +
    `Your ${dateLabel ? `${dateLabel} ` : ""}cleaning isn't confirmed yet — we need 60 sec of home details. ` +
    `Finish here: ${url}`;

  // Send SMS via Telnyx (sendSms handles opt-out + retry queue).
  try {
    if (booking.phone) {
      await sendSms(supabase, {
        toPhone: booking.phone as string,
        message: smsMsg,
        type: "reminder",
      });
      logStep("Reminder SMS sent", { bookingId });
    }
  } catch (smsErr) {
    logStep("Reminder SMS failed (non-blocking)", {
      bookingId,
      error: smsErr instanceof Error ? smsErr.message : String(smsErr),
    });
  }

  // Send email.
  try {
    if (booking.email) {
      const formattedDate = booking.service_date
        ? new Date(booking.service_date as string).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
        : undefined;
      await sendReminderEmail({
        to: booking.email as string,
        firstName: (booking.first_name as string) || "",
        bookingId,
        serviceDate: formattedDate,
      });
      logStep("Reminder email sent", { bookingId });
    }
  } catch (emailErr) {
    logStep("Reminder email failed (non-blocking)", {
      bookingId,
      error: emailErr instanceof Error ? emailErr.message : String(emailErr),
    });
  }

  // Bump counters.
  await supabase
    .from("bookings")
    .update({
      details_reminder_sent_at: new Date().toISOString(),
      details_reminder_count: sentCount + 1,
    })
    .eq("id", bookingId);

  return { ok: true, sentCount: sentCount + 1 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let body: ReminderRequest = {};
    try {
      body = await req.json();
    } catch (_) {
      // Empty body == cron mode.
    }
    const trigger = body.trigger || (body.bookingId ? "manual" : "cron");

    if (body.bookingId) {
      const result = await processBooking(supabase, body.bookingId, trigger);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Cron path — find every booking that's stuck on pending_details
    // for at least 30 minutes and process them.
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("bookings")
      .select("id")
      .eq("status", "pending_details")
      .lt("payment_received_at", cutoff)
      .order("payment_received_at", { ascending: true })
      .limit(50);
    if (error) {
      logStep("Cron query failed", { error });
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    let processed = 0;
    const results: Array<{ bookingId: string; ok: boolean; reason?: string }> = [];
    for (const row of rows || []) {
      const r = await processBooking(supabase, row.id as string, "cron");
      results.push({ bookingId: row.id as string, ...r });
      if (r.ok) processed++;
    }

    return new Response(
      JSON.stringify({ trigger, processed, total: rows?.length || 0, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logStep("Unhandled error", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
