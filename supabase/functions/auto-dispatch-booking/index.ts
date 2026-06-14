import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { notifyStaffNoCleanersAvailable } from "../_shared/dispatch-backfill.ts";
import { getServiceDurationHours } from "../_shared/payout-utils.ts";
import { parseTimeSlotToClock } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  console.log(`[AUTO-DISPATCH] ${step}`, details ? JSON.stringify(details) : '');
};

// Resolve a booking's arrival window to a 24h job start clock. Delegates
// to the shared parser so canonical slot ids ("8-12", "16-20"), named
// windows, and freeform "8:00 AM - 12:00 PM" all map correctly. The old
// inline version only knew morning/midday/afternoon and silently defaulted
// EVERY real slot to 09:00 — so dispatched jobs (and the cleaner SMS,
// calendar, and conflict checks built on start_datetime) all had the wrong
// time.
function parseTimeSlot(timeSlot: string): string {
  return parseTimeSlotToClock(timeSlot).start || "09:00:00";
}

// Estimated job duration comes from the canonical helper in
// _shared/payout-utils.ts (home_size_id base hours × service-type
// multiplier). The old inline version keyed off raw sqft with a
// different ladder than the rest of the system and gave Move-In/Out no
// multiplier at all — so dispatched job windows didn't match the hours
// used everywhere else, breaking conflict detection.

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
    // Duration is keyed off home_size_id (canonical) and scaled by the
    // service-type multiplier, so Deep AND Move-In/Out get longer
    // windows than a Standard clean of the same size.
    const estimatedHours = getServiceDurationHours(
      String(booking.home_size_id || ""),
      booking.service_type,
    );

    logStep("Calculated job requirements", { minCleaners, estimatedHours });

    // 4. Create job record
    const startTime = parseTimeSlot(booking.time_slot);
    const startDatetime = `${booking.service_date}T${startTime}`;

    // Resolve customer UUID - booking.customer_id may be a Stripe ID (cus_...) not a UUID
    let customerUuid: string | null = null;
    if (booking.customer_id) {
      // Check if it's already a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(booking.customer_id)) {
        customerUuid = booking.customer_id;
      } else {
        // It's likely a Stripe customer ID - look up the actual customer by email
        logStep("customer_id is not UUID, looking up by email", { customer_id: booking.customer_id, email: booking.email });
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("email", booking.email)
          .maybeSingle();
        
        if (customer) {
          customerUuid = customer.id;
          logStep("Resolved customer UUID", { customerUuid });
        } else {
          logStep("No customer found by email, setting customer_id to null");
        }
      }
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerUuid,
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
      await supabase.from("dispatch_alerts").insert({
        job_id: job.id,
        reason: `Auto-dispatch failed: ${dispatchError.message}`,
        severity: "warning",
      });
      throw new Error(`Dispatch failed: ${dispatchError.message}`);
    }

    const dispatchPayload = (dispatchResult || {}) as Record<string, unknown>;
    if (dispatchPayload.noCleanersAvailable === true) {
      logStep("No cleaners available on initial dispatch");
      await notifyStaffNoCleanersAvailable(supabase, job.id, {
        reason: "Initial auto-dispatch found no eligible cleaners",
      });
    }

    logStep("Cleaners dispatched successfully", {
      offersSent: dispatchPayload.offersSent ?? dispatchPayload.assignedCleaners ?? 0,
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
        offersSent: dispatchPayload.offersSent ?? dispatchPayload.assignedCleaners ?? 0,
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
