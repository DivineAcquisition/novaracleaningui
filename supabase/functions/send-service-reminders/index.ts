import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SERVICE-REMINDERS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Service reminder function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get tomorrow's date in YYYY-MM-DD format
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    logStep("Checking for bookings tomorrow", { date: tomorrowStr });

    // Find confirmed bookings scheduled for tomorrow that haven't received a reminder
    const { data: upcomingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("service_date", tomorrowStr)
      .in("status", ["confirmed", "booked"])
      .eq("reminder_sms_sent", false)
      .order("time_slot", { ascending: true });

    if (fetchError) {
      logStep("Error fetching bookings", fetchError);
      throw fetchError;
    }

    logStep("Found bookings for tomorrow", { count: upcomingBookings?.length || 0 });

    if (!upcomingBookings || upcomingBookings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, reminders_sent: 0, message: "No bookings to remind" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    let remindersSent = 0;
    const errors: any[] = [];

    for (const booking of upcomingBookings) {
      try {
        // Send SMS reminder via Twilio
        if (booking.phone) {
          const smsResponse = await supabase.functions.invoke('send-twilio-sms', {
            body: {
              type: 'booking_reminder',
              bookingId: booking.id,
            },
          });

          if (smsResponse.error) {
            logStep("SMS reminder failed", { bookingId: booking.id, error: smsResponse.error });
            errors.push({ bookingId: booking.id, type: 'sms', error: smsResponse.error });
          } else {
            logStep("SMS reminder sent", { bookingId: booking.id, sid: smsResponse.data?.sid });
            
            // Mark reminder as sent
            await supabase
              .from('bookings')
              .update({ 
                reminder_sms_sent: true,
                reminder_sms_sent_at: new Date().toISOString()
              })
              .eq('id', booking.id);
            
            remindersSent++;
          }
        }

        // Also send email reminder
        try {
          await supabase.functions.invoke('send-booking-email', {
            body: {
              type: 'reminder',
              email: booking.email,
              data: {
                firstName: booking.first_name,
                bookingId: booking.id,
                serviceDate: booking.service_date,
                timeSlot: booking.time_slot,
                serviceType: booking.service_type,
                address: booking.address,
                city: booking.city,
                state: booking.state,
                zipCode: booking.zip_code,
              },
            },
          });
          logStep("Email reminder sent", { bookingId: booking.id, email: booking.email });
        } catch (emailError) {
          logStep("Email reminder failed (non-blocking)", { bookingId: booking.id, error: emailError });
        }

      } catch (error: any) {
        logStep("Error processing booking", { bookingId: booking.id, error: error.message });
        errors.push({ bookingId: booking.id, error: error.message });
      }
    }

    logStep("Reminder processing complete", { remindersSent, errors: errors.length });

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
        total_bookings: upcomingBookings.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
