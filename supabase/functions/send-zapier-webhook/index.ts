import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  getEstimatedHours,
  getSqftRange,
  getTeamSize,
} from "../_shared/payout-utils.ts";
import { syncBookingLifecycle, splitFullAddress } from "../_shared/ghl-client.ts";
import { buildGhlCustomFields } from "../_shared/ghl-field-map.ts";
import { mirrorToLeadConnector } from "../_shared/leadconnector-mirror.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Legacy ZAPIER_* / GHL_BOOKING_WEBHOOK_URL env vars are intentionally
// not read here — the user removed all Zapier outbound destinations on
// 2026-05-17. Only the GHL PIT API + LeadConnector inbound mirror are
// in use now.

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

  // Dispatch events used to fan out to a Zapier dispatch webhook —
  // removed 2026-05-17. Mirror to LeadConnector so GHL workflows can
  // pick the event up if needed; otherwise return the payload to the
  // caller (auto-dispatch / dispatch-job).
  try {
    await mirrorToLeadConnector({
      event: "job.dispatched",
      payload: {
        job_id: jobId,
        dispatch_payload: payload,
      },
    });
  } catch (mirrorErr) {
    logStep("LeadConnector mirror (dispatch) failed (non-critical)", mirrorErr);
  }
  return new Response(
    JSON.stringify({ success: true, jobId, payload }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
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
          pay_tier,
          pay_percentage,
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

    // Calculate estimated hours (still used for scheduling copy) and
    // payout under the revenue-share model. Pay = revenue × pay_pct /
    // teamSize (split across the team). The booking's stored
    // cleaner_payout_cents is the per-cleaner share once
    // complete-booking has finalized it; before that we compute on the
    // fly using the assigned cleaner's pay_percentage (or default 40%).
    const estimatedHours = booking.estimated_duration_hours || getEstimatedHours(booking.home_size_id);
    const teamSize = getTeamSize(booking.home_size_id);
    const revenueCents = booking.final_charge_cents || booking.total_estimate_cents || 0;
    const assignedPayPct = Number(booking.cleaners?.pay_percentage) || 40;
    const totalTeamPayoutCents = Math.floor((revenueCents * assignedPayPct) / 100);
    const perCleanerPayoutCents = booking.cleaner_payout_cents
      || Math.floor(totalTeamPayoutCents / Math.max(1, teamSize));
    const totalChargedCents = booking.final_charge_cents || booking.total_estimate_cents;
    const companyNetCents = totalChargedCents - totalTeamPayoutCents;

    // Calculate total discounts — single source of truth: base price
    // minus the discounted total. Catches the 50%-off promo, credit,
    // and any full-payment discount in one calculation. The old
    // separate-buckets math returned 0 for booking_number > 1 + non-
    // credit customers (the common case) which then propagated into
    // the legacy GHL inbound workflow and stomped on `discounted_amount_`.
    const baseForDiscount = booking.base_price_cents || 0;
    const totalForDiscount = booking.total_estimate_cents || 0;
    const totalDiscountCents = Math.max(0, baseForDiscount - totalForDiscount);
    const fullPaymentDiscount = booking.full_payment_discount || 0;

    // Fetch Stripe receipt URL for paid-in-full customers
    let paymentReceiptUrl = "";
    if (booking.payment_option === 'full' && booking.payment_intent_id) {
      try {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (stripeKey) {
          const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
          const paymentIntent = await stripe.paymentIntents.retrieve(booking.payment_intent_id, {
            expand: ['latest_charge'],
          });
          const charge = paymentIntent.latest_charge as Stripe.Charge;
          if (charge?.receipt_url) {
            paymentReceiptUrl = charge.receipt_url;
            logStep("Fetched Stripe receipt URL", { receiptUrl: paymentReceiptUrl.substring(0, 60) });
          }
        }
      } catch (stripeErr) {
        logStep("Error fetching Stripe receipt (non-critical)", { error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr) });
      }
    }

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
      "Assigned Cleaner Pay Rate": booking.cleaners
        ? `${booking.cleaners.pay_percentage || 40}% revenue share`
        : "",
      "Assigned Cleaner Total Pay": booking.cleaners
        ? formatCurrency(perCleanerPayoutCents)
        : "",
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
      "Invoice URL": booking.hosted_invoice_url || "",
      "Invoice Status": booking.hosted_invoice_url ? "Sent" : (booking.payment_option === 'full' ? "Paid in Full" : "N/A"),
      "Payment Receipt URL": paymentReceiptUrl,
      "Payment Status": getPaymentStatus(booking.status, booking.payment_option),
      "Deposit Type": mapDepositType(booking.payment_option, booking.deposit_cents, booking.total_estimate_cents),
      "Paid in Full": booking.payment_option === 'full',
      "Payment Method": booking.payment_method || "Card",
      
      // Team & Payout Information
      "Team Size": teamSize,
      "Cleaner Payout Per Cleaner": formatCurrency(perCleanerPayoutCents),
      "Total Team Payout": formatCurrency(totalTeamPayoutCents),
      "Company Net": formatCurrency(companyNetCents),
      "Tip": formatCurrency(booking.tip_cents || 0),
      
      // SDR & Intake Data
      "SDR Rep Name": booking.sdr_rep_name || "",
      "Num Cleaners Assigned": booking.num_cleaners_assigned || teamSize,
    };

  // ─── GHL Private Integration sync (parallel to webhooks) ──────────────────
  // Pushes the contact + booking opportunity into GHL using the PIT token.
  // Maps EVERY supplied custom field; fields the booking row doesn't
  // capture are sent as empty strings so the GHL contact record always
  // has a consistent shape.
  // Runs fire-and-forget: failures are logged but don't fail the request.
  try {
    // Collect up to 3 assigned cleaners (name + phone + pay rate) so
    // we can map to the 1)/2)/3) Contractor fields + assigned_cleaner
    // _pay_tier. Prefer job_assignments (multi-cleaner team), fall
    // back to booking.cleaners.
    const teamCleaners: Array<{ name?: string; phone?: string; payTier?: string | null; payRate?: number }> = [];
    if (booking.job_id) {
      const { data: assigns } = await supabase
        .from('job_assignments')
        .select('cleaners (first_name, last_name, phone, pay_tier, pay_percentage)')
        .eq('job_id', booking.job_id)
        .in('status', ['Offered', 'Confirmed', 'Assigned'])
        .limit(3);
      if (assigns && assigns.length > 0) {
        assigns.forEach((a: any) => {
          const c = a?.cleaners;
          if (c) {
            teamCleaners.push({
              name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
              phone: c.phone ?? undefined,
              payTier: c.pay_tier ?? null,
              payRate: Number(c.pay_percentage) || undefined,
            });
          }
        });
      }
    }
    if (teamCleaners.length === 0 && booking.cleaners) {
      teamCleaners.push({
        name: `${booking.cleaners.first_name} ${booking.cleaners.last_name}`,
        phone: booking.cleaners.phone,
        payTier: (booking.cleaners as any).pay_tier ?? null,
        payRate: Number((booking.cleaners as any).pay_percentage) || undefined,
      });
    }

    const totalChargedCentsForGhl = totalChargedCents;
    const depositCentsForGhl = booking.deposit_cents || 0;
    const remainingBalanceCents = booking.payment_option === 'deposit'
      ? Math.max(0, totalChargedCentsForGhl - depositCentsForGhl)
      : 0;

    // Attribution backfill — pull missing UTM fields from the latest
    // abandoned_cart row keyed by email. Per-field merge so a booking
    // with `utm_source` set but `utm_campaign` empty still gets the
    // campaign backfilled (the old all-or-nothing guard prevented this
    // and is the reason the user kept seeing UTM_* unmapped in GHL).
    try {
      const { data: cart } = await supabase
        .from('abandoned_carts')
        .select('utm_content, utm_medium, utm_campaign, utm_source, utm_term, landing_page, referrer, fbclid, gclid')
        .eq('email', booking.email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cart) {
        booking.utm_content  = booking.utm_content  || (cart as any).utm_content  || null;
        booking.utm_medium   = booking.utm_medium   || (cart as any).utm_medium   || null;
        booking.utm_campaign = booking.utm_campaign || (cart as any).utm_campaign || null;
        booking.utm_source   = booking.utm_source   || (cart as any).utm_source   || null;
        booking.utm_term     = booking.utm_term     || (cart as any).utm_term     || null;
        booking.landing_page = booking.landing_page || (cart as any).landing_page || null;
        booking.referrer     = booking.referrer     || (cart as any).referrer     || null;
        booking.fbclid       = booking.fbclid       || (cart as any).fbclid       || null;
        booking.gclid        = booking.gclid        || (cart as any).gclid        || null;
      }
    } catch (_) { /* tables may not exist yet — that's fine */ }

    // ── Pull Stripe + lifetime context for the mapper ────────────
    // Stripe is the source of truth for lifetime revenue + paid-job
    // count + payment-state. We:
    //   1. Look up the customer by email
    //   2. Sum ALL successful charges (lifetime revenue)
    //   3. Count successful charges (paid job count → average job value)
    //   4. Walk recent charges to detect last-failure / failure streak
    //   5. Generate a Stripe Payment Link for any outstanding balance
    //   6. Pull subscription state (paused / canceled / trialing)
    let defaultPaymentMethod: string | null = null;
    let lastPayment: { amountCents: number; date: string } | null = null;
    let failedPaymentCount: number | null = null;
    let stripeLifetimeRevenueCents: number | null = null;
    let stripePaidJobCount: number | null = null;
    let hasFailedPaymentRecently = false;
    let failedPaymentStreak = 0;
    let isMemberPaused = false;
    let isMemberTrialing = false;
    let isMemberCanceled = false;
    let paymentLinkUrl: string | null = null;
    let stripeCustomerIdForGhl: string | null = booking.customer_id || null;
    let stripeSubscriptionIdForGhl: string | null = membershipData?.subscription_id || null;
    try {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (stripeKey && booking.email) {
        const sk = new Stripe(stripeKey, { apiVersion: '2025-08-27.basil' as any });
        const customers = await sk.customers.list({ email: booking.email, limit: 1 });
        if (customers.data.length > 0) {
          const cus: any = customers.data[0];
          stripeCustomerIdForGhl = stripeCustomerIdForGhl || cus.id;

          // Default card brand+last4
          const pmRef = cus.invoice_settings?.default_payment_method;
          if (pmRef && typeof pmRef === 'object') {
            defaultPaymentMethod = `${pmRef.card?.brand || 'card'} ending ${pmRef.card?.last4 || '????'}`;
          } else if (typeof pmRef === 'string') {
            try {
              const pmObj: any = await sk.paymentMethods.retrieve(pmRef);
              defaultPaymentMethod = `${pmObj.card?.brand || 'card'} ending ${pmObj.card?.last4 || '????'}`;
            } catch (_) { /* ignore */ }
          } else {
            // Fall back to most recently attached card
            try {
              const pms = await sk.paymentMethods.list({ customer: cus.id, type: 'card', limit: 1 });
              if (pms.data.length > 0) {
                const pm: any = pms.data[0];
                defaultPaymentMethod = `${pm.card?.brand || 'card'} ending ${pm.card?.last4 || '????'}`;
              }
            } catch (_) { /* ignore */ }
          }

          // Lifetime revenue + paid count + failure streak. Iterate
          // pages until exhausted (capped at 500 charges) so even
          // long-tenured customers get accurate totals.
          let lifetimeCents = 0;
          let paidCount = 0;
          let streak = 0;
          let recentFailures = 0;
          let starting_after: string | undefined;
          let iter = 0;
          while (iter < 5) { // 5 × 100 = 500 charges max
            iter += 1;
            const page: any = await sk.charges.list({ customer: cus.id, limit: 100, starting_after });
            for (const ch of page.data as any[]) {
              if (ch.paid && ch.status === 'succeeded' && !ch.refunded) {
                const net = (ch.amount || 0) - (ch.amount_refunded || 0);
                if (net > 0) {
                  lifetimeCents += net;
                  paidCount += 1;
                  if (!lastPayment) {
                    lastPayment = { amountCents: net, date: new Date(ch.created * 1000).toISOString() };
                  }
                }
                // Successful charge breaks the failure streak.
                if (streak < 0) streak = 0;
              } else if (ch.status === 'failed') {
                recentFailures += 1;
                streak += 1;
                if (!hasFailedPaymentRecently) hasFailedPaymentRecently = true;
              }
            }
            if (!page.has_more) break;
            starting_after = page.data[page.data.length - 1]?.id;
            if (!starting_after) break;
          }
          stripeLifetimeRevenueCents = lifetimeCents;
          stripePaidJobCount = paidCount;
          failedPaymentCount = recentFailures;
          failedPaymentStreak = streak;

          // Active subscription state — paused / canceled / trialing.
          try {
            const subs: any = await sk.subscriptions.list({ customer: cus.id, status: 'all', limit: 5 });
            const activeSub: any = subs.data.find((s: any) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due' || s.status === 'paused');
            if (activeSub) {
              stripeSubscriptionIdForGhl = stripeSubscriptionIdForGhl || activeSub.id;
              if (activeSub.pause_collection) isMemberPaused = true;
              if (activeSub.status === 'trialing') isMemberTrialing = true;
            }
            const canceledSub = subs.data.find((s: any) => s.status === 'canceled');
            if (canceledSub && !activeSub) isMemberCanceled = true;
          } catch (_) { /* ignore */ }

          // Stripe Payment Link for outstanding balance — single-use,
          // amount = remaining balance + any fees. We use Payment Links
          // (not invoices) because they accept any card immediately
          // with no Stripe-side configuration overhead.
          const outstanding = Math.max(
            0,
            (booking.total_estimate_cents || 0) - (booking.deposit_cents || 0)
              + (booking.cancel_fee_cents || 0)
              + (booking.reschedule_fee_cents || 0),
          );
          if (outstanding > 0 && booking.status !== 'cancelled') {
            try {
              const price: any = await sk.prices.create({
                currency: 'usd',
                unit_amount: outstanding,
                product_data: { name: `NOV-${String(booking.booking_number).padStart(5, '0')} balance` },
              });
              const link: any = await sk.paymentLinks.create({
                line_items: [{ price: price.id, quantity: 1 }],
                metadata: { booking_id: booking.id, kind: 'balance' },
                after_completion: { type: 'redirect', redirect: { url: 'https://try.novaracleaning.com/account?payment=success' } },
              });
              paymentLinkUrl = link.url;
            } catch (linkErr) {
              logStep('Payment Link create failed (non-critical)', linkErr);
            }
          }
        }
      }
    } catch (stripeMapErr) {
      logStep('Stripe lookup for GHL mapper failed (non-critical)', stripeMapErr);
    }

    // Lifetime revenue (fallback) + completed count + first/last service
    // + ALL-BOOKINGS discount aggregate. One scan over the bookings
    // table covers all four numbers.
    let lifetimeRevenueCents: number | null = null;
    let lastServiceAt: string | null = null;
    let firstServiceAt: string | null = null;
    let completedBookingCount = 0;
    let allBookingsTotalDiscountCents = 0;
    try {
      const { data: allRows } = await supabase
        .from('bookings')
        .select('status, total_estimate_cents, final_charge_cents, base_price_cents, service_date')
        .eq('email', booking.email)
        .order('service_date', { ascending: false });
      if (allRows && allRows.length > 0) {
        const completed = allRows.filter((r: any) => r.status === 'completed');
        completedBookingCount = completed.length;
        if (completed.length > 0) {
          lifetimeRevenueCents = completed.reduce(
            (sum: number, r: any) => sum + (r.final_charge_cents || r.total_estimate_cents || 0),
            0,
          );
          lastServiceAt = (completed[0] as any).service_date || null;
          firstServiceAt = (completed[completed.length - 1] as any).service_date || null;
        }
        // Total Discount Given — running SUM across EVERY booking
        // (regardless of status) of (base_price - total_estimate).
        // Cancelled bookings still count toward the discount the
        // customer was offered.
        allBookingsTotalDiscountCents = allRows.reduce((sum: number, r: any) => {
          const d = Math.max(0, (r.base_price_cents || 0) - (r.total_estimate_cents || 0));
          return sum + d;
        }, 0);
      }
    } catch (_) { /* ignore */ }

    // Cancelled bookings count — feeds churn risk model.
    let cancelledBookingCount = 0;
    try {
      const { count } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('email', booking.email)
        .eq('status', 'cancelled');
      cancelledBookingCount = count || 0;
    } catch (_) { /* ignore */ }

    // Referral metrics — sum credits issued, count revenue generated
    // from bookings referred by this customer.
    let referralRevenueCents: number | null = null;
    let referralCreditCents: number | null = null;
    let referralName: string | null = null;
    if (booking.email) {
      try {
        const { data: rRows } = await supabase
          .from('referrals')
          .select('credit_cents, referred_email, referred_booking_id, status, redeemed_at')
          .eq('referrer_email', booking.email);
        if (rRows && rRows.length > 0) {
          referralCreditCents = rRows.reduce(
            (s: number, r: any) => s + (r.credit_cents || 0),
            0,
          );
          // Most-recent redeemed referred customer name = first email
          const redeemed = rRows.filter((r: any) => r.redeemed_at).sort(
            (a: any, b: any) => Date.parse(b.redeemed_at) - Date.parse(a.redeemed_at),
          );
          referralName = redeemed[0]?.referred_email || rRows[0].referred_email || null;
          // Revenue: sum total_estimate of bookings tied to these referrals
          const refBookingIds = rRows
            .map((r: any) => r.referred_booking_id)
            .filter(Boolean) as string[];
          if (refBookingIds.length > 0) {
            const { data: refBookings } = await supabase
              .from('bookings')
              .select('total_estimate_cents, final_charge_cents')
              .in('id', refBookingIds);
            referralRevenueCents = (refBookings || []).reduce(
              (s: number, r: any) => s + (r.final_charge_cents || r.total_estimate_cents || 0),
              0,
            );
          }
        }
      } catch (_) { /* ignore */ }
    }

    const referralLinkForGhl = customerData?.referral_code
      ? `https://try.novaracleaning.com/book/zip?ref=${customerData.referral_code}`
      : '';

    // ── Centralized 60+ field GHL custom-field bag ──────────────
    // buildGhlCustomFields covers Service & Scheduling, Billing &
    // Payments, Internal Sales, Ops/Dispatch, Customer Journey,
    // Referral, AGP Tracking, Membership, and Stripe identifiers.
    const ghlCustomFields = buildGhlCustomFields({
      // deno-lint-ignore no-explicit-any
      booking: booking as any,
      cleaners: teamCleaners,
      lastPayment,
      lastServiceAt,
      firstServiceAt,
      lifetimeRevenueCents,
      completedBookingCount,
      cancelledBookingCount,
      failedPaymentCount,
      stripeCustomerId: stripeCustomerIdForGhl,
      stripeSubscriptionId: stripeSubscriptionIdForGhl,
      isMemberPaused,
      isMemberTrialing,
      isMemberCanceled,
      hasFailedPaymentRecently,
      failedPaymentStreak,
      stripeLifetimeRevenueCents,
      stripePaidJobCount,
      allBookingsTotalDiscountCents,
      paymentLinkUrl,
      defaultPaymentMethod,
      referralCode: customerData?.referral_code || null,
      referralLink: referralLinkForGhl,
      referralName,
      referralRevenueCents,
      referralCreditCents,
      publicOrigin: 'https://try.novaracleaning.com',
    });
    logStep("GHL custom fields built", { keys: Object.keys(ghlCustomFields).length });

    // Defensive split of the booking address — guarantees that
    // GHL's `address1` only contains the street even if a legacy row
    // stored the full string in that column, and that City / State /
    // ZIP are populated from whatever source we have.
    const splitAddr = splitFullAddress(booking.address || "");
    const ghlAddress1 = splitAddr.street || booking.address || "";
    const ghlCity = booking.city || splitAddr.city || "";
    const ghlState = booking.state || splitAddr.state || "";
    const ghlZip = booking.zip_code || splitAddr.zipCode || "";

    // syncBookingLifecycle upserts the contact AND patches the existing
    // opportunity for that contact (status + name + monetary + custom
    // fields). Falls back to creating an opportunity only if none
    // exists yet. This is the single point that keeps GHL in lockstep
    // with every booking mutation we run (payment, assignment, cleaner
    // accept, complete, cancel, reschedule, modify) — none of those
    // paths produce duplicate opportunities anymore.
    const ghlResult = await syncBookingLifecycle({
      contact: {
        email: booking.email,
        phone: booking.phone,
        firstName: booking.first_name,
        lastName: booking.last_name,
        address1: ghlAddress1,
        city: ghlCity,
        state: ghlState,
        postalCode: ghlZip,
        source: "Novara Booking",
        tags: [
          "booking",
          `service-${booking.service_type}`,
          booking.membership_plan && booking.membership_plan !== 'none'
            ? `member-${booking.membership_plan}`
            : null,
          booking.zip_code ? `zip-${booking.zip_code}` : null,
        ].filter(Boolean) as string[],
        customFieldsByKey: ghlCustomFields,
      },
      opportunity: {
        name: `NOV-${String(booking.booking_number).padStart(5, '0')} — ${booking.first_name} ${booking.last_name}`,
        status: booking.status === 'cancelled' ? 'lost' : booking.status === 'completed' ? 'won' : 'open',
        monetaryValue: Math.round(totalChargedCentsForGhl / 100),
        source: "Novara Booking",
        // The opportunity gets the same full custom-field map so all 18
        // fields appear on the booking record in GHL as well as on the
        // contact record.
        customFieldsByKey: ghlCustomFields,
      },
    });
    logStep("GHL PIT sync complete", ghlResult);

    // Stamp the booking row as synced so the reconcile cron + the
    // notify_ghl_sync trigger know not to refire. We use the special
    // sync-only column set so the trigger's "only sync columns
    // changed" guard short-circuits and does NOT recurse.
    try {
      await supabase
        .from("bookings")
        .update({
          ghl_synced_at: new Date().toISOString(),
          ghl_sync_attempts: (booking.ghl_sync_attempts || 0) + 1,
          ghl_sync_error: null,
        })
        .eq("id", booking.id);
    } catch (stampErr) {
      logStep("ghl_synced_at stamp failed (non-critical)", {
        error: stampErr instanceof Error ? stampErr.message : String(stampErr),
      });
    }

    // Log success row in ghl_sync_log so admins / reconciliation can
    // see exactly when each booking was last refreshed.
    try {
      await supabase.from("ghl_sync_log").insert({
        booking_id: booking.id,
        source: "edge_function",
        trigger_op: "sync",
        succeeded: true,
        http_status: 200,
      });
    } catch (_) { /* best effort */ }

    // ─── LeadConnector inbound webhook mirror ────────────────────────
    // Always-on backup: send the structured payload plus the same
    // contact + opportunity bundle to the user's GHL inbound webhook.
    // This is the safety net — if the PIT call above silently dropped
    // a field (or the PIT creds are misconfigured), the GHL workflow
    // attached to this inbound URL still receives every booking.
    await mirrorToLeadConnector({
      event: `booking.${booking.status || "update"}`,
      payload: {
        booking_id: booking.id,
        booking_number: booking.booking_number,
        // Structured contact fields (mirrors GHL's expected shape)
        first_name: booking.first_name,
        last_name: booking.last_name,
        full_name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim(),
        email: booking.email,
        phone: booking.phone,
        address1: ghlAddress1,
        city: ghlCity,
        state: ghlState,
        postal_code: ghlZip,
        country: "US",
        // Full Zapier-shaped payload (every field the GHL automation
        // might need — service, scheduling, payment, attribution…)
        booking_payload: payload,
        // Same custom-field map sent to the GHL PIT, keyed by fieldKey
        custom_fields: ghlCustomFields,
        // Cleaner team summary
        cleaners: teamCleaners,
        // Opportunity intent
        opportunity: {
          name: `NOV-${String(booking.booking_number).padStart(5, "0")} — ${booking.first_name} ${booking.last_name}`,
          status: booking.status === "cancelled" ? "lost"
            : booking.status === "completed" ? "won"
            : "open",
          monetary_value: Math.round(totalChargedCentsForGhl / 100),
          source: "Novara Booking",
        },
      },
    });
  } catch (ghlErr) {
    const errMsg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
    logStep("GHL PIT sync failed (non-blocking)", { error: errMsg });
    // Record the failure so reconcile-ghl can retry on its next pass.
    try {
      await supabase
        .from("bookings")
        .update({
          ghl_sync_attempts: (booking.ghl_sync_attempts || 0) + 1,
          ghl_sync_error: errMsg.slice(0, 500),
        })
        .eq("id", booking.id);
      await supabase.from("ghl_sync_log").insert({
        booking_id: booking.id,
        source: "edge_function",
        trigger_op: "sync",
        succeeded: false,
        error_message: errMsg.slice(0, 500),
      });
    } catch (_) { /* best effort */ }
  }

  // GHL PIT lifecycle sync + LeadConnector inbound mirror are the
  // ONLY GHL destinations (both already executed above). Legacy
  // Zapier outbound webhooks have been removed per the user's
  // 2026-05-17 request: 'you can get rid of zapier webhook setup,
  // I no longer need it.'
  return new Response(
    JSON.stringify({
      success: true,
      bookingId,
      ghl_sync: "ok",
      payload,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
}

// sendSingleWebhook / sendWebhook helpers were removed 2026-05-17 when
// the Zapier outbound destinations were retired. GHL PIT + LeadConnector
// mirror are the only outbound paths now.
