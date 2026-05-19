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
import { Resend } from "https://esm.sh/resend@4.0.0";
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
  `https://app.novaracleaning.com/book/details?booking_id=${bookingId}`;

const MAX_REMINDERS = 6;
const MIN_GAP_MS_PAYMENT = 30 * 60 * 1000;       // 30 minutes
const MIN_GAP_MS_CRON = 12 * 60 * 60 * 1000;     // 12 hours

// Green brand palette mirrors supabase/functions/_shared/email-templates/brand.ts.
const BRAND = {
  name: "NovaraCleaning",
  primary: "#16A34A",
  primaryDark: "#0E7C3A",
  gradient: "linear-gradient(135deg, #16A34A 0%, #0E7C3A 100%)",
  gray700: "#374151",
  gray600: "#6B7280",
  gray200: "#E5E7EB",
  logoUrl: "https://app.novaracleaning.com/novara-logo.png",
  supportPhone: "+1 (844) 735-2070",
  supportEmail: "support@novaracleaning.com",
};

function renderDetailsReminderEmail(args: {
  firstName: string;
  url: string;
  serviceDate?: string;
}) {
  const name = args.firstName || "there";
  const datePhrase = args.serviceDate ? ` on ${args.serviceDate}` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
<title>Finish your Novara booking</title></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray700};">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#fff;padding:20px 20px 12px;text-align:center;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;">
    <img src="${BRAND.logoUrl}" width="140" height="48" alt="${BRAND.name} logo" style="display:block;margin:0 auto 8px;"/>
    <div style="font-size:14px;font-weight:700;letter-spacing:0.04em;color:${BRAND.primary};text-transform:uppercase;">${BRAND.name}</div>
  </div>
  <div style="background:${BRAND.gradient};color:#fff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">
    <div style="font-size:24px;font-weight:bold;">One quick step left</div>
    <div style="font-size:16px;opacity:0.95;margin-top:8px;">Tell us about your home and we'll lock it in</div>
  </div>
  <div style="background:#fff;padding:30px;border:1px solid ${BRAND.gray200};border-top:none;">
    <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
    <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Your payment cleared — thank you! Before we can confirm your cleaning${escapeHtml(datePhrase)} and dispatch a cleaner, we need a few quick details about your home (bedrooms, bathrooms, access notes, etc.).</p>
    <p style="font-size:16px;line-height:1.6;margin:0 0 24px;font-weight:600;">Your booking is NOT confirmed until this step is complete.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${args.url}" style="display:inline-block;background:${BRAND.gradient};color:#fff;padding:16px 40px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">Complete Home Details</a>
    </div>
    <p style="font-size:14px;line-height:1.6;color:${BRAND.gray600};margin:24px 0 0;">It takes under a minute. If you need help, reply to this email or text us at ${BRAND.supportPhone} and the Novara team will finish it with you.</p>
  </div>
  <div style="background:#fff;text-align:center;padding:20px;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;font-size:14px;color:${BRAND.gray600};">
    <div style="margin:8px 0;">© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</div>
    <div style="margin:12px 0;">
      <a href="https://novaracleaning.com" style="color:${BRAND.primary};text-decoration:none;">Website</a> ·
      <a href="https://app.novaracleaning.com/account" style="color:${BRAND.primary};text-decoration:none;">My Account</a> ·
      <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">Contact</a>
    </div>
  </div>
</div></body></html>`;
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
  const resend = new Resend(resendKey);
  const html = renderDetailsReminderEmail({
    firstName: opts.firstName,
    url: COMPLETE_DETAILS_URL(opts.bookingId),
    serviceDate: opts.serviceDate,
  });
  await resend.emails.send({
    from: "Novara Cleaning <hello@novaracleaning.com>",
    to: [opts.to],
    subject: "Finish your Novara booking — home details needed",
    html,
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

  const lastSent = booking.details_reminder_sent_at
    ? new Date(booking.details_reminder_sent_at).getTime()
    : 0;
  const now = Date.now();
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
