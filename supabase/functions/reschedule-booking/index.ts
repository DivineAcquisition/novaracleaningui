import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@4.0.0";

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
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">Booking Rescheduled</h1>
          </div>
          
          <div style="padding: 30px; background: #f9fafb;">
            <p style="font-size: 16px; color: #374151;">Hello ${booking.first_name},</p>
            
            <p style="font-size: 16px; color: #374151;">
              Your cleaning service has been successfully rescheduled.
            </p>

            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
              <h2 style="color: #667eea; margin-top: 0;">New Appointment Details</h2>
              <p style="margin: 10px 0;"><strong>Date:</strong> ${new Date(newDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p style="margin: 10px 0;"><strong>Time:</strong> ${newTimeSlot}</p>
              <p style="margin: 10px 0;"><strong>Service:</strong> ${booking.service_type}</p>
              <p style="margin: 10px 0;"><strong>Address:</strong> ${booking.address}, ${booking.city}, ${booking.state}</p>
            </div>

            <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; color: #92400e;">
                <strong>Previous appointment:</strong> ${new Date(oldDate).toLocaleDateString()} at ${oldTimeSlot}
              </p>
            </div>

            <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
              If you need to make any changes, please contact us or visit your customer portal.
            </p>
          </div>
          
          <div style="background: #374151; padding: 20px; text-align: center; color: white; font-size: 12px;">
            <p style="margin: 0;">© 2024 Novara Cleaning. All rights reserved.</p>
          </div>
        </div>
      `;

      await resend.emails.send({
        from: 'Novara Cleaning <onboarding@resend.dev>',
        to: [booking.email],
        subject: 'Booking Rescheduled - Novara Cleaning',
        html: emailHtml,
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
