// booking-confirm-comms
//
// Restores the customer-facing comms that get SKIPPED on the public funnel:
// the auto-finalize DB trigger pre-sets status='confirmed', so finalize-booking
// no-ops and never runs runPostConfirmFanout (no confirmation email / SMS /
// account SMS / dispatch). This self-contained function — fired by an
// AFTER-UPDATE trigger on the confirm transition — sends them idempotently.
//
// Body: { bookingId }. Idempotent via bookings.confirmation_email_sent.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  confirmationSmsBalanceTail,
  remainingDueAfterUpfrontCents,
} from "../_shared/booking-balance.ts";
import { publicChecklistUrl } from "../_shared/public-checklist-url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const log = (s: string, d?: unknown) =>
  console.log(`[BOOKING-COMMS] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function checklistLink(serviceType: string | null | undefined, scopeLevel?: string | null): string {
  return publicChecklistUrl(serviceType, scopeLevel);
}

/**
 * Mirror of upfrontPaymentSettled() in _shared/post-confirm-booking.ts —
 * duplicated because this function is deliberately self-contained.
 * Internal (VA) bookings stay pending_payment until deposit/full payment
 * clears; stripe-webhook promotes them and calls this function so
 * "Booking confirmed" email/SMS only go out after money lands.
 */
function paymentSettled(b: Record<string, unknown>): boolean {
  if (b.uses_credit === true) return true;
  if (b.payment_received_at) return true;
  return Number(b.total_estimate_cents || 0) <= 0;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try { return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  catch { return String(d); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { bookingId } = await req.json();
    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const { data: b } = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (!b) return json({ error: "Booking not found" }, 404);
    if (b.status !== "confirmed" && b.status !== "completed") return json({ ok: true, skipped: `status=${b.status}` });
    if (b.confirmation_email_sent) return json({ ok: true, alreadySent: true });

    const totalCents = Number(b.total_estimate_cents || 0);
    const finalCents = Number(b.final_charge_cents || 0);
    const depositCents = Number(b.deposit_cents || 0);
    const fullDiscount = Number(b.full_payment_discount || 0);
    // Never treat preauth/deposit as "paid in full" — use real remaining.
    const balanceAfterDeposit = remainingDueAfterUpfrontCents(b);
    const cl = checklistLink(b.service_type, b.scope_level);

    const callEmail = (type: string, data: Record<string, unknown>) =>
      fetch(`${url}/functions/v1/send-booking-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` },
        body: JSON.stringify({ type, email: b.email, data }),
      }).catch((e) => log(`${type} email failed`, e instanceof Error ? e.message : String(e)));

    const settled = paymentSettled(b);
    if (!settled) {
      log("upfront payment outstanding — holding customer comms", { bookingId: b.id });
    }

    // 1. Confirmation email.
    if (settled) {
      await callEmail("confirmation", {
        firstName: b.first_name, lastName: b.last_name, bookingId: b.id,
        bookingNumber: b.booking_number ? `NVC-${String(b.booking_number).padStart(4, "0")}` : undefined,
        serviceDate: b.service_date, timeSlot: b.time_slot, arrivalWindow: b.arrival_window || b.time_slot,
        serviceType: b.service_type, homeSize: b.home_size_id, bedrooms: b.bedrooms, bathrooms: b.bathrooms,
        sqft: b.sqft, address: b.address, city: b.city, state: b.state, zipCode: b.zip_code,
        totalAmount: totalCents, depositAmount: depositCents, balanceAmount: balanceAfterDeposit,
        paymentOption: b.payment_option, paymentMethod: b.payment_method, useCredit: b.uses_credit,
        addOns: b.add_ons, frequency: b.frequency, checklistLink: cl,
        // Pay CTA only while something is still owed — see post-confirm-booking.ts.
        hostedInvoiceUrl: b.payment_received_at ? undefined : b.hosted_invoice_url,
      });
    }

    // 2. Payment receipt (only if money changed hands — deposit_cents is
    // what we intend to collect, not what was collected).
    const wasPaid = Boolean(b.payment_received_at) || finalCents > 0;
    if (settled && wasPaid) {
      await callEmail("payment_receipt", {
        firstName: b.first_name, lastName: b.last_name, bookingId: b.id,
        serviceDate: b.service_date, timeSlot: b.time_slot, serviceType: b.service_type,
        totalAmount: b.payment_option === "full" ? Math.max(0, totalCents - fullDiscount) : depositCents,
        balanceAmount: balanceAfterDeposit,
        paymentOption: b.payment_option, checklistLink: cl,
      });
    }

    // 3. Customer confirmation SMS (GHL primary, Telnyx fallback).
    // "Paid in full" only when remainingDueAfterUpfrontCents is 0 — preauth
    // deposits must say Remaining $X, not paid in full.
    if (settled && b.phone) {
      const tail = confirmationSmsBalanceTail(b, "hyphen");
      const msg = `Novara Cleaning: Booking confirmed for ${fmtDate(b.service_date)}${b.time_slot ? ` (${b.time_slot})` : ""}.${tail}`;
      const smsOk = await fetch(`${url}/functions/v1/send-ghl-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` },
        body: JSON.stringify({ phone: b.phone, email: b.email, message: msg, type: "confirmation" }),
      }).then((r) => r.ok).catch(() => false);
      if (!smsOk) {
        await fetch(`${url}/functions/v1/send-sms-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` },
          body: JSON.stringify({ to: b.phone, message: msg }),
        }).catch((e) => log("telnyx sms failed", e instanceof Error ? e.message : String(e)));
      }
    }

    // 4. Account-link SMS + dispatch (each idempotent on their own).
    const invoke = (fn: string, body: Record<string, unknown>) =>
      fetch(`${url}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` },
        body: JSON.stringify(body),
      }).catch((e) => log(`${fn} failed`, e instanceof Error ? e.message : String(e)));
    await invoke("send-post-booking-sms", { bookingId: b.id });
    await invoke("auto-dispatch-booking", { bookingId: b.id });

    // Mark sent (idempotency latch). Only latch when the comms actually
    // went out, so a still-unpaid booking gets them when the deposit lands.
    if (settled) {
      await supabase.from("bookings").update({
        confirmation_email_sent: true,
        confirmation_email_sent_at: new Date().toISOString(),
      }).eq("id", b.id);
    }

    return json({ ok: true, sent: settled, heldForPayment: !settled });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
