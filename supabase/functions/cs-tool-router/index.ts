// Customer-service tool router for the Telnyx support assistant.
//
// The caller is identified by phone. A booking can be moved or cancelled
// only when that phone is on the booking and the caller has confirmed.
// Refunds and other changes are filed for a person. This router never
// forces a full or partial refund.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

function toE164(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function hoursUntil(serviceDate?: string | null): number {
  if (!serviceDate) return 9999;
  const t = Date.parse(`${serviceDate}T12:00:00`);
  if (Number.isNaN(t)) return 9999;
  return Math.round((t - Date.now()) / (1000 * 60 * 60));
}

function decideCancelFee(args: { serviceDate?: string | null; usesCredit?: boolean | null }) {
  const hrs = hoursUntil(args.serviceDate);
  if (args.usesCredit) return { feeCents: 0, copy: "Your membership credit will be restored. No cash fee applies." };
  if (hrs < 24 && hrs > 0) return { feeCents: 5000, copy: "Cancelling within 24 hours of the visit keeps a $50 short-notice fee. The rest of the deposit is refunded." };
  return { feeCents: 0, copy: "More than 24 hours out, the residential visit is fully refunded. Refunds take 5 to 10 business days." };
}

function decideRescheduleFee(args: { serviceDate?: string | null }) {
  const hrs = hoursUntil(args.serviceDate);
  if (hrs < 24 && hrs > 0) return { feeCents: 2500, copy: "Moving the visit within 24 hours adds a $25 short-notice fee." };
  return { feeCents: 0, copy: "More than 24 hours out, there is no fee to move the visit." };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACCOUNT_URL = "https://app.novaracleaning.com/account";
const ACTIVE = ["pending_payment", "confirmed", "assigned"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function last10(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function dollars(cents: number | null | undefined) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function publicBooking(row: any) {
  const total = row.final_charge_cents || row.total_estimate_cents || 0;
  return {
    booking_id: row.id,
    booking_number: row.booking_number,
    status: row.status,
    service_type: row.service_type,
    service_date: row.service_date,
    time_slot: row.time_slot,
    address: row.address,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
    total_cents: total,
    deposit_cents: row.deposit_cents || 0,
    paid: Boolean(row.payment_received_at),
    payment_link: row.hosted_invoice_url || null,
    say: `Booking ${row.booking_number || ""} is ${row.status} on ${row.service_date || "an unscheduled day"} at ${row.time_slot || "a time still to be set"}. The total on file is ${dollars(total)}.`,
  };
}

async function bookingsForPhone(supabase: any, phone: string) {
  const ten = last10(toE164(phone));
  if (ten.length < 10) return [];
  const { data } = await supabase
    .from("bookings")
    .select("id, booking_number, status, service_type, service_date, time_slot, address, city, state, zip_code, first_name, phone, total_estimate_cents, final_charge_cents, deposit_cents, payment_received_at, hosted_invoice_url, uses_credit")
    .ilike("phone", `%${ten}%`)
    .order("service_date", { ascending: false })
    .limit(8);
  return (data || []).filter((row: any) => last10(String(row.phone || "")) === ten);
}

async function ownedBooking(supabase: any, phone: string, bookingId?: string) {
  const rows = await bookingsForPhone(supabase, phone);
  if (!rows.length) return { error: "no_booking_for_phone" as const, rows };
  if (bookingId) {
    const match = rows.find((row: any) => row.id === bookingId);
    if (!match) return { error: "booking_not_on_this_phone" as const, rows };
    return { booking: match, rows };
  }
  const upcoming = rows.find((row: any) => ACTIVE.includes(row.status));
  if (!upcoming) return { error: "no_active_booking" as const, rows };
  if (rows.filter((row: any) => ACTIVE.includes(row.status)).length > 1 && !bookingId) {
    return { error: "choose_booking" as const, rows };
  }
  return { booking: upcoming, rows };
}

async function fileRequest(supabase: any, phone: string, reason: string, summary: string, bookingId?: string | null) {
  const { data, error } = await supabase
    .from("ai_escalations")
    .insert({
      phone: toE164(phone),
      reason,
      summary: summary.slice(0, 1000),
      matched_booking_id: bookingId || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, ticket_id: null };
  return { ok: true, ticket_id: data.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const url = new URL(req.url);
  const tool = url.searchParams.get("tool") || body.tool;
  const phone = String(body.phone || "");

  try {
    if (tool === "list_customer_bookings") {
      const rows = await bookingsForPhone(supabase, phone);
      if (!last10(toE164(phone))) return json({ found: false, bookings: [], account_url: ACCOUNT_URL });
      return json({
        found: rows.length > 0,
        account_url: ACCOUNT_URL,
        bookings: rows.map(publicBooking),
      });
    }

    if (tool === "preview_change") {
      const owned = await ownedBooking(supabase, phone, body.booking_id);
      if (!owned.booking) return json({ ok: false, reason: owned.error, bookings: owned.rows.map(publicBooking) });
      const booking = owned.booking;
      if (!ACTIVE.includes(booking.status)) {
        return json({ ok: false, reason: "booking_not_changeable", status: booking.status });
      }
      const change = String(body.change || "");
      if (change === "cancel") {
        const fee = decideCancelFee({ serviceDate: booking.service_date, usesCredit: booking.uses_credit });
        return json({
          ok: true,
          change,
          booking: publicBooking(booking),
          fee_cents: fee.feeCents,
          say: fee.copy,
          executes: false,
        });
      }
      if (change === "reschedule") {
        const fee = decideRescheduleFee({ serviceDate: booking.service_date });
        return json({
          ok: true,
          change,
          booking: publicBooking(booking),
          fee_cents: fee.feeCents,
          say: fee.copy,
          executes: false,
        });
      }
      return json({ ok: false, reason: "change_must_be_cancel_or_reschedule" });
    }

    if (tool === "reschedule_booking") {
      if (body.confirmed !== true) {
        return json({ ok: false, reason: "confirmation_required", say: "Read the fee and the new time, then call this again only after they agree." });
      }
      const owned = await ownedBooking(supabase, phone, body.booking_id);
      if (!owned.booking) return json({ ok: false, reason: owned.error, bookings: owned.rows.map(publicBooking) });
      const booking = owned.booking;
      if (!ACTIVE.includes(booking.status)) return json({ ok: false, reason: "booking_not_changeable", status: booking.status });
      const newDate = String(body.new_date || "");
      const newTimeSlot = String(body.new_time_slot || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !newTimeSlot) {
        return json({ ok: false, reason: "need_date_and_slot" });
      }
      const { data, error } = await supabase.functions.invoke("reschedule-booking", {
        body: {
          bookingId: booking.id,
          newDate,
          newTimeSlot,
          oldDate: booking.service_date,
          oldTimeSlot: booking.time_slot,
          source: "sms_reply",
        },
      });
      if (error) return json({ ok: false, reason: "reschedule_failed" });
      return json({
        ok: data?.success !== false,
        say: data?.message || "The visit was rescheduled.",
        fee_cents: data?.rescheduleFeeCents ?? 0,
        service_date: newDate,
        time_slot: newTimeSlot,
      });
    }

    if (tool === "cancel_booking") {
      if (body.confirmed !== true) {
        return json({ ok: false, reason: "confirmation_required", say: "Read the cancellation fee first. Call this again only after they agree." });
      }
      const owned = await ownedBooking(supabase, phone, body.booking_id);
      if (!owned.booking) return json({ ok: false, reason: owned.error, bookings: owned.rows.map(publicBooking) });
      const booking = owned.booking;
      if (!ACTIVE.includes(booking.status)) return json({ ok: false, reason: "booking_not_changeable", status: booking.status });
      const { data, error } = await supabase.functions.invoke("cancel-booking", {
        body: {
          bookingId: booking.id,
          cancelReason: String(body.reason || "Customer cancelled with the support assistant").slice(0, 300),
          refundType: "auto",
          source: "phone",
        },
      });
      if (error) return json({ ok: false, reason: "cancel_failed" });
      return json({
        ok: data?.success !== false && !data?.error,
        say: data?.message || data?.error || "The visit was cancelled.",
        fee_cents: data?.cancelFeeCents ?? 0,
        refund_cents: data?.refundCents ?? 0,
        refund_amount: data?.refundAmount || null,
      });
    }

    if (tool === "submit_request") {
      const kind = String(body.kind || "other");
      const reason = kind === "refund" ? "refund"
        : kind === "damage" ? "quality_issue"
        : kind === "booking_change" ? "other"
        : "other";
      const owned = body.booking_id
        ? await ownedBooking(supabase, phone, body.booking_id)
        : { booking: null as any, rows: await bookingsForPhone(supabase, phone), error: undefined };
      if (body.booking_id && !owned.booking) {
        return json({ ok: false, reason: owned.error || "booking_not_on_this_phone" });
      }
      const summary = `${kind}: ${String(body.summary || "").trim()}`.slice(0, 1000);
      if (summary.length < 8) return json({ ok: false, reason: "summary_required" });
      const filed = await fileRequest(supabase, phone, reason, summary, owned.booking?.id || null);
      return json({
        ...filed,
        say: kind === "refund"
          ? "The refund request is with the team. A refund is not issued on this call."
          : "The request is with the team. The booking was not changed yet.",
      });
    }

    if (tool === "opt_out_calls") {
      const ten = last10(toE164(phone));
      if (ten.length < 10) return json({ ok: false, reason: "phone_required" });
      const { error } = await supabase
        .from("leads")
        .update({ do_not_call: true, last_call_outcome: "do_not_call" })
        .ilike("phone", `%${ten}%`);
      if (error) return json({ ok: false, reason: "opt_out_failed" });
      return json({ ok: true, say: "You will not get another sales call from this line." });
    }

    return json({ error: "unknown_tool" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
