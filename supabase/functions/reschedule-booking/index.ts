import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { RescheduleConfirmation } from '../_shared/email-templates/RescheduleConfirmation.tsx';
import { syncBookingLifecycle } from '../_shared/ghl-client.ts';
import { sendSms, formatServiceDate, formatTimeSlot } from '../_shared/sms.ts';
import { decideRescheduleFee, SUPPORT_PHONE_DISPLAY, smsActionTail } from '../_shared/booking-policy.ts';
import { mirrorToLeadConnector } from '../_shared/leadconnector-mirror.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { bookingId, newDate, newTimeSlot, oldDate, oldTimeSlot, source = 'customer_portal' }: RescheduleRequest = await req.json();

    console.log('Reschedule request:', { bookingId, newDate, newTimeSlot, oldDate, oldTimeSlot, source });

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

    // 2. Check availability for new slot (soft check - proceed even if no row)
    const { data: newSlot } = await supabase
      .from('availability')
      .select('capacity')
      .eq('service_date', newDate)
      .eq('time_window', newTimeSlot)
      .maybeSingle();

    if (newSlot && newSlot.capacity <= 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Selected time slot is not available' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Decide reschedule fee BEFORE we mutate the row (so the fee is
    // calculated against the ORIGINAL service date, not the new one).
    const feeDecision = decideRescheduleFee({ serviceDate: booking.service_date });
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateError) {
      console.error('Error updating booking:', updateError);
      throw updateError;
    }

    // 4. Release old availability slot
    try {
      const { data: oldSlot } = await supabase
        .from('availability')
        .select('capacity')
        .eq('service_date', oldDate)
        .eq('time_window', oldTimeSlot)
        .maybeSingle();

      if (oldSlot) {
        await supabase
          .from('availability')
          .update({ capacity: oldSlot.capacity + 1 })
          .eq('service_date', oldDate)
          .eq('time_window', oldTimeSlot);
        console.log('Old slot released, new capacity:', oldSlot.capacity + 1);
      }
    } catch (e) {
      console.error('Release old slot failed (non-critical):', e);
    }

    // 5. Reserve new availability slot
    try {
      if (newSlot) {
        await supabase
          .from('availability')
          .update({ capacity: Math.max(0, newSlot.capacity - 1) })
          .eq('service_date', newDate)
          .eq('time_window', newTimeSlot);
      } else {
        await supabase.rpc('reserve_availability', {
          _date: newDate,
          _time_window: newTimeSlot,
        });
      }
      console.log('New slot reserved');
    } catch (e) {
      console.error('Reserve new slot failed (non-critical):', e);
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

    // GHL: tag the contact as rescheduled but DON'T overwrite the
    // financial / scheduling fields here — send-zapier-webhook (fired
    // below) owns the authoritative refresh via buildGhlCustomFields,
    // which keeps the contact's state consistent across the many
    // bookings a single email can have.
    try {
      await syncBookingLifecycle({
        contact: {
          email: booking.email,
          phone: booking.phone,
          firstName: booking.first_name,
          lastName: booking.last_name,
          address1: booking.address,
          city: booking.city,
          state: booking.state,
          postalCode: booking.zip_code,
          source: "Novara Reschedule",
          tags: [
            "rescheduled",
            newDate ? `svc-${newDate}` : "",
            booking.zip_code ? `zip-${booking.zip_code}` : "",
            feeDecision.feeCents > 0 ? "short-notice-reschedule" : "",
          ].filter(Boolean) as string[],
        },
        opportunity: {
          name: `NOV-${String(booking.booking_number).padStart(5, '0')} — ${booking.first_name} ${booking.last_name}`,
          status: 'open',
          monetaryValue: Math.round(((booking.total_estimate_cents || 0) + feeDecision.feeCents) / 100),
          source: "Novara Reschedule",
        },
      });
      console.log('[reschedule-booking] GHL contact + opportunity tagged');
    } catch (ghlPitErr) {
      console.error('[reschedule-booking] GHL PIT sync failed (non-blocking):', ghlPitErr);
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
        await sendSms(supabase, {
          toPhone: booking.phone,
          message:
            `Novara Cleaning: Your appointment has been rescheduled to ` +
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
