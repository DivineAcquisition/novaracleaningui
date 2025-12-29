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

// Service pricing configuration (cents)
const SERVICE_TIER_PRICING = {
  standard: 0,
  deep: 5000, // $50
  moveInOut: 12000, // $120
};

const ADD_ON_PRICING = {
  fridge: 3000, // $30
  oven: 3000, // $30
  windows: 4000, // $40
};

// Match frontend HOME_SIZE_RANGES IDs and prices (standardPrice * 100)
const HOME_SIZE_PRICING: Record<string, number> = {
  "0_999": 15000,
  "1000_1500": 18750,
  "1501_2000": 22500,
  "2001_2500": 26250,
  "2501_3000": 30000,
  "3001_3500": 33750,
  "3501_4000": 37500,
  "4001_4500": 41250,
  "4501_5000": 45000,
  "5000_plus": 0,
};

const DEPOSIT_AMOUNT = 3900; // $39
const NEW_CUSTOMER_DISCOUNT = 6000; // $60

// Membership discount on extras only
const MEMBERSHIP_DISCOUNTS: Record<string, number> = {
  monthly: 0.20,
  biweekly: 0.25,
  weekly: 0.30,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const bookingData = await req.json();
    logStep("Received booking data", { 
      serviceType: bookingData.serviceType,
      paymentOption: bookingData.paymentOption,
      membershipPlan: bookingData.membershipPlan,
      email: bookingData.email ? 'present' : 'missing',
    });

    // Validate required fields before proceeding
    if (!bookingData.email || !bookingData.homeSizeId) {
      logStep("Validation failed - missing required fields", {
        hasEmail: !!bookingData.email,
        hasHomeSizeId: !!bookingData.homeSizeId,
      });
      return new Response(
        JSON.stringify({ 
          error: "Missing required booking data",
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
    const basePrice = HOME_SIZE_PRICING[bookingData.homeSizeId as string] ?? 0;
    const serviceTierPrice = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING] ?? 0;

    // Prepare add-ons (Move-In/Out includes fridge & oven already)
    const incomingAddOns: string[] = Array.isArray(bookingData.addOns) ? bookingData.addOns : [];
    const relevantAddOns = bookingData.serviceType === 'moveInOut'
      ? incomingAddOns.filter((a) => a !== 'fridge' && a !== 'oven')
      : incomingAddOns;

    const addOnsTotal = relevantAddOns.reduce((sum, a) => sum + (ADD_ON_PRICING[a as keyof typeof ADD_ON_PRICING] ?? 0), 0);

    const subtotal = basePrice + serviceTierPrice + addOnsTotal;

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
    const newCustomerDiscount = (isNewCustomer && membershipPlan === 'none') ? NEW_CUSTOMER_DISCOUNT : 0;

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
        referralDiscountCents = 5000; // $50 discount
        referralCode = bookingData.referralCode;
        logStep("Valid referral code applied", { discount: referralDiscountCents, referrerEmail: referrer.email });
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

    // Determine amount to charge based on payment option
    // CRITICAL: Always charge at minimum $1 for card verification, even when using credit
    let amountToCharge = 0;
    let fullPaymentDiscount = 0;

    if (bookingData.paymentOption === 'full') {
      fullPaymentDiscount = Math.round(totalAmount * 0.10); // 10% off
      amountToCharge = totalAmount - fullPaymentDiscount;
      logStep("Full payment selected", { originalAmount: totalAmount, discount: fullPaymentDiscount, finalAmount: amountToCharge });
    } else {
      // Deposit payment - always require at least $1 minimum for card verification
      if (bookingData.useCredit) {
        amountToCharge = 100; // $1 minimum authorization to capture card
        logStep("Member using credit - $1 card authorization required", { depositAmount: amountToCharge });
      } else {
        amountToCharge = DEPOSIT_AMOUNT;
        logStep("Deposit payment", { depositAmount: amountToCharge });
      }
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

    // CRITICAL: Always create PaymentIntent - no bookings without payment verification
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountToCharge,
      currency: "usd",
      customer: customerId,
      automatic_payment_methods: {
        enabled: true,
      },
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
        logStep("Time slot reservation failed", { error: reserveError });
        return new Response(
          JSON.stringify({ 
            error: "This time slot just filled up. Please select another time.",
            code: "SLOT_UNAVAILABLE"
          }),
          { 
            status: 409, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          }
        );
      }

      logStep("Time slot reserved successfully");
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
        add_ons: relevantAddOns,
        service_date: bookingData.serviceDate,
        time_slot: bookingData.timeSlot,
        membership_plan: membershipPlan,
        uses_credit: bookingData.useCredit || false,
        base_price_cents: basePrice,
        deposit_cents: bookingData.paymentOption === 'deposit' ? (bookingData.useCredit ? 100 : DEPOSIT_AMOUNT) : 0,
        total_estimate_cents: totalAmount,
        payment_intent_id: paymentIntentId,
        customer_id: customerId,
        status: 'pending_payment', // CRITICAL: Always pending until payment verified
        payment_option: bookingData.paymentOption,
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
