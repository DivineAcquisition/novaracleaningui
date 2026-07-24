// ─── send-post-booking-sms ───────────────────────────────────────────────
//
// Fires a single GHL-routed SMS AFTER the deposit (or credit) is collected.
// The message is intentionally narrow per product spec:
//
//   "Thanks for booking with Novara! Manage your account: <link>
//    Refer a friend and you both get $50: <ref-link>"
//
// Behavior:
//   * Requires payment_received_at OR uses_credit — never sends on a
//     VA "confirmed" booking that still has an unpaid deposit invoice /
//     pay-page link. Confirm-time callers (fanout / DB trigger) no-op
//     until the Stripe webhook stamps payment, then the webhook
//     re-invokes this function.
//   * Idempotent via bookings.post_confirm_ghl_sms_sent flag
//   * Always sent via send-ghl-sms (NOT Telnyx) so we ride GHL's
//     verified 10DLC number
//   * Pulls/creates a referral_code on customers if missing so the
//     refer URL is always meaningful
//   * Soft-fails: never throws, returns {ok:true|false, ...}
//
// Invoked by:
//   * stripe-webhook payment_intent.succeeded / invoice.payment_succeeded
//     (primary — deposit just cleared)
//   * bookings_auto_send_post_booking_sms DB trigger + finalize-booking
//     fanout (belt-and-suspenders; skips until paid)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACCOUNT_URL = "https://app.novaracleaning.com/account";
const REFER_URL_BASE = "https://try.novaracleaning.com/book/zip?ref=";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

async function safeInvoke(supabase: any, name: string, body: unknown) {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) return { ok: false, error: String(error.message || error) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (raw.startsWith("+")) return raw.replace(/[^0-9+]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function buildMessage(firstName: string | null, accountUrl: string, referUrl: string): string {
  const greeting = firstName ? `Hi ${firstName}! ` : "";
  return `${greeting}Thanks for booking with Novara Cleaning ✨\n\nManage your booking, billing & membership: ${accountUrl}\n\n💜 Share the clean: copy & paste your personal referral link and send it to a friend — you BOTH get $50 off:\n${referUrl}\n\nReply STOP to opt out.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const bookingId = String(body?.bookingId || "");
  if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);

  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select(
      "id, customer_id, first_name, last_name, phone, email, status, post_confirm_ghl_sms_sent, booking_number, payment_received_at, uses_credit",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (bErr || !booking) {
    console.warn("[send-post-booking-sms] booking not found", bookingId, bErr?.message);
    return json({ ok: false, error: "booking not found" }, 404);
  }

  if (booking.post_confirm_ghl_sms_sent) {
    return json({ ok: true, skipped: "already_sent" });
  }
  if (booking.status === "cancelled") {
    return json({ ok: true, skipped: "booking_cancelled" });
  }
  // Deposit (or membership credit) must have cleared. VA bookings often
  // sit at status=confirmed with a pending deposit invoice — those must
  // wait for Stripe to stamp payment_received_at before this fires.
  const paid = Boolean(booking.payment_received_at) || booking.uses_credit === true;
  if (!paid) {
    return json({ ok: true, skipped: "awaiting_deposit" });
  }

  const phone = normalizeE164(booking.phone);
  if (!phone) {
    return json({ ok: true, skipped: "no_phone" });
  }

  // Resolve the customer row + referral code. `booking.customer_id` may
  // hold either a Supabase customers.id UUID (set by create-payment-
  // intent + book-as-va initial insert) OR a Stripe `cus_…` id (set by
  // book-as-va after the Stripe customer is created). To stay
  // robust against either, resolve by EMAIL first, then fall back to
  // the UUID path. This fixes the VA-flow bug where the referral SMS
  // sent a generic homepage link because the cus_… lookup returned
  // nothing.
  let referralCode: string | null = null;
  let customerUuid: string | null = null;
  if (booking.email) {
    const { data: byEmail } = await supabase
      .from("customers")
      .select("id, referral_code")
      .eq("email", String(booking.email).toLowerCase())
      .maybeSingle();
    if (byEmail) {
      customerUuid = byEmail.id as string;
      referralCode = byEmail.referral_code || null;
    }
  }
  if (!customerUuid && booking.customer_id && !String(booking.customer_id).startsWith("cus_")) {
    const { data: byId } = await supabase
      .from("customers")
      .select("id, referral_code")
      .eq("id", booking.customer_id)
      .maybeSingle();
    if (byId) {
      customerUuid = byId.id as string;
      referralCode = byId.referral_code || null;
    }
  }
  if (!referralCode && customerUuid && booking.email) {
    const gen = await safeInvoke(supabase, "generate-referral-code", {
      customerId: customerUuid,
      email: booking.email,
    });
    if (gen.ok) {
      const { data: refreshed } = await supabase
        .from("customers")
        .select("referral_code")
        .eq("id", customerUuid)
        .maybeSingle();
      referralCode = refreshed?.referral_code || null;
    }
  }

  const referUrl = referralCode ? `${REFER_URL_BASE}${encodeURIComponent(referralCode)}` : "https://try.novaracleaning.com";
  const message = buildMessage(booking.first_name, ACCOUNT_URL, referUrl);

  const smsResult = await safeInvoke(supabase, "send-ghl-sms", {
    phone, email: booking.email || undefined,
    firstName: booking.first_name || undefined,
    lastName: booking.last_name || undefined,
    message, type: "post_booking_confirmation",
  });

  if (!smsResult.ok) {
    console.error("[send-post-booking-sms] send-ghl-sms failed", bookingId, smsResult.error);
    return json({ ok: false, error: smsResult.error });
  }

  await supabase
    .from("bookings")
    .update({ post_confirm_ghl_sms_sent: true, post_confirm_ghl_sms_sent_at: new Date().toISOString() })
    .eq("id", bookingId);

  await supabase.from("events").insert({
    event_type: "sms.post_booking", booking_id: bookingId,
    source: "send-post-booking-sms",
    summary: `Post-booking SMS sent to ${booking.first_name || "customer"} (${phone})`,
    data: { phone, referral_code: referralCode, message_length: message.length },
  }).then(() => undefined).catch(() => undefined);

  return json({ ok: true, sent: true, phone, referralCode });
});
