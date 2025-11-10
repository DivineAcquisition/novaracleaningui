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

    // 1. Check availability for new slot
    const { data: availability, error: availError } = await supabase
      .from('availability')
      .select('capacity')
      .eq('service_date', newDate)
      .eq('time_window', newTimeSlot)
      .maybeSingle();

    if (availError) {
      console.error('Error checking availability:', availError);
      throw availError;
    }

    if (!availability || availability.capacity <= 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Selected time slot is not available' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get booking details
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError) {
      console.error('Error fetching booking:', bookingError);
      throw bookingError;
    }

    // 3. Update booking
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

    // 4. Update availability - release old slot
    const { error: releaseError } = await supabase
      .from('availability')
      .update({ capacity: supabase.rpc('increment', { x: 1 }) })
      .eq('service_date', oldDate)
      .eq('time_window', oldTimeSlot);

    if (releaseError) {
      console.error('Error releasing old slot:', releaseError);
    }

    // 5. Reserve new slot
    const { error: reserveError } = await supabase
      .from('availability')
      .update({ capacity: availability.capacity - 1 })
      .eq('service_date', newDate)
      .eq('time_window', newTimeSlot);

    if (reserveError) {
      console.error('Error reserving new slot:', reserveError);
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
        from: 'Novara Cleaning <hello@notify.novaracleaning.com>',
        to: [booking.email],
        subject: 'Booking Rescheduled - Novara Cleaning',
        html,
      });

      console.log('Reschedule confirmation email sent');
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Don't fail the request if email fails
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
