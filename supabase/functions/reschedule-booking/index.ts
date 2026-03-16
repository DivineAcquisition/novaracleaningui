import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { RescheduleConfirmation } from '../_shared/email-templates/RescheduleConfirmation.tsx';

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

    const { bookingId, newDate, newTimeSlot, oldDate, oldTimeSlot }: RescheduleRequest = await req.json();

    console.log('Reschedule request:', { bookingId, newDate, newTimeSlot, oldDate, oldTimeSlot });

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

    // 3. Update booking with new date/time
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        service_date: newDate,
        time_slot: newTimeSlot,
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

    // Send reschedule SMS to customer
    if (booking.phone) {
      try {
        const newDateFmt = new Date(newDate).toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric'
        });
        const smsMsg = `Novara Cleaning: Your booking has been rescheduled to ${newDateFmt} at ${newTimeSlot}. View details: https://try.novaracleaning.com/account`;

        await supabase.functions.invoke('send-sms-notification', {
          body: {
            toPhone: booking.phone,
            message: smsMsg,
            type: 'confirmation',
          }
        });
        console.log('Reschedule SMS sent');
      } catch (smsError) {
        console.error('SMS reschedule failed (non-critical):', smsError);
      }
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

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Booking rescheduled successfully'
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
