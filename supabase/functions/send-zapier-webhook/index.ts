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

const ZAPIER_WEBHOOK_URL = "https://hooks.zapier.com/hooks/catch/25149972/us79bxw/";

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-ZAPIER-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

// Map home_size_id to Sq Ft single-select format
function mapSqFtRange(homeSizeId: string): string {
  return getSqftRange(homeSizeId);
}

// Map service_type to Service Type enum
function mapServiceType(serviceType: string): string {
  const mapping: Record<string, string> = {
    'standard': 'Standard',
    'deep': 'Deep',
    'moveInOut': 'Move In/Out'
  };
  return mapping[serviceType] || 'Standard';
}

// Map add_ons array to formatted string
function mapAddOns(addOns: string[]): string {
  const mapping: Record<string, string> = {
    'fridge': 'Inside Fridge',
    'oven': 'Inside Oven',
    'windows': 'Windows',
    'baseboards': 'Baseboards',
    'laundry': 'Laundry',
    'dishes': 'Dishes',
    'balcony': 'Balcony/Patio',
    'garage': 'Garage'
  };
  if (!addOns || addOns.length === 0) return 'None';
  return addOns.map(addon => mapping[addon] || addon).join(', ');
}

// Map time_slot to Arrival Window enum
function mapArrivalWindow(timeSlot: string): string {
  const mapping: Record<string, string> = {
    '8-12': '8–10a',
    '12-16': '12–2p',
    '16-20': '4–6p'
  };
  return mapping[timeSlot] || '8–10a';
}

// Map booking status to Zapier status enum
function mapBookingStatus(status: string): string {
  const mapping: Record<string, string> = {
    'pending_payment': 'Booked',
    'confirmed': 'Assigned',
    'completed': 'Completed',
    'cancelled': 'Canceled'
  };
  return mapping[status] || 'Booked';
}

// Determine Payment Status
function getPaymentStatus(status: string, paymentOption: string): string {
  if (status === 'completed') return 'Paid in Full';
  if (status === 'confirmed' && paymentOption === 'full') return 'Paid in Full';
  if (status === 'confirmed' && paymentOption === 'deposit') return 'Deposit Paid';
  if (status === 'cancelled') return 'Refunded';
  return 'Unpaid';
}

// Format currency with $ symbol
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
    const { bookingId } = await req.json();
    logStep("Processing booking", { bookingId });

    // Fetch booking with cleaner details
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        cleaners:cleaner_id (
          first_name,
          last_name,
          email
        )
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      throw new Error(`Booking not found: ${error?.message}`);
    }

    logStep("Booking fetched", { 
      bookingNumber: booking.booking_number,
      status: booking.status 
    });

    // Calculate estimated hours and payout
    const estimatedHours = booking.estimated_duration_hours || getEstimatedHours(booking.home_size_id);
    const cleanerHourlyRateCents = booking.cleaner_hourly_rate_cents || DEFAULT_CLEANER_HOURLY_RATE_CENTS;
    const cleanerPayoutCents = calculateCleanerPayout(estimatedHours, cleanerHourlyRateCents);
    const totalChargedCents = booking.final_charge_cents || booking.total_estimate_cents;
    const companyNetCents = totalChargedCents - cleanerPayoutCents;

    // Calculate total discounts
    const newCustomerDiscount = booking.booking_number === 1 ? 6000 : 0; // $60 for first booking
    const creditDiscount = booking.uses_credit ? booking.base_price_cents : 0;
    const fullPaymentDiscount = booking.full_payment_discount || 0;
    const totalDiscountCents = newCustomerDiscount + creditDiscount + fullPaymentDiscount;

    // Build Zapier payload
    const payload = {
      // Basic Job Information
      "Job ID": booking.id,
      "External Job Ref": `NOV-${String(booking.booking_number).padStart(5, '0')}`,
      "Booking Channel": booking.booking_channel || "Website",
      "Booker Source": booking.booker_source || (booking.booking_number === 1 ? "New Lead" : "Returning Client"),
      
      // Customer Information
      "Customer Phone": booking.phone,
      "Customer Email": booking.email,
      "Service Address": `${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
      "First Name": booking.first_name,
      "Last Name": booking.last_name,
      
      // Location Details
      "City": booking.city,
      "State": booking.state,
      "Zip Code": booking.zip_code,
      "Access Notes": booking.access_notes || "",
      
      // Service Details
      "Service Type": mapServiceType(booking.service_type),
      "Frequency": booking.frequency || "One-Time",
      "Sq Ft": mapSqFtRange(booking.home_size_id),
      "Bedrooms": booking.bedrooms || 0,
      "Bathrooms": booking.bathrooms || 0,
      "Add-ons": mapAddOns(booking.add_ons || []),
      "Notes to Team": booking.team_notes || "",
      
      // Scheduling
      "Scheduled Date": booking.service_date,
      "Start Time": `${booking.service_date}T08:00:00Z`,
      "End Time": `${booking.service_date}T${String(8 + estimatedHours).padStart(2, '0')}:00:00Z`,
      "Arrival Window": mapArrivalWindow(booking.time_slot),
      "Service Time Window": booking.time_slot || "8-12",
      "Estimated Duration": estimatedHours,
      
      // Status & Operations
      "Status": mapBookingStatus(booking.status),
      "Cancel Reason": booking.cancel_reason || "",
      "Assigned Cleaner(s)": booking.cleaners ? `${booking.cleaners.first_name} ${booking.cleaners.last_name}` : "",
      "Dispatch Notes": booking.dispatch_notes || "",
      "Check-in Time": booking.check_in_time || "",
      "Check-out Time": booking.check_out_time || "",
      "Before/After Photos": [...(booking.before_photos || []), ...(booking.after_photos || [])].join(', '),
      "Issues Flag": booking.issues_flag || false,
      "Issues Notes": booking.issues_notes || "",
      
      // Financial Information
      "Price": formatCurrency(booking.base_price_cents),
      "Deposit": formatCurrency(booking.deposit_cents),
      "Discount/Credit": formatCurrency(totalDiscountCents),
      "Tax": formatCurrency(booking.tax_cents || 0),
      "Total Charged": formatCurrency(totalChargedCents),
      "Payment Status": getPaymentStatus(booking.status, booking.payment_option),
      "Payment Method": booking.payment_method || "Card",
      "Cleaner Split %": Math.round((cleanerPayoutCents / totalChargedCents) * 100),
      "Cleaner Payout": formatCurrency(cleanerPayoutCents),
      "Company Net": formatCurrency(companyNetCents),
      "Tip": formatCurrency(booking.tip_cents || 0)
    };

    logStep("Payload constructed", { jobId: payload["Job ID"] });

    // Send to Zapier with retry logic
    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (retryCount < MAX_RETRIES) {
      try {
        const response = await fetch(ZAPIER_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          logStep("Webhook sent successfully", { 
            bookingId, 
            status: response.status 
          });
          return new Response(
            JSON.stringify({ success: true, bookingId }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }

        throw new Error(`Webhook failed with status ${response.status}`);
      } catch (err) {
        retryCount++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logStep(`Webhook attempt ${retryCount} failed`, { error: errorMessage });
        
        if (retryCount >= MAX_RETRIES) {
          // Log failure to database
          await supabase.from('webhook_failures').insert({
            booking_id: bookingId,
            webhook_url: ZAPIER_WEBHOOK_URL,
            payload: payload,
            error_message: errorMessage,
            retry_count: retryCount
          });
          throw new Error(errorMessage);
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
      }
    }

    // Fallback response if all retries failed
    return new Response(
      JSON.stringify({ error: "All retry attempts failed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
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
