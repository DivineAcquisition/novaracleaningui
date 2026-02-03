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

// ============================================
// PRICING CONFIGURATION (v2.0)
// ============================================

// Zone configuration
const ZONE_A_ZIPS = ['20814', '20815', '20816', '20817', '20854', '20859', '20850', '20851', '20852', '20901', '20902', '20903', '20904', '20910'];
const ZONE_C_ZIPS = ['21701', '21702', '21703', '21740', '21742', '21401', '21403', '21117', '21208', '21228', '21244'];

const getZoneModifier = (zipCode: string): number => {
  if (ZONE_A_ZIPS.includes(zipCode)) return 1.15; // Premium
  if (ZONE_C_ZIPS.includes(zipCode)) return 0.90; // Outer
  return 1.0; // Standard
};

// One-time base prices
const ONE_TIME_PRICES: Record<string, number> = {
  '0_999': 150,
  '1000_1500': 189,
  '1501_2000': 239,
  '2001_2500': 279,
  '2501_3000': 339,
  '3001_3500': 379,
  '3501_4000': 439,
  '4001_4500': 489,
  '4501_5000': 539,
};

// Service type multipliers
const SERVICE_MULTIPLIERS: Record<string, { name: string; multiplier: number; includes?: string[] }> = {
  standard: { name: 'Standard Clean', multiplier: 1.0 },
  deep: { name: 'Deep Clean', multiplier: 1.5 },
  moveInOut: { name: 'Move-In/Out Clean', multiplier: 2.0, includes: ['fridge', 'oven'] },
};

// Membership prices (monthly total)
const MEMBERSHIP_PRICES: Record<string, Record<string, number>> = {
  monthly: {
    '0_999': 129,
    '1000_1500': 159,
    '1501_2000': 199,
    '2001_2500': 229,
    '2501_3000': 279,
    '3001_3500': 319,
    '3501_4000': 369,
    '4001_4500': 409,
    '4501_5000': 459,
  },
  biweekly: {
    '0_999': 199,
    '1000_1500': 249,
    '1501_2000': 319,
    '2001_2500': 369,
    '2501_3000': 449,
    '3001_3500': 499,
    '3501_4000': 579,
    '4001_4500': 649,
    '4501_5000': 719,
  },
  weekly: {
    '0_999': 349,
    '1000_1500': 449,
    '1501_2000': 569,
    '2001_2500': 659,
    '2501_3000': 799,
    '3001_3500': 899,
    '3501_4000': 1039,
    '4001_4500': 1159,
    '4501_5000': 1279,
  },
};

// Add-ons
const ADD_ON_PRICES: Record<string, { name: string; price: number }> = {
  fridge: { name: 'Inside Fridge', price: 30 },
  oven: { name: 'Inside Oven', price: 30 },
  windows: { name: 'Interior Windows', price: 40 },
};

// First clean fee for memberships
const MEMBERSHIP_FIRST_CLEAN_FEE = 75;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");
    
    const { bookingData } = await req.json();
    logStep("Booking data received", { 
      serviceType: bookingData.serviceType, 
      homeSizeId: bookingData.homeSizeId,
      membershipPlan: bookingData.membershipPlan,
      frequency: bookingData.frequency,
      useCredit: bookingData.useCredit,
      zipCode: bookingData.zipCode
    });

    const {
      homeSizeId,
      serviceType = 'standard',
      addOns = [],
      membershipPlan,
      frequency,
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
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.push("Valid email is required");
    }
    if (!firstName || firstName.trim().length < 2) {
      validationErrors.push("First name must be at least 2 characters");
    }
    if (!lastName || lastName.trim().length < 2) {
      validationErrors.push("Last name must be at least 2 characters");
    }
    if (!phone || !/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
      validationErrors.push("Valid 10-digit phone number is required");
    }
    if (!address || address.trim().length < 5) {
      validationErrors.push("Complete street address is required");
    }
    if (!city || city.trim().length < 2) {
      validationErrors.push("Valid city name is required");
    }
    if (!state || !/^[A-Z]{2}$/i.test(state)) {
      validationErrors.push("Valid 2-letter state code is required");
    }
    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      validationErrors.push("Valid 5-digit ZIP code is required");
    }
    if (!homeSizeId) {
      validationErrors.push("Home size selection is required");
    }
    if (!serviceDate) {
      validationErrors.push("Service date is required");
    }
    if (!timeSlot) {
      validationErrors.push("Time slot is required");
    }
    
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

    // Get zone modifier
    const zoneModifier = getZoneModifier(zipCode);
    logStep("Zone modifier", { zipCode, zoneModifier });

    // Determine if this is a membership signup
    const effectiveFrequency = frequency || (membershipPlan !== 'none' ? membershipPlan : 'one_time');
    const isMembership = effectiveFrequency !== 'one_time' && effectiveFrequency !== 'none';
    const isMemberUsingCredit = useCredit === true;
    
    logStep("Scenario detected", { isMembership, effectiveFrequency, isMemberUsingCredit });

    // Check for existing Stripe customer
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId = customers.data.length > 0 ? customers.data[0].id : undefined;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: `${firstName} ${lastName}`,
        phone,
        address: {
          line1: address,
          city,
          state,
          postal_code: zipCode,
          country: 'US',
        },
        metadata: {
          home_size_id: homeSizeId,
          zip_code: zipCode,
        },
      });
      customerId = customer.id;
      logStep("Created new Stripe customer", { customerId });
    } else {
      logStep("Using existing Stripe customer", { customerId });
    }

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    let mode: 'payment' | 'subscription' = 'payment';
    let subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData | undefined;

    // === MEMBERSHIP CHECKOUT ===
    if (isMembership) {
      logStep("Building membership subscription checkout");
      
      const membershipPrices = MEMBERSHIP_PRICES[effectiveFrequency];
      if (!membershipPrices) {
        throw new Error(`Invalid membership frequency: ${effectiveFrequency}`);
      }
      
      const baseMembershipPrice = membershipPrices[homeSizeId];
      if (!baseMembershipPrice) {
        throw new Error(`No membership price for home size: ${homeSizeId}`);
      }
      
      // Apply zone modifier
      const monthlyPrice = Math.round(baseMembershipPrice * zoneModifier);
      const monthlyPriceCents = monthlyPrice * 100;
      
      // Create or find recurring price in Stripe
      const productName = `Novara ${effectiveFrequency === 'monthly' ? 'Monthly' : effectiveFrequency === 'biweekly' ? 'Bi-Weekly' : 'Weekly'} Membership`;
      const productDescription = `${homeSizeId.replace('_', '-')} sq ft home, ${effectiveFrequency} cleaning`;
      
      // Add recurring membership line item
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: productName,
            description: productDescription,
          },
          unit_amount: monthlyPriceCents,
          recurring: {
            interval: 'month',
            interval_count: 1,
          },
        },
        quantity: 1,
      });
      
      // Add first clean setup fee as one-time charge
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'First Clean Setup Fee',
            description: 'One-time fee for initial deep clean and setup',
          },
          unit_amount: MEMBERSHIP_FIRST_CLEAN_FEE * 100,
        },
        quantity: 1,
      });
      
      mode = 'subscription';
      subscriptionData = {
        metadata: {
          home_size_id: homeSizeId,
          frequency: effectiveFrequency,
          zone_modifier: String(zoneModifier),
        },
      };
      
      logStep("Membership line items added", { monthlyPrice, firstCleanFee: MEMBERSHIP_FIRST_CLEAN_FEE });
    }
    
    // === ONE-TIME CHECKOUT ===
    else {
      logStep("Building one-time payment checkout");
      
      const basePrice = ONE_TIME_PRICES[homeSizeId];
      if (!basePrice) {
        throw new Error(`No price for home size: ${homeSizeId}`);
      }
      
      const serviceConfig = SERVICE_MULTIPLIERS[serviceType];
      if (!serviceConfig) {
        throw new Error(`Invalid service type: ${serviceType}`);
      }
      
      // Calculate price with zone modifier and service multiplier
      const zonedPrice = Math.round(basePrice * zoneModifier);
      const servicePrice = Math.round(zonedPrice * serviceConfig.multiplier);
      
      // Main cleaning service
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: serviceConfig.name,
            description: `${serviceConfig.name} for ${homeSizeId.replace('_', '-')} sq ft home`,
          },
          unit_amount: servicePrice * 100,
        },
        quantity: 1,
      });
      logStep("Added service", { basePrice, zonedPrice, servicePrice });
      
      // Add-ons (skip if included in service)
      const serviceIncludes = serviceConfig.includes || [];
      for (const addon of addOns) {
        if (serviceIncludes.includes(addon)) {
          logStep(`Skipping ${addon} - included in ${serviceType}`);
          continue;
        }
        
        const addonConfig = ADD_ON_PRICES[addon];
        if (!addonConfig) {
          logStep(`Unknown add-on: ${addon}`);
          continue;
        }
        
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: addonConfig.name,
              description: `Add-on: ${addonConfig.name}`,
            },
            unit_amount: addonConfig.price * 100,
          },
          quantity: 1,
        });
        logStep(`Added add-on: ${addon}`, { price: addonConfig.price });
      }
      
      mode = 'payment';
    }

    logStep("Line items built", { count: lineItems.length, mode });

    // Create checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      line_items: lineItems,
      mode,
      success_url: `${req.headers.get("origin")}/book/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/book/checkout`,
      metadata: {
        booking_data: JSON.stringify({
          ...bookingData,
          zoneModifier,
        }),
        is_membership: String(isMembership),
        frequency: effectiveFrequency,
        service_type: serviceType,
        home_size_id: homeSizeId,
        zip_code: zipCode,
      },
      ...(subscriptionData && { subscription_data: subscriptionData }),
      // Payment settings
      payment_method_types: ['card'],
      ...(mode === 'payment' && {
        payment_intent_data: {
          metadata: {
            home_size_id: homeSizeId,
            service_type: serviceType,
            zip_code: zipCode,
          },
        },
      }),
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    // Store provisional booking
    const basePrice = ONE_TIME_PRICES[homeSizeId] || 150;
    const zonedPrice = Math.round(basePrice * zoneModifier);
    const serviceMultiplier = SERVICE_MULTIPLIERS[serviceType]?.multiplier || 1.0;
    const totalPriceCents = Math.round(zonedPrice * serviceMultiplier * 100);

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
        membership_plan: isMembership ? effectiveFrequency : 'none',
        uses_credit: useCredit,
        service_date: serviceDate,
        time_slot: timeSlot,
        base_price_cents: Math.round(basePrice * 100),
        deposit_cents: 0, // Checkout handles full payment
        total_estimate_cents: totalPriceCents,
        checkout_session_id: session.id,
        status: 'pending_payment',
        team_notes: `Zone: ${zoneModifier > 1 ? 'Premium' : zoneModifier < 1 ? 'Outer' : 'Standard'} (${zoneModifier}x)`,
      })
      .select()
      .single();

    if (dbError) {
      logStep("Database error", dbError);
    } else {
      logStep("Booking created", { bookingId: booking.id });
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
