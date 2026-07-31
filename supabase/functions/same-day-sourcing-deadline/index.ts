// ─── same-day-sourcing-deadline ───────────────────────────────────────────
//
// Cron / manual sweeper: any same-day booking past its sourcing deadline
// with no accepted cleaner assignment is auto-cancelled and fully refunded
// (whatever was charged at booking — deposit or focused pay-in-full,
// including the same-day upcharge). Failed refunds escalate as urgent.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await supabase
      .from("bookings")
      .select("id, email, first_name, phone, booking_number, payment_intent_id, deposit_cents, total_estimate_cents, same_day_upcharge_cents, status, job_id")
      .eq("is_same_day", true)
      .is("same_day_auto_refund_status", null)
      .lte("same_day_sourcing_deadline_at", nowIso)
      .in("status", ["confirmed", "pending_assignment", "assigned", "pending_payment"]);

    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];

    for (const booking of due || []) {
      // Skip if a cleaner is already assigned (accepted / active).
      let hasAssignee = false;
      if (booking.job_id) {
        const { data: assigns } = await supabase
          .from("job_assignments")
          .select("id, status")
          .eq("job_id", booking.job_id)
          .in("status", ["accepted", "assigned", "in_progress", "completed"]);
        hasAssignee = (assigns || []).length > 0;
      }
      if (!hasAssignee) {
        const { data: bookingAssigns } = await supabase
          .from("job_assignments")
          .select("id, status")
          .eq("booking_id", booking.id)
          .in("status", ["accepted", "assigned", "in_progress", "completed"]);
        hasAssignee = (bookingAssigns || []).length > 0;
      }

      if (hasAssignee) {
        await supabase
          .from("bookings")
          .update({ same_day_auto_refund_status: "sourced" })
          .eq("id", booking.id);
        results.push({ bookingId: booking.id, outcome: "sourced" });
        continue;
      }

      // Mark in-progress so two cron ticks don't double-refund.
      await supabase
        .from("bookings")
        .update({ same_day_auto_refund_status: "processing" })
        .eq("id", booking.id);

      let refundOk = false;
      let refundError: string | null = null;
      try {
        const { data: refundData, error: refundErr } = await supabase.functions.invoke("admin-refund-booking", {
          body: {
            bookingId: booking.id,
            reason: "same_day_unfulfilled_auto_refund",
            markCancelled: true,
          },
        });
        if (refundErr) throw refundErr;
        if ((refundData as { error?: string })?.error) {
          throw new Error((refundData as { error: string }).error);
        }
        refundOk = true;
      } catch (e) {
        refundError = e instanceof Error ? e.message : String(e);
      }

      if (refundOk) {
        await supabase
          .from("bookings")
          .update({
            same_day_auto_refund_status: "refunded",
            same_day_auto_refund_at: nowIso,
            same_day_auto_refund_error: null,
            status: "cancelled",
          })
          .eq("id", booking.id);

        // Customer notification — best effort.
        try {
          const first = booking.first_name || "there";
          const amount = ((booking.deposit_cents || booking.total_estimate_cents || 0) / 100).toFixed(2);
          if (booking.email) {
            await supabase.functions.invoke("admin-send-email", {
              body: {
                to: booking.email,
                subject: "We couldn't staff your same-day clean — full refund processing",
                html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
                  <h2 style="margin:0 0 8px;font-size:20px">We're sorry, ${first}</h2>
                  <p style="color:#475569">We weren't able to assign a cleaner for your same-day booking today. Your booking has been canceled and a <strong>full refund of $${amount}</strong> (including the same-day fee) is processing automatically. Nothing is required from you.</p>
                  <p style="color:#475569">Want to rebook a regular (non-same-day) slot? <a href="https://try.novaracleaning.com/book/zip">Book here</a>.</p>
                  <p style="color:#94a3b8;font-size:12px">Novara Cleaning</p>
                </div>`,
              },
            });
          }
          if (booking.phone) {
            await supabase.functions.invoke("send-ghl-sms", {
              body: {
                phone: booking.phone,
                email: booking.email || undefined,
                firstName: first,
                message: `Novara Cleaning: We're sorry ${first} — we couldn't staff your same-day clean. Your booking is canceled and a full refund of $${amount} (including the same-day fee) is processing. Rebook anytime: https://try.novaracleaning.com/book/zip`,
                type: "same_day_unfulfilled",
              },
            });
          }
        } catch (_) { /* best effort */ }

        await supabase.from("events").insert({
          event_type: "same_day.auto_refunded",
          booking_id: booking.id,
          customer_id: null,
          source: "same-day-sourcing-deadline",
          summary: `Same-day booking auto-cancelled + refunded (unassigned by deadline)`,
          data: { booking_id: booking.id, amount_cents: booking.deposit_cents },
        });

        results.push({ bookingId: booking.id, outcome: "refunded" });
      } else {
        await supabase
          .from("bookings")
          .update({
            same_day_auto_refund_status: "refund_failed",
            same_day_auto_refund_at: nowIso,
            same_day_auto_refund_error: refundError,
          })
          .eq("id", booking.id);

        await supabase.from("events").insert({
          event_type: "same_day.refund_failed",
          booking_id: booking.id,
          source: "same-day-sourcing-deadline",
          summary: `URGENT: Same-day auto-refund FAILED for booking ${booking.booking_number || booking.id}`,
          data: { booking_id: booking.id, error: refundError },
        });

        // Escalate to Discord / ops if the route exists.
        try {
          await supabase.functions.invoke("send-discord-alert", {
            body: {
              eventType: "same_day.refund_failed",
              title: "URGENT: Same-day refund failed",
              message: `Booking ${booking.booking_number || booking.id} — customer paid, no cleaner, refund failed: ${refundError}`,
              urgency: "urgent",
            },
          });
        } catch (_) { /* best effort */ }

        results.push({ bookingId: booking.id, outcome: "refund_failed", error: refundError });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[same-day-sourcing-deadline]", message);
    return json({ error: message }, 500);
  }
});
