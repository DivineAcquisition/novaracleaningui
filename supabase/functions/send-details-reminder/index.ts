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
// All SMS routes through Telnyx via the existing _shared/sms.ts helper.
// All email goes out through Resend with the green-branded inline HTML
// below (kept inline so this function has zero React-email runtime deps
// and ships as a single small bundle).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendThroughCompliance } from "../_shared/email-compliance-send.ts";
import { sendSms } from "../_shared/sms.ts";

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
  `https://try.novaracleaning.com/book/details?booking_id=${bookingId}`;

const MAX_REMINDERS = 6;
// Minimum grace window after payment before the FIRST reminder fires.
// Customers are usually still in the browser tab finishing the home-
// detail questionnaire for the first few minutes; firing immediately
// just generates noise. After this window, the cron picks them up.
const MIN_AGE_MS_FIRST_REMINDER = 5 * 60 * 1000; // 5 minutes
const MIN_GAP_MS_PAYMENT = 5 * 60 * 1000;        // 5 minutes between manual triggers
const MIN_GAP_MS_CRON = 12 * 60 * 60 * 1000;     // 12 hours between cron-issued reminders

const SUPPORT_PHONE = "+1 (844) 735-2070";

function renderDetailsReminderEmail(args: {
  firstName: string;
  url: string;
  serviceDate?: string;
}) {
  const name = args.firstName || "there";
  const datePhrase = args.serviceDate ? ` on ${args.serviceDate}` : "";
  return `<h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">One quick step left</h1>
<p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 16px;">Your payment cleared — thank you! Before we can confirm your cleaning${escapeHtml(datePhrase)} and dispatch a cleaner, we need a few quick details about your home (bedrooms, bathrooms, access notes, etc.).</p>
<p style="margin:0 0 16px;font-weight:600;">Your booking is NOT confirmed until this step is complete.</p>
<p style="margin:22px 0 0;"><a class="novara-btn" href="${args.url}" style="display:inline-block;padding:14px 28px;background:#e7e7ea;color:#18181b;text-decoration:none;border-radius:12px;font-weight:600;">Complete Home Details</a></p>
<p style="margin:16px 0 0;font-size:14px;">It takes under a minute. If you need help, reply to this email or text us at ${SUPPORT_PHONE} and the Novara team will finish it with you.</p>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

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
  const html = renderDetailsReminderEmail({
    firstName: opts.firstName,
    url: COMPLETE_DETAILS_URL(opts.bookingId),
    serviceDate: opts.serviceDate,
  });
  await sendThroughCompliance(resendKey, {
    to: opts.to,
    subject: "Finish your Novara booking — home details needed",
    html,
    templateKey: "details_reminder",
    declaredType: "customer_service",
    bookingId: opts.bookingId,
  });
}

async function processBooking(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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

  if (booking.status !== "pending_details") {
    logStep("Booking no longer pending_details — skip", {
      bookingId,
      status: booking.status,
    });
    return { ok: false, reason: "wrong_status" };
  }

  const sentCount = booking.details_reminder_count || 0;
  if (sentCount >= MAX_REMINDERS) {
    logStep("Reminder cap reached", { bookingId, sentCount });
    return { ok: false, reason: "cap" };
  }

  // Enforce the 5-minute grace window for the very first reminder so
  // customers who are still actively completing /book/details don't
  // get a "you forgot!" SMS while they're literally typing in it.
  const paymentReceivedAt = booking.payment_received_at
    ? new Date(booking.payment_received_at).getTime()
    : 0;
  const now = Date.now();
  if (sentCount === 0 && paymentReceivedAt && now - paymentReceivedAt < MIN_AGE_MS_FIRST_REMINDER) {
    logStep("Within 5-minute grace window — skip first reminder", {
      bookingId,
      ageMs: now - paymentReceivedAt,
    });
    return { ok: false, reason: "grace_window" };
  }

  const lastSent = booking.details_reminder_sent_at
    ? new Date(booking.details_reminder_sent_at).getTime()
    : 0;
  const elapsed = now - lastSent;
  const gap = trigger === "cron" ? MIN_GAP_MS_CRON : MIN_GAP_MS_PAYMENT;
  if (lastSent && elapsed < gap) {
    logStep("Throttled", { bookingId, elapsedMs: elapsed, gapMs: gap });
    return { ok: false, reason: "throttle" };
  }

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
    logStep("Reminder SMS failed", {
      bookingId,
      error: smsErr instanceof Error ? smsErr.message : String(smsErr),
    });
  }

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
    logStep("Reminder email failed", {
      bookingId,
      error: emailErr instanceof Error ? emailErr.message : String(emailErr),
    });
  }

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

    // 5-minute floor mirrors MIN_AGE_MS_FIRST_REMINDER so we never
    // surface a booking that's still inside the customer's active
    // session. Customers who actually wandered off will land in this
    // query on the next 5-minute tick.
    const cutoff = new Date(Date.now() - MIN_AGE_MS_FIRST_REMINDER).toISOString();
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
