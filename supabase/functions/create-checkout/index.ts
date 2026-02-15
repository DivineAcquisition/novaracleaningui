import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

// ─── V2 Pricing Constants ───────────────────────────────
const HOME_SIZE_PRICING = [
  { id: '0_999',     basePrice: 150 },
  { id: '1000_1500', basePrice: 189 },
  { id: '1501_2000', basePrice: 239 },
  { id: '2001_2500', basePrice: 279 },
  { id: '2501_3000', basePrice: 339 },
  { id: '3001_3500', basePrice: 379 },
  { id: '3501_4000', basePrice: 439 },
  { id: '4001_4500', basePrice: 489 },
  { id: '4501_5000', basePrice: 539 },
];

const SERVICE_PRICING = {
  standard:  { label: 'Standard Cleaning', multiplier: 1.0 },
  deep:      { label: 'Deep Cleaning',     multiplier: 1.5 },
  moveInOut: { label: 'Move-In/Out Cleaning', multiplier: 2.0 },
};

const ADD_ON_PRICING = {
  fridge:   { label: 'Inside Fridge', price: 30 },
  oven:     { label: 'Inside Oven',   price: 30 },
  windows:  { label: 'Interior Windows', price: 40 },
};

// V2 Membership pricing lookup (Zone B) — monthly price in dollars
const MEMBERSHIP_PRICES: Record<string, { monthly: number; biweekly: number; weekly: number }> = {
  '0_999':     { monthly: 129, biweekly: 199, weekly: 349 },
  '1000_1500': { monthly: 159, biweekly: 249, weekly: 449 },
  '1501_2000': { monthly: 199, biweekly: 319, weekly: 569 },
  '2001_2500': { monthly: 229, biweekly: 369, weekly: 659 },
  '2501_3000': { monthly: 279, biweekly: 449, weekly: 799 },
  '3001_3500': { monthly: 319, biweekly: 499, weekly: 899 },
  '3501_4000': { monthly: 369, biweekly: 579, weekly: 1039 },
  '4001_4500': { monthly: 409, biweekly: 649, weekly: 1159 },
  '4501_5000': { monthly: 459, biweekly: 719, weekly: 1279 },
};

const MEMBERSHIP_PLAN_LABELS: Record<string, string> = {
  monthly: 'Glow Monthly (1x/mo)',
  biweekly: 'Glow Bi-Weekly (2x/mo)',
  weekly: 'Glow Weekly (4x/mo)',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");
    
    const body = await req.json();
    
    // ─── STANDALONE SUBSCRIPTION PATH ───────────────────
    if (body.mode === 'subscription' && body.membershipPlan && body.homeSizeId) {
      logStep("Standalone subscription path", { plan: body.membershipPlan, homeSize: body.homeSizeId });
      
      const { membershipPlan, homeSizeId, email: bodyEmail } = body;
      
      const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
        apiVersion: "2025-08-27.basil",
      });

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? ""
      );

      // Get user email from auth token
      let email = bodyEmail;
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const { data } = await supabase.auth.getUser(token);
        if (data?.user?.email) {
          email = data.user.email;
        }
      }

      if (!email) {
        return new Response(
          JSON.stringify({ error: "Email required for subscription" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      // Look up membership price
      const prices = MEMBERSHIP_PRICES[homeSizeId];
      if (!prices) {
        return new Response(
          JSON.stringify({ error: `Invalid home size: ${homeSizeId}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const planKey = membershipPlan as keyof typeof prices;
      const monthlyPriceDollars = prices[planKey];
      if (!monthlyPriceDollars) {
        return new Response(
          JSON.stringify({ error: `Invalid membership plan: ${membershipPlan}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const planLabel = MEMBERSHIP_PLAN_LABELS[membershipPlan] || membershipPlan;
      const homePricing = HOME_SIZE_PRICING.find(h => h.id === homeSizeId);
      const sqftLabel = homePricing ? homeSizeId.replace('_', '-') : homeSizeId;

      // Check for existing Stripe customer
      const customers = await stripe.customers.list({ email, limit: 1 });
      const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        // Recurring subscription
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Novara Membership — ${planLabel}`,
              description: `Recurring cleaning membership for ${sqftLabel} sq ft home`,
            },
            recurring: { interval: 'month' },
            unit_amount: monthlyPriceDollars * 100,
          },
          quantity: 1,
        },
        // One-time $75 deep clean surcharge for first month
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'First Clean Deep Clean Surcharge',
              description: 'One-time mandatory deep clean for new members (+$75)',
            },
            unit_amount: 7500,
          },
          quantity: 1,
        },
      ];

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : email,
        line_items: lineItems,
        mode: 'subscription',
        success_url: `${req.headers.get("origin")}/membership/success?session_id={CHECKOUT_SESSION_ID}&plan=${membershipPlan}`,
        cancel_url: `${req.headers.get("origin")}/membership/${membershipPlan}`,
        metadata: {
          membership_plan: membershipPlan,
          home_size_id: homeSizeId,
          is_membership_signup: 'true',
          monthly_price_cents: String(monthlyPriceDollars * 100),
        },
      });

      logStep("Subscription checkout created", { sessionId: session.id });

      return new Response(
        JSON.stringify({ url: session.url, sessionId: session.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ─── BOOKING CHECKOUT PATH (existing) ───────────────
    const { bookingData } = body;
    logStep("Booking data received", { 
      serviceType: bookingData.serviceType, 
      homeSizeId: bookingData.homeSizeId,
      membershipPlan: bookingData.membershipPlan,
      useCredit: bookingData.useCredit 
    });

    const {
      homeSizeId,
      serviceType,
      addOns = [],
      membershipPlan,
      useCredit,
      email,
      firstName,
      lastName,
      phone,
      address,
      city,
      state,
      zipCode,
      serviceDate,
      timeSlot
    } = bookingData;

    // === SERVER-SIDE VALIDATION ===
    const validationErrors: string[] = [];
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) validationErrors.push("Valid email is required");
    if (!firstName || firstName.trim().length < 2) validationErrors.push("First name must be at least 2 characters");
    if (!lastName || lastName.trim().length < 2) validationErrors.push("Last name must be at least 2 characters");
    if (!phone || !/^\d{10}$/.test(phone.replace(/\D/g, ''))) validationErrors.push("Valid 10-digit phone number is required");
    if (!address || address.trim().length < 5) validationErrors.push("Complete street address is required");
    if (address && !/\d+/.test(address)) validationErrors.push("Address must include a street number");
    if (!city || city.trim().length < 2) validationErrors.push("Valid city name is required");
    if (!state || !/^[A-Z]{2}$/i.test(state)) validationErrors.push("Valid 2-letter state code is required");
    if (!zipCode || !/^\d{5}$/.test(zipCode)) validationErrors.push("Valid 5-digit ZIP code is required");
    if (!homeSizeId) validationErrors.push("Home size selection is required");
    if (!serviceType) validationErrors.push("Service type is required");
    if (!serviceDate) validationErrors.push("Service date is required");
    if (!timeSlot) validationErrors.push("Time slot is required");
    
    if (validationErrors.length > 0) {
      logStep("Validation failed", { errors: validationErrors });
      return new Response(
        JSON.stringify({ error: "Validation failed", details: validationErrors }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    logStep("Validation passed");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const isMemberUsingCredit = useCredit === true;
    
    // Check for existing Stripe customer
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    // Get base price for home size
    const homePricing = HOME_SIZE_PRICING.find(h => h.id === homeSizeId);
    if (!homePricing) {
      throw new Error(`Invalid home size: ${homeSizeId}`);
    }
    
    const basePrice = homePricing.basePrice;
    const servicePricing = SERVICE_PRICING[serviceType as keyof typeof SERVICE_PRICING];
    if (!servicePricing) {
      throw new Error(`Invalid service type: ${serviceType}`);
    }
    
    // V2: use multiplier instead of flat addition
    const totalServicePrice = Math.round(basePrice * servicePricing.multiplier);
    
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${servicePricing.label} (${homeSizeId.replace('_', '-')} sqft)`,
          description: `Cleaning service for ${homeSizeId.replace('_', '-')} sq ft home`,
        },
        unit_amount: totalServicePrice * 100,
      },
      quantity: 1,
    });
    logStep("Added service to line items", { basePrice, multiplier: servicePricing.multiplier, totalServicePrice });
    
    // Deposit (only if NOT using credit)
    if (!isMemberUsingCredit) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Booking Deposit',
            description: 'Refundable deposit applied to final balance',
          },
          unit_amount: 3900,
        },
        quantity: 1,
      });
      logStep("Added deposit to line items");
    }
    
    // Add-ons
    if (addOns.length > 0) {
      addOns.forEach((addon: string) => {
        if (serviceType === 'moveInOut' && (addon === 'fridge' || addon === 'oven')) {
          logStep(`Skipping ${addon} - included in Move-In/Out`);
          return;
        }
        
        const addonPricing = ADD_ON_PRICING[addon as keyof typeof ADD_ON_PRICING];
        if (!addonPricing) {
          logStep(`Unknown add-on: ${addon}`);
          return;
        }
        
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: addonPricing.label,
              description: `Add-on service: ${addonPricing.label}`,
            },
            unit_amount: addonPricing.price * 100,
          },
          quantity: 1,
        });
        logStep(`Added ${addon} add-on`, { price: addonPricing.price });
      });
    }

    logStep("Line items built", { count: lineItems.length });

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.get("origin")}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/book/checkout`,
      metadata: {
        booking_data: JSON.stringify(bookingData),
        use_credit: String(useCredit),
        service_type: serviceType,
        home_size_id: homeSizeId,
        is_membership_signup: 'false',
      },
      ...(isMemberUsingCredit && {
        payment_method_collection: 'always',
        setup_future_usage: 'off_session',
      }),
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    // Store provisional booking
    const depositCents = useCredit ? 0 : 3900;
    const totalEstimateCents = totalServicePrice * 100;

    const { data: booking, error: dbError } = await supabase
      .from('bookings')
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        address,
        city,
        state,
        zip_code: zipCode,
        home_size_id: homeSizeId,
        service_type: serviceType,
        add_ons: addOns,
        membership_plan: membershipPlan,
        uses_credit: useCredit,
        service_date: serviceDate,
        time_slot: timeSlot,
        base_price_cents: basePrice * 100,
        deposit_cents: depositCents,
        total_estimate_cents: totalEstimateCents,
        checkout_session_id: session.id,
        status: 'pending_payment',
      })
      .select()
      .single();

    if (dbError) {
      logStep("Database error", dbError);
    } else {
      logStep("Booking created in database", { bookingId: booking.id });
    }

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
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
