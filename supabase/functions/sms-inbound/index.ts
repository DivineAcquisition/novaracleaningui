// ─── Telnyx inbound SMS webhook ─────────────────────────────────────────
//
// Telnyx Messaging Profile webhook target. Body shape:
//   { data: { event_type: "message.received", payload: { from: { phone_number }, to: [{ phone_number }], text, id } } }
//
// Handles a tiny customer-self-service conversation:
//   R / RESCHEDULE  → reply with fee preview + Account portal link.
//                     Sets a `reschedule_pending` intent (informational —
//                     the customer still picks a new slot inside the
//                     portal).
//   C / CANCEL      → reply with fee preview + ask for YES confirmation.
//                     Sets `cancel_pending` intent (15 min TTL).
//   YES             → if an unexpired cancel_pending exists, invoke
//                     cancel-booking with source=sms_reply, reply with
//                     confirmation + refund line.
//   NO              → mark pending intent as declined, reply "Got it,
//                     your appointment is still on."
//   STOP            → reply "You have been opted out." and write
//                     `sms_notifications_enabled = false` on the
//                     matching customer / cleaner row.
//   HELP            → reply with the support number.
//
// Fee policy comes from `_shared/booking-policy.ts`. GHL + LeadConnector
// stay in sync because cancel-booking is the function that does the
// downstream work — we just orchestrate the SMS conversation here.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import {
  decideCancelFee,
  decideRescheduleFee,
  toE164,
  SUPPORT_PHONE_DISPLAY,
} from "../_shared/booking-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, telnyx-signature-ed25519, telnyx-timestamp",
};

const log = (step: string, details?: unknown) => {
  console.log(`[SMS-INBOUND] ${step}`, details === undefined ? "" : JSON.stringify(details));
};

// Account self-service portal — where the customer picks a new date /
// time. Keep this in env so a staging deploy can point at staging.
const ACCOUNT_PORTAL_URL =
  Deno.env.get("ACCOUNT_PORTAL_URL") || "https://try.novaracleaning.com/account";

// Acceptable variations of each verb. Comparing against the trimmed,
// uppercased customer text.
const TOKEN_RESCHEDULE = new Set(["R", "RESCHEDULE", "RESCHED", "MOVE"]);
const TOKEN_CANCEL = new Set(["C", "CANCEL", "CANC"]);
const TOKEN_YES = new Set(["YES", "Y", "CONFIRM"]);
const TOKEN_NO = new Set(["NO", "N", "KEEP", "NEVERMIND"]);
const TOKEN_HELP = new Set(["HELP", "INFO", "SUPPORT"]);
const TOKEN_STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCELSMS", "END", "QUIT"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // deno-lint-ignore no-explicit-any
  const data = (body as any)?.data ?? {};
  const eventType = data?.event_type as string | undefined;
  const payload = data?.payload ?? {};

  // Telnyx sends both `message.received` (inbound) and `message.sent` /
  // `message.finalized` (outbound delivery receipts) to the same URL.
  // We only act on inbound.
  if (eventType && eventType !== "message.received") {
    log("ignoring non-inbound event", { eventType });
    return new Response(JSON.stringify({ ignored: true, eventType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fromPhone = toE164(payload?.from?.phone_number);
  const toPhone = payload?.to?.[0]?.phone_number || null;
  const text = String(payload?.text || "").trim();
  const messageId = payload?.id || null;
  const upper = text.toUpperCase();

  log("inbound", { fromPhone, toPhone, textPreview: text.slice(0, 80) });

  // Always log the inbound message, even if we don't process it — for
  // dispute / compliance trails.
  const inboundLogId = await (async () => {
    try {
      const { data: row } = await supabase
        .from("sms_inbound_log")
        .insert({
          from_phone: fromPhone || payload?.from?.phone_number || "",
          to_phone: toPhone,
          message_text: text,
          provider_message_id: messageId,
          raw: body as unknown as Record<string, unknown>,
        })
        .select("id")
        .single();
      return row?.id as string | undefined;
    } catch (e) {
      log("inbound log insert failed", { error: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  })();

  const finalize = async (action: string, replyMessage: string | null, matchedBookingId?: string) => {
    if (inboundLogId) {
      try {
        await supabase
          .from("sms_inbound_log")
          .update({
            processed_action: action,
            reply_sent: replyMessage,
            matched_booking_id: matchedBookingId || null,
          })
          .eq("id", inboundLogId);
      } catch (e) {
        log("inbound log update failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (replyMessage && fromPhone) {
      await sendSms(supabase, {
        toPhone: fromPhone,
        message: replyMessage,
        type: "confirmation",
      });
    }
    return new Response(JSON.stringify({ ok: true, action }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  if (!fromPhone || !text) {
    return finalize("ignored_empty", null);
  }

  // ─── STOP / HELP — short-circuit before we touch booking state ──
  if (TOKEN_STOP.has(upper)) {
    // Forward to the existing handle-sms-optout function so cleaner /
    // customer opt-out flags stay in sync, but also reply directly so
    // the customer sees an ack regardless.
    try {
      await supabase.functions.invoke("handle-sms-optout", {
        body: { phone: fromPhone, message: text },
      });
    } catch (e) { log("optout invoke failed", { error: e instanceof Error ? e.message : String(e) }); }
    return finalize(
      "stop",
      `Novara Cleaning: You have been opted out of texts. Reply START to opt back in. Help? Call ${SUPPORT_PHONE_DISPLAY}.`,
    );
  }
  if (TOKEN_HELP.has(upper)) {
    return finalize(
      "help",
      `Novara Cleaning: Need help? Call us at ${SUPPORT_PHONE_DISPLAY}. Reply R to reschedule, C to cancel, STOP to opt out.`,
    );
  }

  // ─── Locate the customer's NEXT upcoming active booking ────────
  // Phones in `bookings.phone` are stored in mixed formats (some E.164,
  // some 10-digit, some legacy with formatting). Match against the last
  // 10 digits of the inbound number with ILIKE so all variants line up.
  const lastTen = fromPhone.replace(/\D/g, "").slice(-10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: bookingRow } = await supabase
    .from("bookings")
    .select("id, status, service_date, time_slot, uses_credit, first_name, phone, total_estimate_cents, deposit_cents, email")
    .ilike("phone", `%${lastTen}%`)
    .in("status", ["pending_payment", "confirmed", "assigned"])
    .gte("service_date", todayIso)
    .order("service_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const activeBooking = bookingRow || null;

  if (!activeBooking && (TOKEN_RESCHEDULE.has(upper) || TOKEN_CANCEL.has(upper) || TOKEN_YES.has(upper))) {
    return finalize(
      "no_active_booking",
      `Novara Cleaning: We couldn't find an upcoming appointment for this number. Call ${SUPPORT_PHONE_DISPLAY} and we'll sort it out.`,
    );
  }

  // ─── R / RESCHEDULE ────────────────────────────────────────────
  if (TOKEN_RESCHEDULE.has(upper) && activeBooking) {
    const fee = decideRescheduleFee({ serviceDate: activeBooking.service_date });
    try {
      await supabase.from("sms_intents").insert({
        phone: fromPhone,
        booking_id: activeBooking.id,
        intent: "reschedule_pending",
        fee_cents: fee.feeCents,
      });
    } catch (e) { log("intent insert failed", e); }

    const feeLine = fee.feeCents > 0
      ? `Heads up: $${(fee.feeCents / 100).toFixed(0)} short-notice fee applies (less than 24 hrs out). `
      : "";
    const reply =
      `Novara Cleaning: ${feeLine}Open ${ACCOUNT_PORTAL_URL} to pick a new date + time, ` +
      `or call ${SUPPORT_PHONE_DISPLAY}. Your current visit: ` +
      `${formatServiceDate(activeBooking.service_date)}${activeBooking.time_slot ? ` (${formatTimeSlot(activeBooking.time_slot)})` : ""}.`;
    return finalize("reschedule_prompt", reply, activeBooking.id);
  }

  // ─── C / CANCEL → ask for YES confirmation ─────────────────────
  if (TOKEN_CANCEL.has(upper) && activeBooking) {
    const fee = decideCancelFee({
      serviceDate: activeBooking.service_date,
      usesCredit: activeBooking.uses_credit,
    });
    try {
      await supabase.from("sms_intents").insert({
        phone: fromPhone,
        booking_id: activeBooking.id,
        intent: "cancel_pending",
        fee_cents: fee.feeCents,
      });
    } catch (e) { log("intent insert failed", e); }

    const reply =
      `Novara Cleaning: Cancel your visit on ${formatServiceDate(activeBooking.service_date)}` +
      `${activeBooking.time_slot ? ` (${formatTimeSlot(activeBooking.time_slot)})` : ""}? ` +
      `${fee.copy} Reply YES to confirm, NO to keep your appointment. Help? Call ${SUPPORT_PHONE_DISPLAY}.`;
    return finalize("cancel_prompt", reply, activeBooking.id);
  }

  // ─── YES — execute the pending intent ──────────────────────────
  if (TOKEN_YES.has(upper)) {
    const { data: intent } = await supabase
      .from("sms_intents")
      .select("id, intent, booking_id, fee_cents, expires_at")
      .eq("phone", fromPhone)
      .eq("status", "awaiting_confirmation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!intent) {
      return finalize(
        "yes_without_intent",
        `Novara Cleaning: We don't have a pending action for this number. Reply R to reschedule or C to cancel.`,
      );
    }
    if (intent.expires_at && new Date(intent.expires_at).getTime() < Date.now()) {
      await supabase.from("sms_intents").update({ status: "expired" }).eq("id", intent.id);
      return finalize(
        "yes_expired",
        `Novara Cleaning: That request expired. Reply R to reschedule or C to cancel to start over.`,
      );
    }

    if (intent.intent === "cancel_pending" && intent.booking_id) {
      // Hand off the actual cancellation to cancel-booking (handles
      // refund, credit restore, GHL opportunity update, LeadConnector
      // mirror, etc.) — source=sms_reply so the downstream sync knows
      // where it originated.
      try {
        const { data: cancelResult, error: cancelErr } = await supabase.functions.invoke("cancel-booking", {
          body: {
            bookingId: intent.booking_id,
            cancelReason: "Customer cancelled via SMS reply",
            refundType: "auto",
            source: "sms_reply",
          },
        });
        if (cancelErr) throw cancelErr;
        await supabase
          .from("sms_intents")
          .update({ status: "confirmed", responded_at: new Date().toISOString() })
          .eq("id", intent.id);

        const refundLine = cancelResult?.refundAmount && cancelResult.refundAmount !== "None"
          ? ` A refund of ${cancelResult.refundAmount} is on its way.`
          : "";
        const feeLine = intent.fee_cents > 0
          ? ` A $${(intent.fee_cents / 100).toFixed(0)} short-notice fee was applied.`
          : "";
        return finalize(
          "cancel_executed",
          `Novara Cleaning: Cancelled.${feeLine}${refundLine} We'd love to see you again — book anytime at ${ACCOUNT_PORTAL_URL.replace("/account", "/book/zip")}. Help? Call ${SUPPORT_PHONE_DISPLAY}.`,
          intent.booking_id,
        );
      } catch (e) {
        log("cancel invoke failed", { error: e instanceof Error ? e.message : String(e) });
        return finalize(
          "cancel_failed",
          `Novara Cleaning: We hit a snag cancelling that. Please call ${SUPPORT_PHONE_DISPLAY} and we'll handle it.`,
          intent.booking_id,
        );
      }
    }

    if (intent.intent === "reschedule_pending") {
      await supabase
        .from("sms_intents")
        .update({ status: "confirmed", responded_at: new Date().toISOString() })
        .eq("id", intent.id);
      return finalize(
        "reschedule_link_resend",
        `Novara Cleaning: Open ${ACCOUNT_PORTAL_URL} to pick your new date + time. Need a hand? Call ${SUPPORT_PHONE_DISPLAY}.`,
        intent.booking_id || undefined,
      );
    }

    return finalize("yes_unhandled", null);
  }

  // ─── NO ────────────────────────────────────────────────────────
  if (TOKEN_NO.has(upper)) {
    const { data: intent } = await supabase
      .from("sms_intents")
      .select("id, booking_id")
      .eq("phone", fromPhone)
      .eq("status", "awaiting_confirmation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (intent) {
      await supabase
        .from("sms_intents")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", intent.id);
    }
    return finalize(
      "declined",
      `Novara Cleaning: Got it — your appointment is still on. Reply R to reschedule or C to cancel later. Help? Call ${SUPPORT_PHONE_DISPLAY}.`,
      intent?.booking_id || undefined,
    );
  }

  // ─── Fallback — unrecognized keyword ───────────────────────────
  return finalize(
    "unrecognized",
    `Novara Cleaning: We didn't recognize that reply. Reply R to reschedule, C to cancel, or call ${SUPPORT_PHONE_DISPLAY}.`,
  );
});
