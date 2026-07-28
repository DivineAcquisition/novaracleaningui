import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { RescheduleConfirmation } from '../_shared/email-templates/RescheduleConfirmation.tsx';
import { syncBookingLifecycle } from '../_shared/ghl-client.ts';
import { buildGhlCustomFields } from '../_shared/ghl-field-map.ts';
import { sendSms, formatServiceDate, formatTimeSlot } from '../_shared/sms.ts';
import { decideRescheduleFee, smsActionTail } from '../_shared/booking-policy.ts';
import { mirrorToLeadConnector } from '../_shared/leadconnector-mirror.ts';
import {
  bufferConflictBody,
  checkScheduleBuffer,
  recordBufferOverride,
} from '../_shared/schedule-buffer.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface RescheduleRequest {
  bookingId: string;
  newDate: string;
  newTimeSlot: string;
  oldDate: string;
  oldTimeSlot: string;
  /** Origin tag — "customer_portal" | "sms_reply" | "admin". */
  source?: string;
  /** Admin-only: force a move that lands inside the crew's buffer, with a logged reason. */
  bufferOverrideReason?: string;
}

function parseTimeSlot(slot: string): { start: string | null; end: string | null } {
  if (!slot) return { start: null, end: null };
  const m = slot.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return { start: null, end: null };
  const toClock = (h: string, mm: string | undefined, mer: string | undefined) => {
    let hour = parseInt(h, 10);
    if (mer) {
      const u = mer.toUpperCase();
      if (u === "PM" && hour < 12) hour += 12;
      if (u === "AM" && hour === 12) hour = 0;
    }
    return `${String(hour).padStart(2, "0")}:${(mm || "00").padStart(2, "0")}:00`;
  };
  return { start: toClock(m[1], m[2], m[3]), end: toClock(m[4], m[5], m[6]) };
}

async function ensureAdminOrVa(
  supabase: ReturnType<typeof createClient>,
  req: Request,
): Promise<void> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Admin authorization required");
  // Validate the JWT by passing it EXPLICITLY to getUser(token). Relying on
  // the no-arg getUser() (which reads a stored session) returns "Not signed
  // in" on a server-side client in supabase-js 2.39.x even when a valid
  // Authorization header is present — that was the admin-reschedule 500.
  const token = auth.replace(/^Bearer\s+/i, "");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: u } = await userClient.auth.getUser(token);
  if (!u?.user?.id) throw new Error("Not signed in");
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) =>
    ["admin", "va"].includes(r.role)
  );
  if (!allowed) throw new Error("Admins or VAs only");
}

async function adjustAvailabilitySlot(
  supabase: ReturnType<typeof createClient>,
  args: {
    date: string;
    slot: string;
    delta: number;
    adminOverride?: boolean;
  },
): Promise<void> {
  const { start, end } = parseTimeSlot(args.slot);
  if (!start || !end || args.delta === 0) return;

  const { data: existing } = await supabase
    .from("availability_slots")
    .select("id, current_bookings, max_capacity")
    .eq("service_date", args.date)
    .eq("start_time", start)
    .maybeSingle();

  if (existing) {
    const next = Math.max(0, (existing.current_bookings || 0) + args.delta);
    await supabase
      .from("availability_slots")
      .update({ current_bookings: next, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return;
  }

  if (args.delta > 0) {
    await supabase.from("availability_slots").upsert(
      {
        service_date: args.date,
        time_slot: args.slot,
        start_time: start,
        end_time: end,
        max_capacity: args.adminOverride ? 99 : 5,
        current_bookings: args.delta,
      },
      { onConflict: "service_date,start_time", ignoreDuplicates: false },
    );
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json() as RescheduleRequest;
    const { bookingId, newDate, newTimeSlot, oldDate, oldTimeSlot, source = 'customer_portal' } = body;
    const isAdmin = source === "admin";

    console.log('Reschedule request:', { bookingId, newDate, newTimeSlot, oldDate, oldTimeSlot, source });

    if (isAdmin) {
      await ensureAdminOrVa(supabase, req);
    }

    // 1. Get booking details
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      console.error('Error fetching booking:', bookingError);
      throw new Error('Booking not found');
    }

    // 2. Check availability for new slot (customer portal only — admin can override)
    if (!isAdmin) {
      const { start, end } = parseTimeSlot(newTimeSlot);
      if (start && end) {
        const { data: newSlot } = await supabase
          .from("availability_slots")
          .select("current_bookings, max_capacity, is_available")
          .eq("service_date", newDate)
          .eq("start_time", start)
          .maybeSingle();

        if (
          newSlot &&
          (newSlot.is_available === false ||
            (newSlot.current_bookings ?? 0) >= (newSlot.max_capacity ?? 0))
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Selected time slot is not available",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
          );
        }
      }
    }

    // 2b. Buffer check on the NEW slot. Moving a time is as capable of
    // creating a cascade as booking one, so it plays by the same rules. A
    // customer-initiated move that lands inside the crew's buffer keeps the
    // date but drops the crew, so dispatch re-staffs it deliberately instead
    // of the day quietly becoming impossible.
    const bufferCheck = await checkScheduleBuffer(supabase, {
      bookingId,
      serviceDate: newDate,
      timeSlot: newTimeSlot,
    });
    let unassignedForBuffer = false;
    if (!bufferCheck.ok) {
      const overrideReason = String(body.bufferOverrideReason || "").trim();
      if (isAdmin && !overrideReason) {
        return new Response(JSON.stringify(bufferConflictBody(bufferCheck, { success: false })), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        });
      }
      if (overrideReason) {
        await recordBufferOverride(supabase, {
          bookingId,
          cleanerIds: [booking.cleaner_id].filter(Boolean) as string[],
          check: bufferCheck,
          reason: overrideReason,
          actorName: 'Admin (reschedule)',
        });
      } else {
        unassignedForBuffer = true;
      }
    }

    // Decide reschedule fee BEFORE we mutate the row (so the fee is
    // calculated against the ORIGINAL service date, not the new one).
    const feeDecision = decideRescheduleFee({
      serviceDate: booking.service_date,
      waiveFee: isAdmin,
    });
    console.log('Reschedule fee decided:', feeDecision);

    // 3. Update booking with new date/time + audit columns
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        service_date: newDate,
        time_slot: newTimeSlot,
        rescheduled_at: new Date().toISOString(),
        rescheduled_from_date: oldDate,
        rescheduled_from_time_slot: oldTimeSlot,
        reschedule_fee_cents: (booking.reschedule_fee_cents || 0) + feeDecision.feeCents,
        reschedule_count: (booking.reschedule_count || 0) + 1,
        ...(unassignedForBuffer
          ? { cleaner_id: null, num_cleaners_assigned: 0, status: 'confirmed' }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateError) {
      console.error('Error updating booking:', updateError);
      throw updateError;
    }

    if (unassignedForBuffer) {
      // Withdraw the crew that can no longer make the new window, and put the
      // job back in front of dispatch rather than letting it look staffed.
      if (booking.job_id) {
        await supabase
          .from('job_assignments')
          .update({ status: 'Withdrawn' })
          .eq('job_id', booking.job_id)
          .in('status', ['Offered', 'Broadcast', 'Accepted', 'Confirmed', 'Assigned']);
      }
      await supabase.from('events').insert({
        event_type: 'dispatch.approval_needed',
        booking_id: bookingId,
        job_id: booking.job_id || null,
        source: 'reschedule-booking',
        summary:
          `🔁 Reschedule to ${newDate} ${newTimeSlot} left no buffer around the crew's other job, ` +
          `so the crew was withdrawn. Needs re-staffing.\n${bufferCheck.message || ''}`,
        data: { reason: 'buffer_conflict_on_reschedule', conflicts: bufferCheck.conflicts },
      }).then(() => undefined, () => undefined);
    }

    // 3b. Pre-authorized completion hold lifecycle.
    //
    // If a hold was already authorized for this booking, the auth has
    // a 7-day life. Reschedules can push the new service date past
    // that window, so:
    //   • if the new service date is INSIDE the existing auth window
    //     → leave it alone, it'll capture cleanly on completion day
    //   • if the new service date is OUTSIDE the window → void the
    //     existing PI and reset the hold columns so prepare-completion
    //     -hold places a fresh auth ~5 days before the new date
    if (
      booking.completion_hold_pi_id &&
      booking.completion_hold_status === 'authorized' &&
      booking.completion_hold_auth_expires_at
    ) {
      const newServiceTs = Date.parse(`${newDate}T12:00:00`);
      const expiresTs = Date.parse(booking.completion_hold_auth_expires_at);
      if (!isNaN(newServiceTs) && !isNaN(expiresTs) && newServiceTs > expiresTs) {
        try {
          const { default: Stripe } = await import('https://esm.sh/stripe@18.5.0');
          const { resolveSecret } = await import('../_shared/app-secrets.ts');
          const stripeKey = await resolveSecret(supabase, 'STRIPE_SECRET_KEY');
          const stripe = new Stripe(stripeKey, { apiVersion: '2025-08-27.basil' });
          const heldPi = await stripe.paymentIntents.retrieve(booking.completion_hold_pi_id);
          if (heldPi.status === 'requires_capture') {
            await stripe.paymentIntents.cancel(booking.completion_hold_pi_id);
            console.log('[reschedule-booking] voided stale hold', {
              piId: booking.completion_hold_pi_id,
            });
          }
          // Reset hold columns so the cron treats this row as eligible
          // for a fresh auth attempt on the new date.
          await supabase
            .from('bookings')
            .update({
              completion_hold_pi_id: null,
              completion_hold_amount_cents: null,
              completion_hold_status: null,
              completion_hold_attempts: 0,
              completion_hold_last_attempt_at: null,
              completion_hold_next_attempt_at: null,
              completion_hold_authorized_at: null,
              completion_hold_auth_expires_at: null,
              completion_hold_last_error: null,
              completion_hold_last_error_code: null,
            })
            .eq('id', bookingId);
          try {
            await supabase.from('completion_hold_log').insert({
              booking_id: bookingId,
              attempt: booking.completion_hold_attempts ?? 1,
              outcome: 'voided',
              payment_intent_id: booking.completion_hold_pi_id,
              notes: `voided on reschedule: new service date ${newDate} is past auth expiry ${booking.completion_hold_auth_expires_at}`,
            });
          } catch (_) { /* best effort */ }
        } catch (voidErr) {
          console.error('[reschedule-booking] hold void failed (non-critical):', voidErr);
        }
      }
    }

    // 4. Release old availability slot (availability_slots table)
    try {
      await adjustAvailabilitySlot(supabase, {
        date: oldDate,
        slot: oldTimeSlot,
        delta: -1,
        adminOverride: isAdmin,
      });
      console.log("Old availability_slots row released");
    } catch (e) {
      console.error("Release old slot failed (non-critical):", e);
    }

    // 5. Reserve new availability slot
    try {
      await adjustAvailabilitySlot(supabase, {
        date: newDate,
        slot: newTimeSlot,
        delta: 1,
        adminOverride: isAdmin,
      });
      console.log("New availability_slots row reserved");
    } catch (e) {
      console.error("Reserve new slot failed (non-critical):", e);
    }

    // 6. Send confirmation email
    try {
      const emailData = {
        firstName: booking.first_name,
        bookingId: bookingId,
        oldDate: oldDate,
        oldTimeSlot: oldTimeSlot,
        newDate: newDate,
        newTimeSlot: newTimeSlot,
        serviceType: booking.service_type,
        address: `${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
      };

      const html = await renderAsync(React.createElement(RescheduleConfirmation, emailData));

      await resend.emails.send({
        from: 'Novara Cleaning <hello@novaracleaning.com>',
        to: [booking.email],
        subject: 'Booking Rescheduled - Novara Cleaning',
        html,
      });

      console.log('Reschedule confirmation email sent');
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Don't fail the request if email fails
    }

    // Trigger Zapier webhook for rescheduled booking
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      console.log('Zapier webhook triggered for rescheduled booking');
    } catch (webhookError) {
      console.error('Zapier webhook failed (non-critical):', webhookError);
    }

    // Update Google Calendar event with new date/time
    try {
      await supabase.functions.invoke('update-google-calendar-event', {
        body: { bookingId, action: 'reschedule' }
      });
      console.log('Google Calendar event updated for rescheduled booking');
    } catch (calendarError) {
      console.error('Google Calendar update failed (non-critical):', calendarError);
    }

    // Patch the GHL appointment to the new date/time so the contact's
    // calendar in GHL is in lockstep with the booking row.
    try {
      await supabase.functions.invoke('book-ghl-appointment', {
        body: { bookingId }
      });
      console.log('GHL appointment patched for rescheduled booking');
    } catch (ghlApptErr) {
      console.error('GHL appointment patch failed (non-critical):', ghlApptErr);
    }

    // Send reschedule data to GHL webhook
    try {
      const fmtDate = (d: string) => {
        const [y, m, day] = d.split('-');
        return `${m}/${day}/${y}`;
      };

      const fmtTime = (slot: string) => {
        // Handle formats like "9-11am", "10-12", "8-10" etc.
        const clean = slot.replace(/[ap]m/gi, '').trim();
        const parts = clean.split('-');
        if (parts.length !== 2) return slot;
        const fmt = (h: string) => {
          const hr = parseInt(h, 10);
          if (isNaN(hr)) return h;
          const period = hr >= 12 ? 'PM' : 'AM';
          const display = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr;
          return `${display}:00 ${period}`;
        };
        return `${fmt(parts[0])} - ${fmt(parts[1])}`;
      };

      const ghlPayload = {
        "Event Type": "booking_rescheduled",
        "Booking ID": bookingId,
        "Customer Email": booking.email,
        "First Name": booking.first_name,
        "Last Name": booking.last_name,
        "Full Name": `${booking.first_name} ${booking.last_name}`,
        "Customer Phone": booking.phone,
        "Previous Date": fmtDate(oldDate),
        "Previous Time Slot": fmtTime(oldTimeSlot),
        "New Scheduled Date": fmtDate(newDate),
        "New Time Slot": fmtTime(newTimeSlot),
        "Service Type": booking.service_type,
        "Service Address": `${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
        "City": booking.city,
        "State": booking.state,
        "Zip Code": booking.zip_code,
        "Total Estimate": `$${(booking.total_estimate_cents / 100).toFixed(2)}`,
        "Home Size": booking.home_size_id,
        "Rescheduled At": new Date().toISOString(),
      };

      const ghlRescheduleWebhook = Deno.env.get("GHL_RESCHEDULE_WEBHOOK_URL") || 'https://services.leadconnectorhq.com/hooks/fJddieqJDUjUoYAGOvbk/webhook-trigger/f8326cbb-8ef8-4220-bd54-746e909bcb2f';
      const ghlRes = await fetch(
        ghlRescheduleWebhook,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ghlPayload),
        }
      );
      console.log('GHL reschedule webhook sent, status:', ghlRes.status);
    } catch (ghlError) {
      console.error('GHL webhook failed (non-critical):', ghlError);
    }

    // GHL: immediate contact + pipeline refresh with updated schedule
    // fields. send-zapier-webhook (below) runs the full 60+ field sync;
    // this pass ensures scheduling custom fields + dispatch stage move
    // without waiting on the heavier webhook handler.
    try {
      const updatedBooking = {
        ...booking,
        service_date: newDate,
        time_slot: newTimeSlot,
        reschedule_fee_cents: (booking.reschedule_fee_cents || 0) + feeDecision.feeCents,
        reschedule_count: (booking.reschedule_count || 0) + 1,
      };
      const ghlCustomFields = buildGhlCustomFields({
        booking: updatedBooking,
        cleaners: [],
        publicOrigin: "https://try.novaracleaning.com",
      });

      let jobStatus: string | null = null;
      const assignmentStatuses: string[] = [];
      if (booking.job_id) {
        const { data: jobRow } = await supabase
          .from("jobs")
          .select("status")
          .eq("id", booking.job_id)
          .maybeSingle();
        jobStatus = jobRow?.status ?? null;
        const { data: assigns } = await supabase
          .from("job_assignments")
          .select("status")
          .eq("job_id", booking.job_id);
        for (const a of assigns || []) {
          if (a?.status) assignmentStatuses.push(String(a.status));
        }
      }

      await syncBookingLifecycle({
        opportunityId: booking.ghl_opportunity_id || null,
        dispatchStage: {
          bookingStatus: booking.status,
          jobStatus,
          payoutStatus: booking.payout_status,
          cleanerId: booking.cleaner_id,
          assignmentStatuses,
          serviceDate: newDate,
        },
        contact: {
          email: booking.email,
          phone: booking.phone,
          firstName: booking.first_name,
          lastName: booking.last_name,
          address1: booking.address,
          city: booking.city,
          state: booking.state,
          postalCode: booking.zip_code,
          source: isAdmin ? "Novara Admin Reschedule" : "Novara Reschedule",
          tags: [
            "rescheduled",
            newDate ? `svc-${newDate}` : "",
            booking.zip_code ? `zip-${booking.zip_code}` : "",
            feeDecision.feeCents > 0 ? "short-notice-reschedule" : "",
            isAdmin ? "admin-rescheduled" : "",
          ].filter(Boolean) as string[],
          customFieldsByKey: ghlCustomFields,
        },
        opportunity: {
          name: `NVC-${String(booking.booking_number).padStart(4, "0")} — ${booking.first_name} ${booking.last_name}`,
          status: "open",
          monetaryValue: Math.round(
            ((booking.total_estimate_cents || 0) + feeDecision.feeCents) / 100,
          ),
          source: isAdmin ? "Novara Admin Reschedule" : "Novara Reschedule",
          customFieldsByKey: ghlCustomFields,
        },
      });
      console.log("[reschedule-booking] GHL contact + pipeline updated");
    } catch (ghlPitErr) {
      console.error("[reschedule-booking] GHL PIT sync failed (non-blocking):", ghlPitErr);
    }

    // LeadConnector inbound webhook mirror — backup so the GHL
    // workflow attached to the inbound URL always sees the new state.
    try {
      await mirrorToLeadConnector({
        event: 'booking.rescheduled',
        payload: {
          booking_id: bookingId,
          booking_number: booking.booking_number,
          first_name: booking.first_name,
          last_name: booking.last_name,
          email: booking.email,
          phone: booking.phone,
          old_date: oldDate,
          old_time_slot: oldTimeSlot,
          new_date: newDate,
          new_time_slot: newTimeSlot,
          reschedule_fee_cents: feeDecision.feeCents,
          reschedule_fee_basis: feeDecision.basis,
          hours_until_original: feeDecision.hoursUntilService,
          source,
        },
      });
    } catch (mirrorErr) {
      console.error('[reschedule-booking] LeadConnector mirror failed (non-critical):', mirrorErr);
    }

    // Customer SMS — confirm the new appointment time + fee disclosure.
    try {
      if (booking.phone) {
        const feeLine = feeDecision.feeCents > 0
          ? ` A $${(feeDecision.feeCents / 100).toFixed(0)} short-notice fee was added to your invoice.`
          : "";
        const opener = isAdmin
          ? "Novara Cleaning: Our team rescheduled your appointment to"
          : "Novara Cleaning: Your appointment has been rescheduled to";
        await sendSms(supabase, {
          toPhone: booking.phone,
          message:
            `${opener} ` +
            `${formatServiceDate(newDate)}` +
            (newTimeSlot ? ` (${formatTimeSlot(newTimeSlot)})` : "") +
            `.${feeLine} ${smsActionTail()}`,
          type: "confirmation",
        });
        console.log('[reschedule-booking] Customer reschedule SMS sent');
      }
    } catch (smsErr) {
      console.error('[reschedule-booking] Customer SMS failed (non-blocking):', smsErr);
    }

    // Notify the assigned cleaner about the new date/time if one exists.
    try {
      if (booking.cleaner_id) {
        const { data: cleaner } = await supabase
          .from('cleaners')
          .select('phone, first_name')
          .eq('id', booking.cleaner_id)
          .maybeSingle();
        if (cleaner?.phone) {
          await sendSms(supabase, {
            toPhone: cleaner.phone,
            message:
              `Novara Cleaning: Your assigned job has been rescheduled to ` +
              `${formatServiceDate(newDate)}` +
              (newTimeSlot ? ` (${formatTimeSlot(newTimeSlot)})` : "") +
              `. Check the Cleaner app for the updated schedule.`,
            type: "job_offer",
          });
          console.log('[reschedule-booking] Cleaner reschedule SMS sent');
        }
      }
    } catch (smsErr) {
      console.error('[reschedule-booking] Cleaner SMS failed (non-blocking):', smsErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Booking rescheduled successfully',
        rescheduleFeeCents: feeDecision.feeCents,
        feeBasis: feeDecision.basis,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in reschedule-booking function:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
