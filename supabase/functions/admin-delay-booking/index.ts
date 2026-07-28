// ─── admin-delay-booking ─────────────────────────────────────────────────────
//
// Admin/VA endpoint: push a booking's arrival window forward on the SAME day
// by 1h / 2h / 3h, with a single-select reason and optional service-recovery
// compensation (discount on the total OR a wallet credit).
//
// Why a dedicated endpoint instead of reusing reschedule-booking:
//   • Reschedule swaps the date + slot, adjusts availability_slots, potentially
//     charges a short-notice fee, and fires the "your appointment has moved"
//     comms. A same-day traffic/overrun delay is a smaller, gentler event —
//     mixing the two overloaded the reschedule trigger (crew-change SMS) and
//     the customer email tone.
//   • Delays cascade to jobs.start_datetime (dispatch clock). Reschedule
//     doesn't touch jobs for time-only changes today, which is a known gap.
//
// POST body:
//   {
//     bookingId: uuid,
//     delayHours: 1 | 2 | 3,
//     reason: string,                    // required — single-select in the UI
//     compensation?: 'none' | 'discount' | 'credit',   // default 'none'
//     compensationAmountCents?: integer  // >0 when compensation != 'none'
//   }
//
// Auth: caller must have role admin or va.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { sendSms, formatServiceDate } from "../_shared/sms.ts";
import {
  bufferConflictBody,
  checkScheduleBuffer,
  recordBufferOverride,
} from "../_shared/schedule-buffer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

interface DelayRequest {
  bookingId: string;
  delayHours: number;
  reason: string;
  compensation?: "none" | "discount" | "credit";
  compensationAmountCents?: number;
  /** Force a push that leaves no buffer before the crew's next job, with a logged reason. */
  bufferOverrideReason?: string;
}

interface BookingRow {
  id: string;
  status: string | null;
  service_date: string | null;
  time_slot: string | null;
  arrival_window: string | null;
  pre_delay_time_slot: string | null;
  delay_minutes: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  total_estimate_cents: number | null;
  deposit_cents: number | null;
  full_payment_discount: number | null;
  final_charge_cents: number | null;
  cleaner_id: string | null;
  job_id: string | null;
  booking_number: number | null;
}

async function callerId(admin: SupabaseClient, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u, error } = await userClient.auth.getUser(jwt);
  if (error || !u?.user?.id) throw new Error("unauthorized");
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("forbidden");
  return u.user.id;
}

// ─── Time-slot math ──────────────────────────────────────────────────────────
//
// Slots the funnel writes are hourly labels like "9:00 AM - 10:00 AM". Some
// legacy paths still emit "8-12" / "morning" / "9-12". We normalize into a
// {start,end} in minutes, add the delay, and rebuild the label. On any parse
// failure the caller sees a clean error instead of a corrupt slot.

const AMPM = (h: number): string => {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh >= 12 ? "PM" : "AM";
  const display = hh % 12 === 0 ? 12 : hh % 12;
  return `${display}:00 ${suffix}`;
};

const NAMED: Record<string, { start: number; end: number }> = {
  morning: { start: 8, end: 12 },
  midday: { start: 12, end: 16 },
  afternoon: { start: 12, end: 16 },
  evening: { start: 16, end: 20 },
};

function parseSlotHours(slot: string): { startH: number; endH: number } | null {
  if (!slot) return null;
  const raw = slot.trim();
  if (NAMED[raw.toLowerCase()]) return { startH: NAMED[raw.toLowerCase()].start, endH: NAMED[raw.toLowerCase()].end };
  // "8-12" / "9-12"
  const canon = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (canon) return { startH: Number(canon[1]), endH: Number(canon[2]) };
  // "8:00 AM - 10:00 AM" or "8am-10am"
  const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  const toH = (h: string, mer: string | undefined) => {
    let n = parseInt(h, 10);
    if (Number.isNaN(n)) return null;
    if (mer) {
      const u = mer.toUpperCase();
      if (u === "PM" && n < 12) n += 12;
      if (u === "AM" && n === 12) n = 0;
    }
    return n;
  };
  const startH = toH(m[1], m[3]);
  let endH = toH(m[4], m[6]);
  if (startH == null || endH == null) return null;
  // "8-10 PM" style — if end has AM/PM but start doesn't, mirror onto start.
  if (m[6] && !m[3] && startH < endH - 12) return { startH: startH + 12, endH };
  return { startH, endH };
}

/** Rebuild the canonical funnel label after adding `hours` to start & end. */
function shiftSlotLabel(slot: string, hours: number): string | null {
  const parsed = parseSlotHours(slot);
  if (!parsed) return null;
  const startH = parsed.startH + hours;
  const endH = parsed.endH + hours;
  // Same-day only — if the shift pushes us past midnight we bail (caller
  // returns a clear error rather than silently rolling over to the next day).
  if (endH > 23) return null;
  return `${AMPM(startH)} - ${AMPM(endH)}`;
}

/** HH:MM:SS clock for the shifted start (used to update jobs.start_datetime). */
function shiftedStartClock(slot: string, hours: number): string | null {
  const parsed = parseSlotHours(slot);
  if (!parsed) return null;
  const h = parsed.startH + hours;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:00:00`;
}

// ─── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let uid: string;
  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing bearer" }, 401);
    uid = await callerId(admin, jwt);
  } catch (e) {
    return json({ error: (e as Error).message }, 403);
  }

  let body: DelayRequest;
  try {
    body = (await req.json()) as DelayRequest;
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!body?.bookingId) return json({ error: "bookingId required" }, 400);
  const hours = Number(body.delayHours);
  if (![1, 2, 3].includes(hours)) return json({ error: "delayHours must be 1, 2, or 3" }, 400);
  const reason = String(body.reason || "").trim();
  if (!reason) return json({ error: "reason required" }, 400);

  const compensation = (body.compensation || "none") as "none" | "discount" | "credit";
  if (!["none", "discount", "credit"].includes(compensation)) {
    return json({ error: "compensation must be none|discount|credit" }, 400);
  }
  const compCents =
    compensation === "none" ? 0 : Math.max(0, Math.round(Number(body.compensationAmountCents) || 0));
  if (compensation !== "none" && compCents <= 0) {
    return json({ error: "compensationAmountCents required for discount/credit" }, 400);
  }

  try {
    const { data: b, error: bErr } = await admin
      .from("bookings")
      .select(
        "id, status, service_date, time_slot, arrival_window, pre_delay_time_slot, delay_minutes, first_name, last_name, email, phone, total_estimate_cents, deposit_cents, full_payment_discount, final_charge_cents, cleaner_id, job_id, booking_number",
      )
      .eq("id", body.bookingId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    const booking = b as BookingRow | null;
    if (!booking) return json({ error: "booking not found" }, 404);
    if (booking.status === "cancelled" || booking.status === "completed") {
      return json({ error: `Cannot delay a ${booking.status} booking` }, 409);
    }
    const currentSlot = booking.time_slot || booking.arrival_window || "";
    if (!currentSlot) return json({ error: "booking has no time_slot to delay" }, 400);

    const newSlot = shiftSlotLabel(currentSlot, hours);
    if (!newSlot) {
      return json(
        {
          error: `Cannot push "${currentSlot}" by ${hours}h without crossing midnight. Reschedule to a new day instead.`,
        },
        400,
      );
    }
    const newStartClock = shiftedStartClock(currentSlot, hours);

    // Stamp the ORIGINAL slot only on the first delay so a second bump still
    // reads through to the true pre-delay window.
    const preDelay = booking.pre_delay_time_slot || currentSlot;
    const totalDelayMinutes = (Number(booking.delay_minutes) || 0) + hours * 60;

    // ─── Compensation ──────────────────────────────────────────────────────
    // We record what happened in the same booking row for the audit trail,
    // and — for credits — also insert into customer_credits so the wallet
    // stays the single source of truth for redeemable balance.
    let creditId: string | null = null;
    let discountApplied = 0;
    let newTotalCents = booking.total_estimate_cents;

    if (compensation === "discount") {
      // Reduce the estimated total by the compensation amount; the wallet-
      // credit path is preferred for post-completion recovery, discount is
      // for pre-payment goodwill. Floor at $0.
      const before = Number(booking.total_estimate_cents || 0);
      newTotalCents = Math.max(0, before - compCents);
      discountApplied = before - newTotalCents;
    } else if (compensation === "credit") {
      // Resolve the customer by email — creates the customer row if missing
      // (mirrors admin-grant-credit so wallet grants always land somewhere).
      const emailLc = (booking.email || "").toLowerCase();
      if (!emailLc) return json({ error: "booking has no email to grant credit against" }, 400);
      let customerId: string | null = null;
      const { data: byEmail } = await admin
        .from("customers")
        .select("id")
        .ilike("email", emailLc)
        .limit(1);
      customerId = byEmail?.[0]?.id || null;
      if (!customerId) {
        const { data: created, error: cErr } = await admin
          .from("customers")
          .insert({
            email: emailLc,
            first_name: booking.first_name,
            last_name: booking.last_name,
            phone: booking.phone,
          })
          .select("id")
          .single();
        if (cErr) throw new Error(`Could not resolve customer: ${cErr.message}`);
        customerId = created!.id as string;
      }
      const { data: rpcRow, error: rpcErr } = await admin.rpc("grant_customer_credit", {
        _customer_id: customerId,
        _amount_cents: compCents,
        _source: "adjustment",
        _reason: `Delay compensation (${hours}h) — ${reason}`,
        _granted_by: uid,
        _expires_at: null,
        _referral_id: null,
        _booking_id: booking.id,
      });
      if (rpcErr) throw new Error(`grant_customer_credit failed: ${rpcErr.message}`);
      creditId = (rpcRow as { id?: string } | null)?.id || null;
    }

    // ─── Apply the delay + cascade to jobs.start_datetime ──────────────────
    const nowIso = new Date().toISOString();
    const bookingUpdate: Record<string, unknown> = {
      time_slot: newSlot,
      arrival_window: newSlot,
      delay_minutes: totalDelayMinutes,
      delay_reason: reason,
      delayed_at: nowIso,
      delayed_by_user_id: uid,
      pre_delay_time_slot: preDelay,
      delay_compensation_type: compensation === "none" ? "none" : compensation,
      delay_compensation_cents: (Number(booking.total_estimate_cents || 0) - (newTotalCents || 0)) +
        (compensation === "credit" ? compCents : 0),
      delay_credit_id: creditId,
      updated_at: nowIso,
    };
    if (compensation === "discount" && newTotalCents != null) {
      bookingUpdate.total_estimate_cents = newTotalCents;
    }

    // Pushing a window forward is the most direct way to eat the buffer in
    // front of the crew's next job, so it plays by the same rules as booking
    // one. Blocked with the projected-end explanation unless the admin says
    // why it has to happen anyway — and the delay we're about to cause
    // downstream is exactly what the at-risk board is for.
    const bufferCheck = await checkScheduleBuffer(admin, {
      bookingId: booking.id,
      timeSlot: newSlot,
    });
    if (!bufferCheck.ok) {
      const overrideReason = String(body?.bufferOverrideReason || "").trim();
      if (!overrideReason) return json(bufferConflictBody(bufferCheck), 409);
      const logged = await recordBufferOverride(admin, {
        bookingId: booking.id,
        cleanerIds: [booking.cleaner_id].filter(Boolean) as string[],
        check: bufferCheck,
        reason: `Delay push (${hours}h): ${overrideReason}`,
        actorId: uid,
        actorName: "Admin (delay)",
      });
      if (!logged.ok) return json({ error: logged.error }, 400);
    }

    const { error: upErr } = await admin.from("bookings").update(bookingUpdate).eq("id", booking.id);
    if (upErr) throw new Error(`Could not update booking: ${upErr.message}`);

    // Cascade to the dispatch clock so the cleaner's job start reflects the
    // delay (reschedule-booking doesn't touch this for same-day changes).
    if (booking.job_id && newStartClock && booking.service_date) {
      await admin
        .from("jobs")
        .update({
          start_datetime: `${booking.service_date}T${newStartClock}`,
          updated_at: nowIso,
        })
        .eq("id", booking.job_id);
    }

    // ─── Audit + Discord (via existing events → discord_routes) ────────────
    const totalHoursLabel = totalDelayMinutes === hours * 60
      ? `${hours}h`
      : `${(totalDelayMinutes / 60).toFixed(totalDelayMinutes % 60 === 0 ? 0 : 1)}h (cumulative)`;
    const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
    const compSummary =
      compensation === "discount"
        ? ` · ${dollars(discountApplied)} discount applied`
        : compensation === "credit"
          ? ` · ${dollars(compCents)} wallet credit issued`
          : "";
    const bookingLabel = booking.booking_number ? `NVC-${booking.booking_number}` : booking.id.slice(0, 8);

    await admin.from("events").insert({
      event_type: "booking.delayed",
      booking_id: booking.id,
      customer_id: null,
      source: "admin-delay-booking",
      summary: `${bookingLabel} delayed ${totalHoursLabel} → ${newSlot} — ${reason}${compSummary}`,
      data: {
        by: uid,
        delay_hours: hours,
        total_delay_minutes: totalDelayMinutes,
        reason,
        from_slot: currentSlot,
        to_slot: newSlot,
        pre_delay_slot: preDelay,
        service_date: booking.service_date,
        compensation,
        compensation_cents: compensation === "discount" ? discountApplied : compCents,
        credit_id: creditId,
      },
    });

    // ─── Notify customer + assigned cleaner ────────────────────────────────
    const first = booking.first_name || "there";
    const dateLabel = formatServiceDate(booking.service_date);
    let emailSent = false;
    let smsSent = false;
    let cleanerSmsSent = false;

    if (booking.email) {
      try {
        const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");
        const compBlock =
          compensation === "discount"
            ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px;margin:0 0 16px">
                 <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#166534">On us — service discount</div>
                 <div style="font-size:22px;font-weight:700;color:#166534;margin-top:2px">${dollars(discountApplied)} off</div>
                 <div style="font-size:12px;color:#166534;margin-top:2px">Applied to this cleaning.</div>
               </div>`
            : compensation === "credit"
              ? `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:14px;margin:0 0 16px">
                   <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6d28d9">On us — account credit</div>
                   <div style="font-size:22px;font-weight:700;color:#5b21b6;margin-top:2px">${dollars(compCents)} credit</div>
                   <div style="font-size:12px;color:#6d28d9;margin-top:2px">Auto-applies at checkout on your next booking.</div>
                 </div>`
              : "";

        const html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 8px;font-size:20px">Quick update on today's cleaning</h2>
            <p style="margin:0 0 16px;color:#475569">Hi ${first}, we need to push your Novara appointment back by ${hours} hour${hours === 1 ? "" : "s"}.</p>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px;margin:0 0 16px">
              <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#9a3412">New arrival window</div>
              <div style="font-size:20px;font-weight:700;color:#7c2d12;margin-top:2px">${dateLabel || "Today"} · ${newSlot}</div>
              <div style="font-size:12px;color:#9a3412;margin-top:4px">Previously ${preDelay}</div>
            </div>
            <p style="margin:0 0 16px;color:#475569;font-size:14px"><strong>What happened:</strong> ${reason}</p>
            ${compBlock}
            <p style="margin:0 0 16px;color:#475569;font-size:14px">Thanks for your patience — reply to this email or text us if the new time doesn't work.</p>
            <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
          </div>`;
        const { error: emailErr } = await resend.emails.send({
          from: "Novara Cleaning <hello@novaracleaning.com>",
          to: [booking.email],
          subject: `Your Novara appointment moved to ${newSlot}`,
          html,
        });
        emailSent = !emailErr;
      } catch (err) {
        console.warn("[admin-delay-booking] email send failed:", (err as Error).message);
      }
    }

    if (booking.phone) {
      const compTail =
        compensation === "discount"
          ? ` We've taken ${dollars(discountApplied)} off this cleaning for the trouble.`
          : compensation === "credit"
            ? ` We've added ${dollars(compCents)} in Novara credit to your account for the trouble.`
            : "";
      const smsBody =
        `Novara Cleaning: Hi ${first}, we're running a bit behind — your cleaning is now ${newSlot}${dateLabel ? ` on ${dateLabel}` : ""}. ` +
        `Reason: ${reason}.${compTail} Reply STOP to opt out.`;
      smsSent = await sendSms(admin as unknown as { functions: { invoke: (name: string, opts: unknown) => Promise<unknown> } }, {
        toPhone: booking.phone,
        message: smsBody,
        type: "confirmation",
      });
    }

    // Give the assigned cleaner a heads-up so they don't arrive at the old time.
    if (booking.cleaner_id) {
      const { data: cleaner } = await admin
        .from("cleaners")
        .select("phone, first_name")
        .eq("id", booking.cleaner_id)
        .maybeSingle();
      const cleanerPhone = (cleaner as { phone?: string | null } | null)?.phone;
      if (cleanerPhone) {
        const cleanerFirst = (cleaner as { first_name?: string | null } | null)?.first_name || "team";
        const crewMsg =
          `Novara dispatch: ${bookingLabel} arrival window pushed to ${newSlot}` +
          `${dateLabel ? ` (${dateLabel})` : ""}. Reason: ${reason}.` +
          ` Customer already notified. Reply STOP to opt out.`;
        cleanerSmsSent = await sendSms(
          admin as unknown as { functions: { invoke: (name: string, opts: unknown) => Promise<unknown> } },
          { toPhone: cleanerPhone, message: crewMsg, type: "confirmation" },
        );
        void cleanerFirst; // reserved for a future personalization pass
      }
    }

    return json({
      ok: true,
      bookingId: booking.id,
      newSlot,
      fromSlot: currentSlot,
      preDelaySlot: preDelay,
      totalDelayMinutes,
      compensation,
      compensationCents: compensation === "discount" ? discountApplied : compCents,
      creditId,
      newTotalCents,
      emailSent,
      smsSent,
      cleanerSmsSent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin-delay-booking]", message);
    return json({ error: message }, 500);
  }
});
