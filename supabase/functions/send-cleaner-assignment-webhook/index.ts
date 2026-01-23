import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  getEstimatedHours, 
  calculateCleanerPayout,
  getSqftRange,
  DEFAULT_CLEANER_HOURLY_RATE_CENTS 
} from "../_shared/payout-utils.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZAPIER_CLEANER_ASSIGNMENT_URL = Deno.env.get("ZAPIER_CLEANER_ASSIGNMENT_WEBHOOK_URL") || "";
const GHL_CLEANER_ASSIGNMENT_URL = Deno.env.get("GHL_CLEANER_ASSIGNMENT_WEBHOOK_URL") || "";

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-CLEANER-ASSIGNMENT-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

// Format time slot
function formatTimeSlot(timeSlot: string): string {
  const mapping: Record<string, string> = {
    '8-12': '8:00 AM - 12:00 PM',
    '12-16': '12:00 PM - 4:00 PM',
    '16-20': '4:00 PM - 8:00 PM'
  };
  return mapping[timeSlot] || timeSlot;
}

// Map service type
function formatServiceType(serviceType: string): string {
  const mapping: Record<string, string> = {
    'standard': 'Standard Cleaning',
    'deep': 'Deep Cleaning',
    'moveInOut': 'Move In/Out Cleaning'
  };
  return mapping[serviceType] || 'Standard Cleaning';
}

// Format currency
function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { bookingId, cleanerId, assignmentType = 'assigned' } = await req.json();
    
    logStep("Processing cleaner assignment webhook", { bookingId, cleanerId, assignmentType });

    if (!bookingId || !cleanerId) {
      throw new Error("bookingId and cleanerId are required");
    }

    // Fetch booking details
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error(`Booking not found: ${bookingError?.message}`);
    }

    // Fetch cleaner details
    const { data: cleaner, error: cleanerError } = await supabase
      .from('cleaners')
      .select('*')
      .eq('id', cleanerId)
      .single();

    if (cleanerError || !cleaner) {
      throw new Error(`Cleaner not found: ${cleanerError?.message}`);
    }

    logStep("Fetched booking and cleaner data", { 
      bookingNumber: booking.booking_number,
      cleanerName: `${cleaner.first_name} ${cleaner.last_name}`
    });

    // Calculate payout
    const estimatedHours = booking.estimated_duration_hours || getEstimatedHours(booking.home_size_id);
    const hourlyRateCents = cleaner.pay_rate_hr ? cleaner.pay_rate_hr * 100 : DEFAULT_CLEANER_HOURLY_RATE_CENTS;
    const cleanerPayoutCents = calculateCleanerPayout(estimatedHours, hourlyRateCents);

    // Build the payload for external webhooks
    const payload = {
      // Event Info
      "Event Type": assignmentType === 'unassigned' ? "Cleaner Unassigned" : "Cleaner Assigned",
      "Assignment Timestamp": new Date().toISOString(),
      
      // Booking Info
      "Booking ID": booking.id,
      "Booking Number": `NOV-${String(booking.booking_number).padStart(5, '0')}`,
      "Booking Status": booking.status,
      
      // Customer Info
      "Customer Name": `${booking.first_name} ${booking.last_name}`,
      "Customer Email": booking.email,
      "Customer Phone": booking.phone,
      
      // Service Location
      "Service Address": `${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
      "City": booking.city,
      "State": booking.state,
      "Zip Code": booking.zip_code,
      
      // Service Details
      "Service Type": formatServiceType(booking.service_type),
      "Home Size": getSqftRange(booking.home_size_id),
      "Bedrooms": booking.bedrooms || 0,
      "Bathrooms": booking.bathrooms || 0,
      "Add-ons": booking.add_ons?.length > 0 ? booking.add_ons.join(', ') : 'None',
      
      // Schedule
      "Service Date": booking.service_date,
      "Formatted Date": formatDate(booking.service_date),
      "Time Slot": formatTimeSlot(booking.time_slot),
      "Estimated Duration": `${estimatedHours} hours`,
      
      // Cleaner Info
      "Cleaner ID": cleaner.id,
      "Cleaner Name": `${cleaner.first_name} ${cleaner.last_name}`,
      "Cleaner Email": cleaner.email,
      "Cleaner Phone": cleaner.phone,
      "Cleaner Rating": cleaner.average_rating ? `${cleaner.average_rating.toFixed(1)} (${cleaner.total_ratings || 0} reviews)` : "New Cleaner",
      "Cleaner Completed Jobs": cleaner.completed_bookings || 0,
      "Cleaner Acceptance Rate": cleaner.acceptance_rate ? `${(cleaner.acceptance_rate * 100).toFixed(0)}%` : "N/A",
      "Cleaner On-Time Rate": cleaner.on_time_rate ? `${(cleaner.on_time_rate * 100).toFixed(0)}%` : "N/A",
      
      // Payout Info
      "Cleaner Hourly Rate": formatCurrency(hourlyRateCents),
      "Estimated Cleaner Payout": formatCurrency(cleanerPayoutCents),
      "Total Customer Charge": formatCurrency(booking.total_estimate_cents),
      
      // Notes
      "Access Notes": booking.access_notes || "",
      "Team Notes": booking.team_notes || "",
      "Dispatch Notes": booking.dispatch_notes || "",
      
      // Meta
      "Assigned At": booking.assigned_at || new Date().toISOString(),
      "Created At": booking.created_at,
    };

    // Send to all configured webhooks
    const webhookUrls = [
      { url: ZAPIER_CLEANER_ASSIGNMENT_URL, name: 'Zapier Cleaner Assignment' },
      { url: GHL_CLEANER_ASSIGNMENT_URL, name: 'GHL Cleaner Assignment' }
    ].filter(w => w.url);

    logStep("Sending to webhooks", { count: webhookUrls.length, targets: webhookUrls.map(w => w.name) });

    if (webhookUrls.length === 0) {
      logStep("No webhooks configured, skipping external sends");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No webhooks configured",
          payload 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const results = await Promise.allSettled(
      webhookUrls.map(async (webhook) => {
        logStep(`Sending to ${webhook.name}`);
        
        let retryCount = 0;
        const MAX_RETRIES = 3;
        
        while (retryCount < MAX_RETRIES) {
          try {
            const response = await fetch(webhook.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });

            if (response.ok) {
              logStep(`${webhook.name} sent successfully`, { status: response.status });
              return { success: true, webhookName: webhook.name, status: response.status };
            }
            throw new Error(`${webhook.name} failed with status ${response.status}`);
          } catch (err) {
            retryCount++;
            if (retryCount >= MAX_RETRIES) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
          }
        }
        throw new Error(`${webhook.name}: All retry attempts failed`);
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logStep("Webhook results", { successful, failed, total: webhookUrls.length });

    // Log to database
    await supabase.from('webhook_logs').insert({
      webhook_type: 'cleaner_assignment',
      event_type: assignmentType,
      payload: payload,
      processed_at: new Date().toISOString(),
      status: successful > 0 ? 'sent' : 'failed',
      metadata: { bookingId, cleanerId, successful, failed }
    });

    return new Response(
      JSON.stringify({ 
        success: successful > 0, 
        bookingId,
        cleanerId,
        webhooksAttempted: webhookUrls.length,
        webhooksSuccessful: successful,
        webhooksFailed: failed,
        payload 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: successful > 0 ? 200 : 500 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
