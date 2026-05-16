import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { 
  getEstimatedHours, 
  calculateCleanerPayout,
  DEFAULT_CLEANER_HOURLY_RATE_CENTS 
} from "../_shared/payout-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PAYMENT-INTENT] ${step}${detailsStr}`);
};

// ─── v2.0 Pricing (cents) ────────────────────────────────
// Deep = Standard × 1.5 | Move-In/Out = Standard × 2.0
// Combo = Standard + Deep = 2.5× standard (the "Deep + Standard
// Combo" bundle: initial Deep Clean + a follow-up Standard Clean
// within 14 days, scheduled on /book/details after deposit).
const SERVICE_TIER_MULTIPLIERS: Record<string, number> = {
  standard: 1.0,
  deep: 1.5,
  combo: 2.5,
  moveInOut: 2.0,
};

const ADD_ON_PRICING: Record<string, number> = {
  fridge: 3000, // $30
  oven: 3000, // $30
  windows: 4000, // $40
};

// Zone B base standard clean prices in cents (v3.3 — even-dollar bases
// so post-50%-off totals land on clean numbers with no rounding drift
// between offer card and checkout summary; deep at ×1.5 hits the $225
// floor exactly at the smallest home size).
const HOME_SIZE_PRICING: Record<string, number> = {
  "0_999": 30000,
  "1000_1500": 38000,
  "1501_2000": 48000,
  "2001_2500": 56000,
  "2501_3000": 68000,
  "3001_3500": 76000,
  "3501_4000": 88000,
  "4001_4500": 98000,
  "4501_5000": 108000,
  "5000_plus": 0,
};

// Deposit is now 50% of the booking total — no more flat $39 down.
const DEPOSIT_PERCENT = 0.5;
// New-customer discount is now 50% off subtotal (was a flat $60).
const NEW_CUSTOMER_DISCOUNT_PERCENT = 0.5;

// Membership discount on extras only
const MEMBERSHIP_DISCOUNTS: Record<string, number> = {
  monthly: 0.15,
  biweekly: 0.25,
  weekly: 0.35,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Parse and normalize the request body - support multiple payload shapes
    const rawBody = await req.json();
    
    // Support both direct booking data AND wrapped { bookingData: {...} } format
    const bookingData = rawBody.bookingData || rawBody;
    
    // Normalize email field - accept both 'email' and 'customerEmail'
    const customerEmail = (bookingData.email || bookingData.customerEmail || rawBody.email || rawBody.customerEmail || '').trim();
    
    logStep("Received booking data", { 
      serviceType: bookingData.serviceType,
      paymentOption: bookingData.paymentOption,
      membershipPlan: bookingData.membershipPlan,
      hasEmail: !!customerEmail,
      hasCustomerEmail: !!bookingData.customerEmail,
      hasRawEmail: !!rawBody.email,
      hasHomeSizeId: !!bookingData.homeSizeId,
    });

    // Normalize the email field for downstream use
    bookingData.email = customerEmail;

    // Validate required fields before proceeding
    if (!customerEmail || !bookingData.homeSizeId) {
      logStep("Validation failed - missing required fields", {
        hasEmail: !!customerEmail,
        hasHomeSizeId: !!bookingData.homeSizeId,
        receivedKeys: Object.keys(bookingData),
      });
      return new Response(
        JSON.stringify({ 
          error: "Missing required booking data",
          details: !customerEmail ? "Email is required" : "Home size is required",
          code: "VALIDATION_ERROR" 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Calculate pricing to match frontend logic (values in cents)
    // v2.0: Deep = Standard × 1.5, Move-In/Out = Standard × 2.0
    const baseStandardPrice = HOME_SIZE_PRICING[bookingData.homeSizeId as string];
    if (baseStandardPrice === undefined) {
      logStep("Invalid home size ID", { homeSizeId: bookingData.homeSizeId, validIds: Object.keys(HOME_SIZE_PRICING) });
      return new Response(
        JSON.stringify({ 
          error: "Invalid home size selected",
          details: "Please go back and select a valid home size.",
          code: "INVALID_HOME_SIZE" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Apply service tier multiplier
    const tierMultiplier = SERVICE_TIER_MULTIPLIERS[bookingData.serviceType as string] ?? 1.0;
    const basePrice = Math.round(baseStandardPrice * tierMultiplier);
    const serviceTierPrice = basePrice - baseStandardPrice; // The addition from the tier

    // Prepare add-ons (Move-In/Out includes fridge & oven already)
    const incomingAddOns: string[] = Array.isArray(bookingData.addOns) ? bookingData.addOns : [];
    const relevantAddOns = bookingData.serviceType === 'moveInOut'
      ? incomingAddOns.filter((a) => a !== 'fridge' && a !== 'oven')
      : incomingAddOns;

    const addOnsTotal = relevantAddOns.reduce((sum, a) => sum + (ADD_ON_PRICING[a] ?? 0), 0);

    const subtotal = basePrice + addOnsTotal;

    // Membership discount applies only to extras (service addition + add-ons) and only if not using credit
    const membershipPlan: string = bookingData.membershipPlan || 'none';
    const extras = serviceTierPrice + addOnsTotal;
    const membershipPct = (!bookingData.useCredit && MEMBERSHIP_DISCOUNTS[membershipPlan]) ? MEMBERSHIP_DISCOUNTS[membershipPlan] : 0;
    const membershipDiscount = Math.round(extras * membershipPct);

    // Check booking history to determine booking number and new customer status
    const { data: previousBookings } = await supabaseClient
      .from('bookings')
      .select('id, status')
      .eq('email', bookingData.email)
      .in('status', ['confirmed', 'completed'])
      .order('created_at', { ascending: false });
    
    const bookingNumber = (previousBookings?.length || 0) + 1;
    const isNewCustomer = bookingNumber === 1;
    // 50% promo — applied to every Standard, Deep, and Combo
    // (Deep+Standard) one-time booking. Previously gated on
    // isNewCustomer (queried from past booking history) but that
    // produced visible inconsistencies for repeat / test customers:
    // the offer card showed the discounted price (computed with
    // isNewCustomer=true for display) and then the server returned an
    // un-discounted total, charging double the expected deposit. The
    // 50% off is now a flat acquisition promo so the offer card,
    // checkout summary, and Stripe Pay button always agree to the cent.
    // Members + Move-In/Out are still excluded — they have their own
    // discount tiers. `isNewCustomer` is still computed above for
    // booking-row reporting + downstream metadata.
    void isNewCustomer;
    const promoEligible =
      membershipPlan === 'none' &&
      (bookingData.serviceType === 'standard' ||
       bookingData.serviceType === 'deep' ||
       bookingData.serviceType === 'combo');
    const newCustomerDiscount = promoEligible
      ? Math.round(subtotal * NEW_CUSTOMER_DISCOUNT_PERCENT)
      : 0;

    // Validate referral code if provided
    let referralDiscountCents = 0;
    let referralCode = '';
    if (bookingData.referralCode) {
      logStep("Validating referral code", { code: bookingData.referralCode });
      const { data: referrer } = await supabaseClient
        .from('customers')
        .select('id, email')
        .eq('referral_code', bookingData.referralCode)
        .maybeSingle();

      if (referrer && referrer.email !== bookingData.email) {
        // Referral reward is now 50% off the post-membership subtotal (replaces $50 flat).
        const referralBase = Math.max(0, subtotal - membershipDiscount);
        referralDiscountCents = Math.round(referralBase * 0.5);
        referralCode = bookingData.referralCode;
        logStep("Valid referral code applied (50% off)", { discount: referralDiscountCents, referrerEmail: referrer.email });
      } else if (referrer && referrer.email === bookingData.email) {
        logStep("Referral code rejected - cannot refer yourself");
      } else {
        logStep("Invalid referral code");
      }
    }

    // Calculate credit coverage and cleaner costs BEFORE promo validation
    const creditCoverage = bookingData.useCredit ? Math.min(basePrice, 15000) : 0;
    const estimatedHours = getEstimatedHours(bookingData.homeSizeId as string);
    const cleanerHourlyRateCents = DEFAULT_CLEANER_HOURLY_RATE_CENTS;
    const cleanerPayoutCents = calculateCleanerPayout(estimatedHours, cleanerHourlyRateCents);

    // Validate promo code if provided
    let promoDiscountCents = 0;
    let promoCode = '';
    if (bookingData.promoCode) {
      logStep("Validating promo code", { code: bookingData.promoCode });
      
      const { data: promo, error: promoError } = await supabaseClient
        .from('promo_codes')
        .select('*')
        .eq('code', bookingData.promoCode.toUpperCase())
        .eq('active', true)
        .single();

      if (!promoError && promo) {
        // Check expiration
        const isExpired = promo.expires_at && new Date(promo.expires_at) < new Date();
        
        // Check customer eligibility
        const eligibleForPromo = 
          promo.applies_to === 'all' ||
          (promo.applies_to === 'new_customers' && isNewCustomer) ||
          (promo.applies_to === 'returning_customers' && !isNewCustomer);

        // Check usage limits
        const withinTotalLimit = !promo.max_total_uses || promo.total_uses < promo.max_total_uses;
        
        // Check per-customer usage
        let withinCustomerLimit = true;
        if (promo.max_uses_per_customer) {
          const { data: customerUsage } = await supabaseClient
            .from('bookings')
            .select('id')
            .eq('email', bookingData.email)
            .ilike('team_notes', `%PROMO:${bookingData.promoCode.toUpperCase()}%`);
          
          withinCustomerLimit = !customerUsage || customerUsage.length < promo.max_uses_per_customer;
        }

        if (!isExpired && eligibleForPromo && withinTotalLimit && withinCustomerLimit) {
          // Calculate discount
          if (promo.type === 'percent') {
            promoDiscountCents = Math.round((subtotal * promo.value) / 100);
          } else {
            promoDiscountCents = promo.value * 100; // Convert dollars to cents
          }

          // Validate profit margin
          const tempTotal = subtotal - membershipDiscount - newCustomerDiscount - creditCoverage - referralDiscountCents - promoDiscountCents;
          const profitMargin = (tempTotal - cleanerPayoutCents) / tempTotal;
          const minMargin = (promo.min_profit_margin_percent || 20) / 100;

          if (profitMargin >= minMargin) {
            promoCode = bookingData.promoCode.toUpperCase();
            logStep("Valid promo code applied", { 
              discount: promoDiscountCents, 
              promoCode,
              profitMargin: Math.round(profitMargin * 100) + '%'
            });
          } else {
            logStep("Promo code rejected - insufficient profit margin", { 
              requiredMargin: minMargin,
              actualMargin: profitMargin 
            });
            promoDiscountCents = 0;
          }
        } else {
          logStep("Promo code not eligible", { 
            isExpired, 
            eligibleForPromo, 
            withinTotalLimit, 
            withinCustomerLimit 
          });
        }
      } else {
        logStep("Invalid promo code");
      }
    }

    logStep("Customer booking history", { 
      bookingNumber, 
      isNewCustomer, 
      previousBookings: previousBookings?.length || 0, 
      newCustomerDiscount, 
      referralDiscountCents,
      promoDiscountCents 
    });

    let totalAmount = subtotal - membershipDiscount - newCustomerDiscount - creditCoverage - referralDiscountCents - promoDiscountCents;
    if (totalAmount < 0) totalAmount = 0;
    logStep("Base calculation", { subtotal, membershipDiscount, newCustomerDiscount, creditCoverage, referralDiscountCents, promoDiscountCents, totalAmount });

    const platformFeeCents = totalAmount - cleanerPayoutCents;
    
    logStep("Payout calculation (hourly-based)", { 
      estimatedHours, 
      hourlyRate: cleanerHourlyRateCents / 100,
      cleanerPayoutCents, 
      platformFeeCents,
      totalAmount 
    });

    // Determine amount to charge.
    //
    // Customer-facing UX has retired the "Pay in Full" option entirely;
    // every customer pays a 50% deposit at booking and the remaining 50%
    // is auto-charged after the cleaner marks complete (see complete-
    // booking). To stop a stale `bookingData.paymentOption === 'full'`
    // (e.g. persisted from before the toggle was removed, or set by
    // a future admin tool) from accidentally charging the full amount,
    // we IGNORE 'full' here and force deposit unless the request comes
    // in for a member booking using their cleaning credit.
    //
    // `useCredit: true` still charges the $1 card-verification minimum
    // so the saved card can be auto-charged later if the credit is
    // already exhausted.
    let amountToCharge = 0;
    let fullPaymentDiscount = 0;

    if (bookingData.useCredit) {
      amountToCharge = 100; // $1 minimum authorization to capture card
      logStep("Member using credit - $1 card authorization required", { depositAmount: amountToCharge });
    } else {
      amountToCharge = Math.max(100, Math.round(totalAmount * DEPOSIT_PERCENT));
      logStep("50% deposit payment (paymentOption='full' ignored if sent)", {
        depositAmount: amountToCharge,
        totalAmount,
        clientSentPaymentOption: bookingData.paymentOption,
      });
    }

    // Check if customer exists in Stripe
    const customers = await stripe.customers.list({
      email: bookingData.email,
      limit: 1,
    });

    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing customer", { customerId });
    } else {
      const customer = await stripe.customers.create({
        email: bookingData.email,
        name: `${bookingData.firstName} ${bookingData.lastName}`,
        phone: bookingData.phone,
      });
      customerId = customer.id;
      logStep("Created new customer", { customerId });
    }

    // CRITICAL: Always create PaymentIntent — no bookings without payment verification.
    // `setup_future_usage: 'off_session'` attaches the PaymentMethod to the
    // Stripe Customer so the remaining balance can be auto-charged after the
    // cleaner marks the service complete (see complete-booking). The card is
    // saved for one-time bookings *and* deposit bookings — that way the
    // post-service auto-charge works regardless of payment option.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountToCharge,
      currency: "usd",
      customer: customerId,
      automatic_payment_methods: {
        enabled: true,
      },
      setup_future_usage: "off_session",
      metadata: {
        serviceType: bookingData.serviceType,
        homeSizeId: bookingData.homeSizeId,
        serviceDate: bookingData.serviceDate,
        timeSlot: bookingData.timeSlot,
        paymentOption: bookingData.paymentOption,
        bookingNumber: String(bookingNumber),
        isNewCustomer: String(isNewCustomer),
        referralCode: referralCode || '',
        promoCode: promoCode || '',
      },
    });

    const paymentIntentId = paymentIntent.id;
    const clientSecret = paymentIntent.client_secret;
    logStep("Created payment intent", { paymentIntentId, amount: amountToCharge, bookingNumber });

    // Reserve the time slot before creating booking
    if (bookingData.startTime && bookingData.endTime) {
      logStep("Attempting to reserve time slot", { 
        date: bookingData.serviceDate, 
        startTime: bookingData.startTime,
        endTime: bookingData.endTime 
      });

      // Ensure the time slot exists (upsert)
      await supabaseClient
        .from('availability_slots')
        .upsert({
          service_date: bookingData.serviceDate,
          time_slot: bookingData.timeSlot,
          start_time: bookingData.startTime,
          end_time: bookingData.endTime,
          max_capacity: 5,
          current_bookings: 0
        }, { 
          onConflict: 'service_date,start_time',
          ignoreDuplicates: true 
        });

      const { data: reserved, error: reserveError } = await supabaseClient
        .rpc('reserve_time_slot', {
          _date: bookingData.serviceDate,
          _start_time: bookingData.startTime,
          _end_time: bookingData.endTime
        });

      if (reserveError || !reserved) {
        logStep("Warning: slot reservation failed, continuing with payment", { error: reserveError });
      } else {
        logStep("Time slot reserved successfully");
      }
    } else {
      logStep("Warning: startTime/endTime not provided, skipping slot reservation");
    }

    // Store provisional booking in database - ALWAYS as pending_payment
    const { data: booking, error: bookingError } = await supabaseClient
      .from("bookings")
      .insert({
        email: bookingData.email,
        first_name: bookingData.firstName,
        last_name: bookingData.lastName,
        phone: bookingData.phone,
        address: bookingData.address || '',
        city: bookingData.city || '',
        state: bookingData.state || '',
        zip_code: bookingData.zipCode,
        home_size_id: bookingData.homeSizeId,
        service_type: bookingData.serviceType,
        offer_type: bookingData.serviceType, // 'combo' / 'standard' / 'deep' — used by reports + GHL sync
        add_ons: relevantAddOns,
        service_date: bookingData.serviceDate,
        time_slot: bookingData.timeSlot,
        membership_plan: membershipPlan,
        uses_credit: bookingData.useCredit || false,
        base_price_cents: basePrice,
        deposit_cents: bookingData.paymentOption === 'deposit'
          ? (bookingData.useCredit ? 100 : amountToCharge)
          : 0,
        total_estimate_cents: totalAmount,
        payment_intent_id: paymentIntentId,
        customer_id: customerId,
        status: 'pending_payment', // CRITICAL: Always pending until payment verified
        // Always 'deposit' for customer-facing bookings — see comment
        // on amountToCharge above. Members using credit are also
        // recorded as 'deposit' since the $1 authorization is
        // functionally a deposit hold.
        payment_option: 'deposit',
        full_payment_discount: fullPaymentDiscount,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        payout_status: 'pending',
        booking_number: bookingNumber,
        estimated_duration_hours: estimatedHours,
        cleaner_hourly_rate_cents: cleanerHourlyRateCents,
        team_notes: referralCode 
          ? `Referral code used: ${referralCode}${promoCode ? ` | Promo code: PROMO:${promoCode}` : ''}`
          : (promoCode ? `Promo code: PROMO:${promoCode}` : null),

        // ─── Attribution tracking (AlphaLux-style) ──────────────────
        // The client captures UTM / landing / referrer in localStorage
        // via UTMTracker, then posts the bag here at booking creation.
        // We store the full JSON in `tracking` plus the most-queried
        // fields in dedicated columns so admin reports can SQL-filter
        // without digging into JSONB.
        tracking: bookingData.tracking || null,
        utm_source: bookingData.utmSource || bookingData.tracking?.utm_source || null,
        utm_medium: bookingData.utmMedium || bookingData.tracking?.utm_medium || null,
        utm_campaign: bookingData.utmCampaign || bookingData.tracking?.utm_campaign || null,
        utm_content: bookingData.utmContent || bookingData.tracking?.utm_content || null,
        utm_term: bookingData.utmTerm || bookingData.tracking?.utm_term || null,
        landing_page: bookingData.landingPage || bookingData.tracking?.landing_page || null,
        referrer: bookingData.referrer || bookingData.tracking?.referrer || null,
        fbclid: bookingData.fbclid || bookingData.tracking?.fbclid || null,
        gclid: bookingData.gclid || bookingData.tracking?.gclid || null,
        first_visit_at: bookingData.firstVisitTimestamp || bookingData.tracking?.first_visit_timestamp || null,
      })
      .select()
      .single();

    if (bookingError) {
      logStep("Error creating booking", { error: bookingError });
      throw bookingError;
    }

    logStep("Booking created successfully", { bookingId: booking.id });

    return new Response(
      JSON.stringify({
        clientSecret,
        amount: amountToCharge,
        bookingId: booking.id,
        requiresPayment: true, // ALWAYS true - no bookings without payment verification
        bookingNumber,
        isNewCustomer,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error in create-payment-intent", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
