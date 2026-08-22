import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import { SUPPORT_PHONE_DISPLAY } from "../_shared/booking-policy.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";

// pending-deposit-reminders
//
// Unpaid deposit invoices (VA / internal bookings) get a short reminder
// window, then auto-cancel so the date is not held forever:
//   30 minutes → 2 hours → next day + 2 hours (final)
//   then auto-cancel if still unpaid.
//
// Public abandoned checkout (no invoice) stays on send-booking-reminder.
// Admins / VAs can reinstate an auto-cancelled unpaid deposit from the
// Bookings tab (admin-modify-booking action reinstate_unpaid_deposit).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KINDS = {
  "30m": "pending_deposit_reminder_30m",
  "2h": "pending_deposit_reminder_2h",
  next_day_2h: "pending_deposit_reminder_next_day_2h",
  auto_cancel: "pending_deposit_auto_cancelled",
} as const;

type ReminderType = "30m" | "2h" | "next_day_2h";

const AUTO_CANCEL_REASON =
  "Unpaid deposit — auto-cancelled after the reminder window (30 min, 2 hr, next day + 2 hr).";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function isAwaitingDeposit(row: Record<string, unknown>): boolean {
  if (row.payment_received_at) return false;
  if (row.uses_credit === true) return false;
  if (row.is_reclean === true) return false;
  const deposit = Number(row.deposit_cents || 0);
  const hasInvoice = Boolean(row.hosted_invoice_url || row.stripe_invoice_id);
  return hasInvoice && deposit > 0;
}

function anchorAt(row: { pending_deposit_started_at?: string | null; created_at?: string | null }): Date {
  const raw = row.pending_deposit_started_at || row.created_at;
  const d = raw ? new Date(raw) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function pickReminderType(ageHours: number): ReminderType | null {
  const ageMin = ageHours * 60;
  if (ageMin >= 30 && ageMin < 120) return "30m";
  if (ageHours >= 2 && ageHours < 20) return "2h";
  if (ageHours >= 26 && ageHours < 28) return "next_day_2h";
  return null;
}

function copyFor(
  type: ReminderType,
  firstName: string,
  serviceDate: string | null,
  timeSlot: string | null,
  depositCents: number,
  payUrl: string | null,
): { sms: string; subject: string; html: string } {
  const name = firstName?.trim() || "there";
  const when = [
    serviceDate ? formatServiceDate(serviceDate) : null,
    timeSlot ? formatTimeSlot(timeSlot) : null,
  ].filter(Boolean).join(" · ");
  const money = `$${(Math.max(0, depositCents) / 100).toFixed(2)}`;
  const payLine = payUrl ? ` Pay here: ${payUrl}` : " Check your email for the invoice.";
  const deadline =
    type === "next_day_2h"
      ? " This is the final reminder — the booking will be cancelled shortly if the deposit is not received."
      : " If we don't receive it by 2 hours tomorrow, the booking will be cancelled.";

  const headlines: Record<ReminderType, string> = {
    "30m": "Reminder — your Novara deposit is still unpaid",
    "2h": "Still pending — pay your Novara deposit to hold the date",
    next_day_2h: "Final reminder — pay your deposit or this booking will be cancelled",
  };

  const sms =
    `Novara Cleaning: Hi ${name}, your cleaning${when ? ` (${when})` : ""} is still pending.` +
    ` Please pay the ${money} deposit to confirm.${payLine}${deadline}` +
    ` Questions? Call ${SUPPORT_PHONE_DISPLAY}.`;

  const cta = payUrl
    ? `<p style="margin:20px 0"><a href="${payUrl}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">Pay deposit ${money}</a></p>
       <p style="margin:0 0 12px;font-size:13px;color:#64748b">Or open this link: <a href="${payUrl}">${payUrl}</a></p>`
    : `<p style="margin:16px 0 0">Check your inbox for the Stripe invoice and pay the deposit there.</p>`;

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.55;max-width:560px">
      <p style="margin:0 0 12px">Hi ${name},</p>
      <p style="margin:0 0 12px">Your Novara cleaning${when ? ` on <strong>${when}</strong>` : ""} is still <strong>pending until we receive your ${money} deposit</strong>.</p>
      <p style="margin:0 0 12px">${
        type === "next_day_2h"
          ? "This is the last reminder. If the deposit is not paid shortly, we will cancel the booking so the date can be released."
          : "Please pay today to confirm the appointment. If the deposit is not received by 2 hours tomorrow, the booking will be cancelled automatically."
      }</p>
      ${cta}
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Questions? Call ${SUPPORT_PHONE_DISPLAY} · Novara Cleaning</p>
    </div>`;

  return { sms, subject: headlines[type], html };
}

async function sendDepositEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");
  if (!resendKey || !to) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: [to],
      subject,
      html,
    }),
  });
  return res.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const now = new Date();
  const lookback = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: rows, error: fetchError } = await supabase
    .from("bookings")
    .select(
      "id, created_at, pending_deposit_started_at, first_name, last_name, email, phone, service_date, time_slot, deposit_cents, hosted_invoice_url, stripe_invoice_id, payment_received_at, uses_credit, is_reclean, status, booking_number",
    )
    .eq("status", "pending_payment")
    .gt("created_at", lookback.toISOString())
    .order("created_at", { ascending: true })
    .limit(300);

  if (fetchError) return json({ error: fetchError.message }, 500);

  const candidates = (rows || []).filter((r: Record<string, unknown>) => isAwaitingDeposit(r));

  let remindersSent = 0;
  let cancelled = 0;
  let skipped = 0;
  const errors: Array<Record<string, unknown>> = [];

  for (const booking of candidates) {
    const ageHours = (now.getTime() - anchorAt(booking).getTime()) / 36e5;
    const payUrl = booking.hosted_invoice_url || null;

    if (ageHours >= 28) {
      const { error: claimError } = await supabase.from("booking_emails_sent").insert({
        booking_id: booking.id,
        kind: KINDS.auto_cancel,
        recipient_email: booking.email,
      });
      if (claimError) {
        skipped++;
        continue;
      }
      try {
        await voidOpenInvoice(supabase, booking.stripe_invoice_id);
        const { data, error } = await supabase.functions.invoke("cancel-booking", {
          body: {
            bookingId: booking.id,
            cancelReason: AUTO_CANCEL_REASON,
            refundType: "none",
            source: "pending_deposit_auto_cancel",
            autoCancelledReason: "unpaid_deposit",
          },
        });
        if (error || data?.error) {
          throw new Error(data?.error || (error instanceof Error ? error.message : "cancel failed"));
        }
        cancelled++;
      } catch (err) {
        await supabase
          .from("booking_emails_sent")
          .delete()
          .eq("booking_id", booking.id)
          .eq("kind", KINDS.auto_cancel);
        errors.push({
          bookingId: booking.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    const reminderType = pickReminderType(ageHours);
    if (!reminderType) {
      skipped++;
      continue;
    }

    const kind = KINDS[reminderType];
    const { error: claimError } = await supabase.from("booking_emails_sent").insert({
      booking_id: booking.id,
      kind,
      recipient_email: booking.email,
    });
    if (claimError) {
      skipped++;
      continue;
    }

    try {
      const { sms, subject, html } = copyFor(
        reminderType,
        booking.first_name || "",
        booking.service_date,
        booking.time_slot,
        Number(booking.deposit_cents || 0),
        payUrl,
      );
      if (booking.email) {
        const emailed = await sendDepositEmail(supabase, booking.email, subject, html);
        if (!emailed) console.warn("[pending-deposit-reminders] email failed", booking.id);
      }
      if (booking.phone) {
        await sendSms(supabase, { toPhone: booking.phone, message: sms, type: "reminder" });
      }
      remindersSent++;
    } catch (err) {
      await supabase.from("booking_emails_sent").delete().eq("booking_id", booking.id).eq("kind", kind);
      errors.push({
        bookingId: booking.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json({
    success: true,
    candidates: candidates.length,
    reminders_sent: remindersSent,
    auto_cancelled: cancelled,
    skipped,
    errors: errors.length ? errors : undefined,
  });
});

async function voidOpenInvoice(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  invoiceId: string | null | undefined,
) {
  if (!invoiceId) return;
  const key = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
  if (!key) return;
  try {
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });
    const inv = await stripe.invoices.retrieve(invoiceId);
    if (inv.status === "open" || inv.status === "draft" || inv.status === "uncollectible") {
      if (inv.status === "draft") await stripe.invoices.del(invoiceId).catch(() => undefined);
      else await stripe.invoices.voidInvoice(invoiceId);
    }
  } catch (err) {
    console.warn(
      "[pending-deposit-reminders] invoice void failed (non-blocking)",
      err instanceof Error ? err.message : String(err),
    );
  }
}
