import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  getEstimatedHours, 
  calculateCleanerPayout,
  getSqftRange,
  getTeamSize,
  DEFAULT_CLEANER_HOURLY_RATE_CENTS 
} from "../_shared/payout-utils.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZAPIER_BOOKING_WEBHOOK_URL = Deno.env.get("ZAPIER_WEBHOOK_URL") || "";
const ZAPIER_DISPATCH_WEBHOOK_URL = Deno.env.get("ZAPIER_DISPATCH_WEBHOOK_URL") || "";
const GHL_BOOKING_WEBHOOK_URL = Deno.env.get("GHL_BOOKING_WEBHOOK_URL") || "";
const ZAPIER_BOOKING_WEBHOOK_URL_2 = Deno.env.get("ZAPIER_BOOKING_WEBHOOK_URL_2") || "";

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-ZAPIER-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

// Map home_size_id to Sq Ft single-select format
function mapSqFtRange(homeSizeId: string): string {
  return getSqftRange(homeSizeId);
}

// Map service_type to Service Type enum with exact names
function mapServiceType(serviceType: string): string {
  const mapping: Record<string, string> = {
    'standard': 'Standard Cleaning',
    'deep': 'Deep Cleaning',
    'moveInOut': 'Move In/Out Cleaning'
  };
  return mapping[serviceType] || 'Standard Cleaning';
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

// Get start time for time slot in HH:MM A format
function getStartTimeForSlot(timeSlot: string): string {
  const mapping: Record<string, string> = {
    '8-12': '08:00 AM',
    '12-16': '12:00 PM',
    '16-20': '04:00 PM'
  };
  return mapping[timeSlot] || '08:00 AM';
}

// Format date as MM-DD-YYYY
function formatDateMMDDYYYY(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}-${day}-${year}`;
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

// Map dwelling_type to formatted string
function mapDwellingType(dwellingType: string | null): string {
  if (!dwellingType) return 'House';
  const mapping: Record<string, string> = {
    'house': 'House',
    'single_family': 'House',
    'apartment': 'Apartment',
    'condo': 'Condo',
    'office_space': 'Office Space',
    'townhouse': 'Townhouse',
    'mansion': 'Mansion',
    // Fallback old values
    'mobile_home': 'House',
    'other': 'House'
  };
  return mapping[dwellingType.toLowerCase()] || 'House';
}

// Map deposit type based on payment option and amounts
function mapDepositType(paymentOption: string, depositCents: number, totalCents: number): string {
  if (paymentOption === 'full') return 'Paid In Full';
  if (depositCents === 0) return 'Pay After Service';
  if (depositCents === 3900) return '$39 Only';
  if (depositCents === 5000) return '$50 Only';
  
  const depositPercent = Math.round((depositCents / totalCents) * 100);
  if (depositPercent >= 23 && depositPercent <= 27) return '25% Down';
  if (depositPercent >= 48 && depositPercent <= 52) return '50% Down';
  
  return '$39 Only'; // Default
}

// Map membership_plan to formatted string
function mapMembershipPlan(membershipPlan: string): string {
  const mapping: Record<string, string> = {
    'none': 'None',
    'monthly': 'Monthly (1 clean/month)',
    'biweekly': 'Bi-Weekly (2 cleans/month)',
    'weekly': 'Weekly (4 cleans/month)'
  };
  return mapping[membershipPlan] || 'None';
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
    const { bookingId, jobId } = await req.json();
    
    // Determine webhook type
    if (jobId) {
      return await handleJobDispatchWebhook(supabase, jobId);
    } else if (bookingId) {
      return await handleBookingWebhook(supabase, bookingId);
    } else {
      throw new Error("Either bookingId or jobId is required");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

async function handleJobDispatchWebhook(supabase: any, jobId: string) {
  logStep("Processing job dispatch", { jobId });

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Job not found: ${jobError?.message}`);
  }

  // Fetch job assignments with cleaner details
  const { data: assignments, error: assignmentsError } = await supabase
    .from('job_assignments')
    .select(`
      *,
      cleaners (
        id, first_name, last_name, email, phone,
        workload_score, weighted_score, acceptance_rate,
        on_time_rate, average_rating, total_ratings, completed_bookings
      )
    `)
    .eq('job_id', jobId)
    .in('status', ['Offered', 'Confirmed']);

  if (assignmentsError) {
    throw new Error(`Error fetching assignments: ${assignmentsError.message}`);
  }

  const cleaners = assignments || [];
  const confirmedCleaners = cleaners.filter((a: any) => a.status === 'Confirmed');

  // Build base payload
  const payload: any = {
    "Job Type": "Dispatch",
    "Job ID": job.id,
    "External Job Ref": `JOB-${String(job.id).substring(0, 8).toUpperCase()}`,
    "Number of Cleaners Assigned": confirmedCleaners.length,
    "Number of Cleaners Offered": cleaners.length,
    
    // Job details
    "Service Address": `${job.address}, ${job.city}, ${job.state} ${job.zip}`,
    "City": job.city,
    "State": job.state,
    "Zip Code": job.zip,
    "Service Type": mapServiceType(job.service_type),
    "Scheduled Date": new Date(job.start_datetime).toLocaleDateString(),
    "Start Time": job.start_datetime,
    "Estimated Duration": job.duration_est_hours,
    "Sq Ft": job.sq_ft,
    "Bedrooms": job.bedrooms || 0,
    "Bathrooms": job.bathrooms || 0,
    "Min Cleaners Required": job.min_cleaners_required,
    "Status": job.status,
    "Notes": job.notes || ""
  };

  // Add cleaner details (up to 3 cleaners)
  confirmedCleaners.forEach((assignment: any, index: number) => {
    const cleaner = assignment.cleaners;
    const num = index + 1;
    
    payload[`Cleaner ${num} Name`] = `${cleaner.first_name} ${cleaner.last_name}`;
    payload[`Cleaner ${num} Role`] = assignment.role;
    payload[`Cleaner ${num} Phone`] = cleaner.phone;
    payload[`Cleaner ${num} Email`] = cleaner.email;
    payload[`Cleaner ${num} Distance`] = assignment.distance_miles ? `${assignment.distance_miles.toFixed(1)} miles` : 'N/A';
    payload[`Cleaner ${num} Workload Score`] = cleaner.workload_score || 0;
    payload[`Cleaner ${num} Weighted Score`] = cleaner.weighted_score || 0;
    payload[`Cleaner ${num} Acceptance Rate`] = `${cleaner.acceptance_rate || 0}%`;
    payload[`Cleaner ${num} On-Time Rate`] = `${cleaner.on_time_rate || 0}%`;
    payload[`Cleaner ${num} Avg Rating`] = cleaner.average_rating || 0;
    payload[`Cleaner ${num} Total Jobs`] = cleaner.completed_bookings || 0;
  });

  // Add team summary
  if (confirmedCleaners.length > 0) {
    payload["All Cleaners Summary"] = confirmedCleaners
      .map((a: any) => `${a.cleaners.first_name} ${a.cleaners.last_name} (${a.role})`)
      .join(', ');
    
    const avgAcceptance = confirmedCleaners.reduce((sum: number, a: any) => sum + (a.cleaners.acceptance_rate || 0), 0) / confirmedCleaners.length;
    const avgOnTime = confirmedCleaners.reduce((sum: number, a: any) => sum + (a.cleaners.on_time_rate || 0), 0) / confirmedCleaners.length;
    const avgRating = confirmedCleaners.reduce((sum: number, a: any) => sum + (a.cleaners.average_rating || 0), 0) / confirmedCleaners.length;
    
    payload["Team Average Acceptance Rate"] = `${avgAcceptance.toFixed(1)}%`;
    payload["Team Average On-Time Rate"] = `${avgOnTime.toFixed(1)}%`;
    payload["Team Average Rating"] = avgRating.toFixed(2);
  }

  return await sendWebhook(supabase, payload, jobId, 'job', ZAPIER_DISPATCH_WEBHOOK_URL);
}

async function handleBookingWebhook(supabase: any, bookingId: string) {
  logStep("Processing booking", { bookingId });

    // Fetch booking with cleaner details
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        cleaners:cleaner_id (
          first_name,
          last_name,
          email,
          phone,
          pay_rate_hr,
          average_rating,
          total_ratings,
          completed_bookings,
          acceptance_rate,
          on_time_rate
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

    // Fetch customer referral code by email (customer_id is Stripe ID, not UUID)
    const { data: customerData } = await supabase
      .from('customers')
      .select('id, referral_code')
      .eq('email', booking.email)
      .maybeSingle();

    // Fetch subscription ID if exists
    const { data: membershipData } = await supabase
      .from('membership_credits')
      .select('subscription_id')
      .eq('customer_id', booking.customer_id)
      .maybeSingle();

    // Calculate estimated hours and payout with team size
    const estimatedHours = booking.estimated_duration_hours || getEstimatedHours(booking.home_size_id);
    const cleanerHourlyRateCents = booking.cleaner_hourly_rate_cents || DEFAULT_CLEANER_HOURLY_RATE_CENTS;
    const perCleanerPayoutCents = calculateCleanerPayout(estimatedHours, cleanerHourlyRateCents);
    const teamSize = getTeamSize(booking.home_size_id);
    const totalTeamPayoutCents = perCleanerPayoutCents * teamSize;
    const totalChargedCents = booking.final_charge_cents || booking.total_estimate_cents;
    const companyNetCents = totalChargedCents - totalTeamPayoutCents;

    // Calculate total discounts
    const newCustomerDiscount = booking.booking_number === 1 ? 3000 : 0; // $30 for first booking
    const creditDiscount = booking.uses_credit ? booking.base_price_cents : 0;
    const fullPaymentDiscount = booking.full_payment_discount || 0;
    const totalDiscountCents = newCustomerDiscount + creditDiscount + fullPaymentDiscount;

    // Referral link uses the production booking domain
    const origin = 'https://try.novaracleaning.com';

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
      
      // Customer Referral Information
      "Customer Referral Code": customerData?.referral_code || "",
      "Referral Link": customerData?.referral_code 
        ? `${origin}/book/zip?ref=${customerData.referral_code}` 
        : "",
      
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
      "Dwelling Type": mapDwellingType(booking.dwelling_type),
      "Membership Plan": mapMembershipPlan(booking.membership_plan || 'none'),
      "Add-ons": mapAddOns(booking.add_ons || []),
      "Notes to Team": booking.team_notes || "",
      
      // Scheduling
      "Scheduled Date": booking.service_date,
      "Service Start Date Formatted": formatDateMMDDYYYY(booking.service_date),
      "Service Start Time Formatted": getStartTimeForSlot(booking.time_slot),
      "Service Start DateTime": `${formatDateMMDDYYYY(booking.service_date)} ${getStartTimeForSlot(booking.time_slot)}`,
      "Start Time": `${booking.service_date}T08:00:00Z`,
      "End Time": `${booking.service_date}T${String(8 + estimatedHours).padStart(2, '0')}:00:00Z`,
      "Arrival Window": mapArrivalWindow(booking.time_slot),
      "Service Time Window": booking.time_slot || "8-12",
      "Estimated Duration": estimatedHours,
      
      // Status & Operations
      "Status": mapBookingStatus(booking.status),
      "Cancel Reason": booking.cancel_reason || "",
      "Assigned Cleaner(s)": booking.cleaners ? `${booking.cleaners.first_name} ${booking.cleaners.last_name}` : "Not Assigned Yet",
      "Assigned Cleaner Name": booking.cleaners ? `${booking.cleaners.first_name} ${booking.cleaners.last_name}` : "",
      "Assigned Cleaner Email": booking.cleaners?.email || "",
      "Assigned Cleaner Phone": booking.cleaners?.phone || "",
      "Assigned Cleaner Pay Rate": booking.cleaners ? `$${(booking.cleaners.pay_rate_hr || 18).toFixed(2)}/hr` : "",
      "Assigned Cleaner Total Pay": booking.cleaners ? formatCurrency(estimatedHours * ((booking.cleaners.pay_rate_hr || 18) * 100)) : "",
      "Assigned Cleaner Avg Rating": booking.cleaners?.average_rating ? `${booking.cleaners.average_rating.toFixed(1)} (${booking.cleaners.total_ratings || 0} reviews)` : "",
      "Assigned Cleaner Completed Jobs": booking.cleaners?.completed_bookings || 0,
      "Assigned Cleaner Acceptance Rate": booking.cleaners?.acceptance_rate ? `${(booking.cleaners.acceptance_rate * 100).toFixed(0)}%` : "",
      "Assigned Cleaner On-Time Rate": booking.cleaners?.on_time_rate ? `${(booking.cleaners.on_time_rate * 100).toFixed(0)}%` : "",
      "Dispatch Notes": booking.dispatch_notes || "",
      "Check-in Time": booking.check_in_time || "",
      "Check-out Time": booking.check_out_time || "",
      "Before/After Photos": [...(booking.before_photos || []), ...(booking.after_photos || [])].join(', '),
      "Issues Flag": booking.issues_flag || false,
      "Issues Notes": booking.issues_notes || "",
      
      // Transaction Data
      "Stripe Customer ID": booking.customer_id || "",
      "Stripe Subscription ID": membershipData?.subscription_id || "",
      "Payment Intent ID": booking.payment_intent_id || "",
      "Checkout Session ID": booking.checkout_session_id || "",
      "Stripe Invoice ID": booking.stripe_invoice_id || "",
      
      // Financial Information
      "Price": formatCurrency(booking.base_price_cents),
      "Deposit": formatCurrency(booking.deposit_cents),
      "Discount/Credit": formatCurrency(totalDiscountCents),
      "Discounted Amount": formatCurrency(totalDiscountCents),
      "Tax": formatCurrency(booking.tax_cents || 0),
      "Total Charged": formatCurrency(totalChargedCents),
      "Remaining Balance": booking.payment_option === 'deposit' 
        ? formatCurrency(booking.total_estimate_cents - booking.deposit_cents)
        : "$0.00",
      "Invoice URL": booking.stripe_invoice_id 
        ? `https://invoice.stripe.com/i/${booking.stripe_invoice_id}` 
        : "",
      "Invoice Status": booking.stripe_invoice_id ? "Sent" : "N/A",
      "Payment Status": getPaymentStatus(booking.status, booking.payment_option),
      "Deposit Type": mapDepositType(booking.payment_option, booking.deposit_cents, booking.total_estimate_cents),
      "Paid in Full": booking.payment_option === 'full',
      "Payment Method": booking.payment_method || "Card",
      
      // Team & Payout Information
      "Team Size": teamSize,
      "Cleaner Payout Per Cleaner": formatCurrency(perCleanerPayoutCents),
      "Total Team Payout": formatCurrency(totalTeamPayoutCents),
      "Company Net": formatCurrency(companyNetCents),
      "Tip": formatCurrency(booking.tip_cents || 0)
    };

  // Send to all configured booking webhooks in parallel
  const webhookUrls = [
    { url: ZAPIER_BOOKING_WEBHOOK_URL, name: 'Zapier Primary' },
    { url: GHL_BOOKING_WEBHOOK_URL, name: 'GoHighLevel' },
    { url: ZAPIER_BOOKING_WEBHOOK_URL_2, name: 'Zapier Secondary' }
  ].filter(w => w.url); // Only include configured webhooks

  logStep("Sending to multiple webhooks", { count: webhookUrls.length, targets: webhookUrls.map(w => w.name) });

  const results = await Promise.allSettled(
    webhookUrls.map(webhook => sendSingleWebhook(supabase, payload, bookingId, 'booking', webhook.url, webhook.name))
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  logStep("Webhook results", { successful, failed, total: webhookUrls.length });

  return new Response(
    JSON.stringify({ 
      success: successful > 0, 
      bookingId, 
      webhooksAttempted: webhookUrls.length,
      webhooksSuccessful: successful,
      webhooksFailed: failed,
      payload 
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: successful > 0 ? 200 : 500 }
  );
}

async function sendSingleWebhook(supabase: any, payload: any, id: string, type: string, webhookUrl: string, webhookName: string) {
  logStep(`Sending to ${webhookName}`, { id, type });

  // Ensure webhook URL is configured
  if (!webhookUrl) {
    logStep(`Missing webhook URL for ${webhookName}`);
    throw new Error(`Webhook URL not configured for ${webhookName}`);
  }

  // Log destination host for verification without leaking full URL
  try {
    const urlHost = new URL(webhookUrl).host;
    logStep(`Destination: ${urlHost}`, { webhookName });
  } catch (_) {
    logStep(`Invalid webhook URL format for ${webhookName}`);
  }

  // Send with retry logic
  let retryCount = 0;
  const MAX_RETRIES = 3;

  while (retryCount < MAX_RETRIES) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const respText = await response.text().catch(() => "");
      logStep(`${webhookName} response`, {
        status: response.status,
        bodyPreview: respText ? respText.slice(0, 200) : ""
      });

      if (response.ok) {
        logStep(`${webhookName} sent successfully`, { id, status: response.status });
        return { success: true, webhookName, status: response.status };
      }

      throw new Error(`${webhookName} failed with status ${response.status}`);
    } catch (err) {
      retryCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logStep(`${webhookName} attempt ${retryCount} failed`, { error: errorMessage });
      
      if (retryCount >= MAX_RETRIES) {
        // Log failure to database
        await supabase.from('webhook_failures').insert({
          booking_id: type === 'booking' ? id : null,
          webhook_url: webhookUrl,
          payload: payload,
          error_message: `${webhookName}: ${errorMessage}`,
          retry_count: retryCount
        });
        throw new Error(`${webhookName}: ${errorMessage}`);
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
    }
  }

  throw new Error(`${webhookName}: All retry attempts failed`);
}

// Legacy single webhook function for dispatch webhooks
async function sendWebhook(supabase: any, payload: any, id: string, type: string, webhookUrl: string) {
  return sendSingleWebhook(supabase, payload, id, type, webhookUrl, 'Zapier Dispatch')
    .then(result => {
      return new Response(
        JSON.stringify({ success: true, id, type, payload }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    })
    .catch(err => {
      return new Response(
        JSON.stringify({ error: err.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    });
}
