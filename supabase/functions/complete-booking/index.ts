import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[COMPLETE-BOOKING] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, cleanerId } = await req.json();
    logStep("Marking booking complete", { bookingId });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get user from auth header (if present)
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabase.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }

    // Fetch booking first (needed to verify cleaner assignment)
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error("Booking not found");
    }

    if (!booking.cleaner_id) {
      throw new Error("No cleaner assigned to this booking");
    }

    // Auth check: admin OR assigned cleaner
    let isAuthorized = false;

    if (userId) {
      // JWT path: check if admin
      const { data: roleCheck } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      
      if (roleCheck) {
        isAuthorized = true;
      } else {
        // Check if user is the assigned cleaner
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("user_id")
          .eq("id", booking.cleaner_id)
          .single();
        if (cleaner?.user_id === userId) {
          isAuthorized = true;
        }
      }
    }

    // No JWT: allow if cleanerId in body matches booking.cleaner_id (public /contractor/jobs page)
    if (!isAuthorized && cleanerId && cleanerId === booking.cleaner_id) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      throw new Error("Unauthorized");
    }

    logStep("Booking validated");

    // Mark booking as completed
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (updateError) throw updateError;

    logStep("Booking marked complete, triggering payout");

    // Trigger payout
    const payoutResponse = await supabase.functions.invoke('process-payout', {
      body: { bookingId },
    });

    if (payoutResponse.error) {
      logStep("Payout trigger failed", { error: payoutResponse.error });
    } else {
      logStep("Payout triggered successfully");
    }

    // Send completion email to cleaner
    if (booking.cleaner_id) {
      try {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("first_name, email")
          .eq("id", booking.cleaner_id)
          .single();

        if (cleaner?.email) {
          const estimatedEarnings = booking.total_estimate_cents
            ? Math.round(booking.total_estimate_cents * 0.45)
            : 0;

          await supabase.functions.invoke('send-cleaner-email', {
            body: {
              type: 'completion',
              email: cleaner.email,
              data: {
                cleanerFirstName: cleaner.first_name,
                bookingId,
                serviceDate: booking.service_date,
                customerName: `${booking.first_name || ''} ${booking.last_name || ''}`.trim(),
                earnings: estimatedEarnings,
                payoutStatus: payoutResponse.error ? 'processing' : 'initiated',
              },
            },
          });
          logStep("Cleaner completion email sent");
        }
      } catch (emailError) {
        logStep("Cleaner email failed (non-critical)", { error: emailError });
      }
    }

    // Send thank-you email to customer
    try {
      await supabase.functions.invoke('send-booking-email', {
        body: {
          type: 'completion',
          email: booking.email,
          data: {
            firstName: booking.first_name,
            bookingId,
            serviceDate: booking.service_date,
            timeSlot: booking.time_slot,
            serviceType: booking.service_type,
            address: booking.address,
            city: booking.city,
            state: booking.state,
            zipCode: booking.zip_code,
            totalAmount: booking.total_estimate_cents,
          },
        },
      });
      logStep("Customer thank-you email sent");
    } catch (emailError) {
      logStep("Customer email failed (non-critical)", { error: emailError });
    }

    // Trigger Zapier webhook for completed booking
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier webhook triggered");
    } catch (webhookError) {
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Booking completed and payout initiated"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
