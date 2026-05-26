// prepare-completion-hold
//
// Places a manual-capture (auth-only) PaymentIntent on a customer's
// saved card for the remaining balance of an upcoming booking. Card
// networks (Visa/MC) cap manual-capture auths at 7 days, so we do
// this 5 days before service and capture on completion day — well
// inside the network window with room for retries.
//
// Lifecycle (per booking):
//   pending_retry → authorized → captured        (happy path)
//   pending_retry → pending_retry → ... 3 fails → cancelled_booking
//
// Retry policy:
//   • 3 attempts max, spaced ~24h apart via completion_hold_next_attempt_at
//   • Each failure → SMS + email asking customer to update card via
//     the Customer Portal
//   • Final failure → cancel the booking, refund the deposit, send
//     final notification
//
// Trigger modes:
//   1. cron — pg_cron hits this every hour with no body, we sweep all
//      eligible bookings (service_date ≤ now+5d, missing or stale hold)
//   2. direct invoke — { bookingId } processes a single booking
//      (used by reschedule-booking after a date change)
//
// Idempotency:
//   We row-lock per booking by atomically setting status to a sentinel
//   ('attempting') before doing any Stripe work. Concurrent cron runs
//   on the same booking are no-ops.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatServiceDate } from "../_shared/sms.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PREP-HOLD] ${step}${tail}`);
};

// Tunables.
const MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = 24 * 60 * 60 * 1000;             // 24h between retries
const HOLD_WINDOW_DAYS = 5;                            // Place auth at S-5
const PORTAL_URL = "https://app.novaracleaning.com/account";

interface ProcessResult {
  bookingId: string;
  outcome: "authorized" | "retry_scheduled" | "cancelled_booking" | "skipped";
  attempt?: number;
  error?: string;
  reason?: string;
}

async function logEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: {
    bookingId: string;
    attempt: number;
    outcome: string;
    paymentIntentId?: string | null;
    amountCents?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    notes?: string | null;
  },
) {
  try {
    await supabase.from("completion_hold_log").insert({
      booking_id: row.bookingId,
      attempt: row.attempt,
      outcome: row.outcome,
      payment_intent_id: row.paymentIntentId ?? null,
      amount_cents: row.amountCents ?? null,
      stripe_error_code: row.errorCode ?? null,
      stripe_error_message: row.errorMessage ?? null,
      notes: row.notes ?? null,
    });
  } catch (e) {
    log("logEvent failed (non-blocking)", { error: e instanceof Error ? e.message : String(e) });
  }
}

async function notifyCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  booking: any,
  kind: "auth_failed" | "auto_cancelled",
  errorMessage: string,
) {
  const dateLabel = formatServiceDate(booking.service_date);
  const firstName = booking.first_name || "there";
  const subject =
    kind === "auth_failed"
      ? "Action needed: update your payment method for your upcoming Novara cleaning"
      : "Your Novara cleaning was cancelled — payment couldn't be authorized";

  let smsMsg: string;
  let emailHtml: string;

  if (kind === "auth_failed") {
    smsMsg =
      `NovaraCleaning: We couldn't authorize the remaining balance for your ` +
      `${dateLabel} cleaning. Please update your card to keep your booking: ${PORTAL_URL}. ` +
      `We'll retry automatically.`;
    emailHtml = renderEmail({
      firstName,
      title: "Quick payment update needed",
      headline: "We couldn't authorize the remaining balance for your upcoming cleaning",
      body:
        `Your cleaning on <strong>${escapeHtml(dateLabel)}</strong> needs a payment-method update before we can secure ` +
        `the rest of your service total. The card on file came back as: ` +
        `<em>${escapeHtml(errorMessage)}</em>.`,
      ctaLabel: "Update Payment Method",
      ctaHref: PORTAL_URL,
      footerNote: "We'll retry automatically over the next couple of days. If we can't authorize after 3 attempts your booking will be cancelled and your deposit refunded.",
    });
  } else {
    smsMsg =
      `NovaraCleaning: Your ${dateLabel} cleaning was cancelled because we couldn't ` +
      `authorize payment after 3 attempts. Your deposit has been refunded. Questions? ` +
      `support@novaracleaning.com`;
    emailHtml = renderEmail({
      firstName,
      title: "Booking cancelled — deposit refunded",
      headline: "Your Novara cleaning has been cancelled",
      body:
        `We tried to pre-authorize the remaining balance for your ${escapeHtml(dateLabel)} cleaning ` +
        `three times and each attempt was declined by your bank. We've cancelled the booking and ` +
        `refunded your deposit in full. The most recent decline reason was: ` +
        `<em>${escapeHtml(errorMessage)}</em>.`,
      ctaLabel: "Rebook a Cleaning",
      ctaHref: "https://try.novaracleaning.com/book/zip",
      footerNote: "If you'd like to reschedule with a different card, simply book again and we'll secure your spot.",
    });
  }

  // Telnyx SMS — best effort.
  try {
    if (booking.phone) {
      await sendSms(supabase, {
        toPhone: booking.phone,
        message: smsMsg,
        type: kind === "auto_cancelled" ? "confirmation" : "reminder",
      });
    }
  } catch (e) {
    log("notify SMS failed (non-blocking)", { error: e instanceof Error ? e.message : String(e) });
  }

  // Resend email — uses the same green-branded inline HTML pattern.
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey && booking.email) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Novara Cleaning <hello@novaracleaning.com>",
          to: [booking.email],
          subject,
          html: emailHtml,
        }),
      });
      if (!res.ok) log("resend non-ok", { status: res.status });
    }
  } catch (e) {
    log("notify email failed (non-blocking)", { error: e instanceof Error ? e.message : String(e) });
  }
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

function renderEmail(opts: {
  firstName: string;
  title: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  footerNote?: string;
}) {
  const BRAND = {
    name: "NovaraCleaning",
    primary: "#16A34A",
    gradient: "linear-gradient(135deg, #16A34A 0%, #0E7C3A 100%)",
    gray700: "#374151",
    gray600: "#6B7280",
    gray200: "#E5E7EB",
    logoUrl: "https://app.novaracleaning.com/novara-logo.png",
    supportEmail: "support@novaracleaning.com",
    supportPhone: "+1 (844) 735-2070",
  };
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(opts.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray700};">` +
    `<div style="max-width:600px;margin:0 auto;padding:20px;">` +
    `<div style="background:#fff;padding:20px 20px 12px;text-align:center;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;">` +
    `<img src="${BRAND.logoUrl}" width="140" height="48" alt="${BRAND.name} logo" style="display:block;margin:0 auto 8px;"/>` +
    `<div style="font-size:14px;font-weight:700;letter-spacing:0.04em;color:${BRAND.primary};text-transform:uppercase;">${BRAND.name}</div>` +
    `</div>` +
    `<div style="background:${BRAND.gradient};color:#fff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">` +
    `<div style="font-size:24px;font-weight:bold;">${escapeHtml(opts.headline)}</div>` +
    `</div>` +
    `<div style="background:#fff;padding:30px;border:1px solid ${BRAND.gray200};border-top:none;">` +
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(opts.firstName)},</p>` +
    `<p style="font-size:16px;line-height:1.6;margin:0 0 24px;">${opts.body}</p>` +
    `<div style="text-align:center;margin:24px 0;">` +
    `<a href="${opts.ctaHref}" style="display:inline-block;background:${BRAND.gradient};color:#fff;padding:16px 40px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">${escapeHtml(opts.ctaLabel)}</a>` +
    `</div>` +
    (opts.footerNote
      ? `<p style="font-size:14px;line-height:1.6;color:${BRAND.gray600};margin:24px 0 0;">${escapeHtml(opts.footerNote)}</p>`
      : "") +
    `</div>` +
    `<div style="background:#fff;text-align:center;padding:20px;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;font-size:14px;color:${BRAND.gray600};">` +
    `<div style="margin:8px 0;">© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</div>` +
    `<div style="margin:12px 0;">Questions? <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a> or call ${BRAND.supportPhone}</div>` +
    `</div>` +
    `</div></body></html>`;
}

async function processBooking(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  stripe: Stripe,
  bookingId: string,
): Promise<ProcessResult> {
  // Atomic claim — flip the row to a sentinel that excludes us from
  // the next cron tick's candidate query. We pick rows that are eligible
  // (NULL, 'pending_retry', or 'expired' status; attempts < MAX) and
  // own the row by transitioning to 'attempting' before talking to Stripe.
  const { data: claimed, error: claimErr } = await supabase
    .from("bookings")
    .update({ completion_hold_status: "attempting" })
    .eq("id", bookingId)
    .or("completion_hold_status.is.null,completion_hold_status.eq.pending_retry,completion_hold_status.eq.expired")
    .lt("completion_hold_attempts", MAX_ATTEMPTS)
    .select()
    .single();

  if (claimErr || !claimed) {
    log("claim failed — booking not eligible", { bookingId, error: claimErr?.message });
    return { bookingId, outcome: "skipped", reason: "not_eligible_or_locked" };
  }

  const booking = claimed;
  const attempt = (booking.completion_hold_attempts ?? 0) + 1;

  // Sanity: we can only auth on a confirmed booking with a stored
  // payment method and a real balance to capture.
  if (booking.status !== "confirmed") {
    await supabase.from("bookings").update({ completion_hold_status: null }).eq("id", bookingId);
    return { bookingId, outcome: "skipped", reason: "status_not_confirmed" };
  }
  if (booking.uses_credit) {
    await supabase.from("bookings").update({ completion_hold_status: "skipped" }).eq("id", bookingId);
    return { bookingId, outcome: "skipped", reason: "uses_credit" };
  }
  const totalCents = booking.total_estimate_cents ?? 0;
  const depositCents = booking.deposit_cents ?? 0;
  const balanceCents = Math.max(0, totalCents - depositCents);
  if (balanceCents <= 0) {
    await supabase.from("bookings").update({ completion_hold_status: "skipped" }).eq("id", bookingId);
    return { bookingId, outcome: "skipped", reason: "no_balance" };
  }

  // Resolve Stripe customer + saved card.
  let customerId: string | null = null;
  if (booking.customer_id && typeof booking.customer_id === "string" && booking.customer_id.startsWith("cus_")) {
    customerId = booking.customer_id;
  } else if (booking.email) {
    const found = await stripe.customers.list({ email: booking.email, limit: 1 });
    customerId = found.data[0]?.id ?? null;
  }
  if (!customerId) {
    return await markFailed(supabase, booking, attempt, "missing_customer", "No Stripe customer found");
  }
  const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
  const pmId = pms.data[0]?.id;
  if (!pmId) {
    return await markFailed(supabase, booking, attempt, "missing_payment_method", "No saved card on file");
  }

  // Try to create the manual-capture (auth-only) PaymentIntent.
  try {
    const pi = await stripe.paymentIntents.create({
      amount: balanceCents,
      currency: "usd",
      customer: customerId,
      payment_method: pmId,
      capture_method: "manual",
      off_session: true,
      confirm: true,
      description: `Pre-auth hold for ${booking.service_type} cleaning on ${booking.service_date}`,
      statement_descriptor_suffix: "HOLD",
      metadata: {
        bookingId,
        bookingNumber: String(booking.booking_number ?? ""),
        chargeType: "completion_hold",
        attempt: String(attempt),
      },
    });

    if (pi.status === "requires_capture") {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await supabase
        .from("bookings")
        .update({
          completion_hold_pi_id: pi.id,
          completion_hold_amount_cents: balanceCents,
          completion_hold_status: "authorized",
          completion_hold_attempts: attempt,
          completion_hold_last_attempt_at: new Date().toISOString(),
          completion_hold_authorized_at: new Date().toISOString(),
          completion_hold_auth_expires_at: expiresAt.toISOString(),
          completion_hold_last_error: null,
          completion_hold_last_error_code: null,
          completion_hold_next_attempt_at: null,
        })
        .eq("id", bookingId);
      await logEvent(supabase, {
        bookingId,
        attempt,
        outcome: "authorized",
        paymentIntentId: pi.id,
        amountCents: balanceCents,
      });
      log("authorized", { bookingId, pi: pi.id, amount: balanceCents });
      return { bookingId, outcome: "authorized", attempt };
    }

    // Stripe accepted the request but the PI isn't in 'requires_capture'
    // (rare — would usually mean 3DS challenge required, which doesn't
    // work off_session). Treat as a failure for retry purposes.
    return await markFailed(
      supabase,
      booking,
      attempt,
      `unexpected_status:${pi.status}`,
      `PaymentIntent returned status ${pi.status}; off-session 3DS challenges are not supported`,
    );
  } catch (err) {
    // Card-decline / NSF / expired-card / etc.
    // deno-lint-ignore no-explicit-any
    const stripeErr = err as any;
    const code = stripeErr?.code || stripeErr?.decline_code || stripeErr?.type || "unknown";
    const message = stripeErr?.message || (err instanceof Error ? err.message : String(err));
    return await markFailed(supabase, booking, attempt, code, message);
  }
}

async function markFailed(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  booking: any,
  attempt: number,
  code: string,
  message: string,
): Promise<ProcessResult> {
  log("auth failed", { bookingId: booking.id, attempt, code, message });

  const isFinal = attempt >= MAX_ATTEMPTS;
  if (!isFinal) {
    const nextAt = new Date(Date.now() + RETRY_GAP_MS).toISOString();
    await supabase
      .from("bookings")
      .update({
        completion_hold_status: "pending_retry",
        completion_hold_attempts: attempt,
        completion_hold_last_attempt_at: new Date().toISOString(),
        completion_hold_next_attempt_at: nextAt,
        completion_hold_last_error: message.slice(0, 500),
        completion_hold_last_error_code: code,
      })
      .eq("id", booking.id);
    await logEvent(supabase, {
      bookingId: booking.id,
      attempt,
      outcome: "auth_failed",
      errorCode: code,
      errorMessage: message,
      notes: `next_attempt_at=${nextAt}`,
    });
    await notifyCustomer(supabase, booking, "auth_failed", message);
    return { bookingId: booking.id, outcome: "retry_scheduled", attempt, error: message };
  }

  // Final attempt failed — auto-cancel + refund deposit + final notice.
  await supabase
    .from("bookings")
    .update({
      completion_hold_status: "failed",
      completion_hold_attempts: attempt,
      completion_hold_last_attempt_at: new Date().toISOString(),
      completion_hold_next_attempt_at: null,
      completion_hold_last_error: message.slice(0, 500),
      completion_hold_last_error_code: code,
    })
    .eq("id", booking.id);
  await logEvent(supabase, {
    bookingId: booking.id,
    attempt,
    outcome: "auth_failed",
    errorCode: code,
    errorMessage: message,
    notes: "final_attempt_exhausted",
  });

  // Refund deposit + cancel booking. Reuses admin-refund-booking so
  // the refund + cancellation flow is identical to ops-issued refunds.
  try {
    await supabase.functions.invoke("admin-refund-booking", {
      body: {
        bookingId: booking.id,
        reason: `auto-cancel: pre-auth hold failed ${MAX_ATTEMPTS}x (${code})`,
        markCancelled: true,
      },
    });
    await logEvent(supabase, {
      bookingId: booking.id,
      attempt,
      outcome: "cancelled_booking",
      notes: `auto-refund triggered after ${MAX_ATTEMPTS} failed auth attempts`,
    });
    // Stamp the cancellation reason so admin tooling sees why this row flipped.
    await supabase
      .from("bookings")
      .update({
        auto_cancelled_reason: `pre_auth_hold_failed_${MAX_ATTEMPTS}x`,
        cancel_reason: `Auto-cancel: card declined ${MAX_ATTEMPTS}x for completion hold (${code})`,
      })
      .eq("id", booking.id);
  } catch (refundErr) {
    log("auto-refund invoke failed", { error: refundErr instanceof Error ? refundErr.message : String(refundErr) });
  }

  await notifyCustomer(supabase, booking, "auto_cancelled", message);
  return { bookingId: booking.id, outcome: "cancelled_booking", attempt, error: message };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let body: { bookingId?: string; trigger?: string } = {};
    try { body = await req.json(); } catch { /* cron call has empty body */ }

    if (body.bookingId) {
      const result = await processBooking(supabase, stripe, body.bookingId);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Cron sweep — pick all bookings due for an attempt and process
    // them sequentially. The query mirrors the partial index defined
    // in the migration. Capped at 50 per tick.
    const cutoffMaxDate = new Date(Date.now() + HOLD_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const minDate = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    const { data: candidates, error } = await supabase
      .from("bookings")
      .select("id")
      .eq("status", "confirmed")
      .eq("uses_credit", false)
      .gte("service_date", minDate)
      .lte("service_date", cutoffMaxDate)
      .lt("completion_hold_attempts", MAX_ATTEMPTS)
      .or(
        `completion_hold_status.is.null,` +
        `and(completion_hold_status.eq.pending_retry,completion_hold_next_attempt_at.lte.${nowIso}),` +
        `and(completion_hold_status.eq.expired,completion_hold_next_attempt_at.lte.${nowIso})`,
      )
      .order("service_date", { ascending: true })
      .limit(50);

    if (error) {
      log("cron query failed", { error: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const results: ProcessResult[] = [];
    for (const row of candidates || []) {
      const r = await processBooking(supabase, stripe, row.id);
      results.push(r);
    }

    return new Response(
      JSON.stringify({
        candidates: candidates?.length ?? 0,
        processed: results.length,
        outcomes: countBy(results, (r) => r.outcome),
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("unhandled", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

function countBy<T>(arr: T[], fn: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) {
    const k = fn(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
