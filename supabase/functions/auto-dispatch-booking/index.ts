import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  console.log(`[AUTO-DISPATCH] ${step}`, details ? JSON.stringify(details) : '');
};

// Helper to parse time slot to hour
function parseTimeSlot(timeSlot: string): string {
  const timeMap: Record<string, string> = {
    "morning": "09:00:00",
    "midday": "12:00:00",
    "afternoon": "15:00:00"
  };
  return timeMap[timeSlot] || "09:00:00";
}

// Calculate estimated duration based on sq_ft and service type
function calculateDuration(sqft: number, serviceType: string): number {
  let baseHours = 3;
  
  if (sqft < 1500) baseHours = 2;
  else if (sqft < 2500) baseHours = 3;
  else if (sqft < 3500) baseHours = 4;
  else baseHours = 5;

  // Deep clean takes 50% longer
  if (serviceType === "Deep Clean") {
    baseHours = baseHours * 1.5;
  }

  return baseHours;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    logStep("Starting auto-dispatch", { bookingId });

    if (!bookingId) {
      throw new Error("Missing bookingId");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Fetch booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error(`Booking not found: ${bookingError?.message}`);
    }

    logStep("Fetched booking", { 
      bookingId: booking.id,
      serviceDate: booking.service_date,
      sqft: booking.sqft 
    });

    // 2. Check if job already exists
    if (booking.job_id) {
      logStep("Job already exists for booking", { jobId: booking.job_id });
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Job already dispatched",
          jobId: booking.job_id 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Calculate required cleaners based on sq_ft
    const minCleaners = (booking.sqft || 2000) >= 3000 ? 3 : 2;
    const estimatedHours = calculateDuration(booking.sqft || 2000, booking.service_type);

    logStep("Calculated job requirements", { minCleaners, estimatedHours });

    // 4. Create job record
    const startTime = parseTimeSlot(booking.time_slot);
    const startDatetime = `${booking.service_date}T${startTime}`;

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        customer_id: booking.customer_id,
        address: booking.address,
        city: booking.city,
        state: booking.state,
        zip: booking.zip_code,
        service_type: booking.service_type,
        sq_ft: booking.sqft,
        bedrooms: booking.bedrooms,
        bathrooms: booking.bathrooms,
        start_datetime: startDatetime,
        duration_est_hours: estimatedHours,
        min_cleaners_required: minCleaners,
        status: "New",
        notes: booking.access_notes || "",
        analytics_source: booking.booking_channel
      })
      .select()
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to create job: ${jobError?.message}`);
    }

    logStep("Created job", { jobId: job.id });

    // 5. Link job to booking
    const { error: linkError } = await supabase
      .from("bookings")
      .update({ job_id: job.id })
      .eq("id", bookingId);

    if (linkError) {
      logStep("Warning: Failed to link job to booking", { error: linkError });
    }

    // 6. Geocode address if lat/lng missing
    if (!booking.lat || !booking.lng) {
      logStep("Geocoding address");
      try {
        const { data: geocodeData, error: geocodeError } = await supabase.functions.invoke('geocode-address', {
          body: { 
            address: booking.address,
            city: booking.city,
            state: booking.state,
            zip: booking.zip_code
          }
        });

        if (!geocodeError && geocodeData?.lat && geocodeData?.lng) {
          await supabase
            .from("jobs")
            .update({ lat: geocodeData.lat, lng: geocodeData.lng })
            .eq("id", job.id);
          
          logStep("Geocoded address", { lat: geocodeData.lat, lng: geocodeData.lng });
        }
      } catch (geocodeError) {
        logStep("Warning: Geocoding failed (non-critical)", { error: geocodeError });
      }
    }

    // 7. Dispatch cleaners
    logStep("Dispatching cleaners");
    const { data: dispatchResult, error: dispatchError } = await supabase.functions.invoke('dispatch-job', {
      body: { jobId: job.id }
    });

    if (dispatchError) {
      logStep("Dispatch failed", { error: dispatchError });
      
      // Create alert for admin
      await supabase.from("dispatch_alerts").insert({
        job_id: job.id,
        reason: `Auto-dispatch failed: ${dispatchError.message}`,
        severity: "warning"
      });

      throw new Error(`Dispatch failed: ${dispatchError.message}`);
    }

    logStep("Cleaners dispatched successfully", { 
      cleanersAssigned: dispatchResult?.assigned || 0 
    });

    // 8. Send Zapier webhook with cleaner data
    logStep("Sending Zapier webhook");
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { jobId: job.id, bookingId: bookingId }
      });
      logStep("Zapier webhook sent");
    } catch (webhookError) {
      logStep("Warning: Zapier webhook failed (non-critical)", { error: webhookError });
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Booking auto-dispatched successfully",
        jobId: job.id,
        cleanersAssigned: dispatchResult?.assigned || 0
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("Error", { error: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
