import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

// Service pricing configuration
const SERVICE_PRICING = {
  standard: { label: 'Standard Cleaning', addition: 0 },
  deep: { label: 'Deep Cleaning', addition: 50 },
  moveInOut: { label: 'Move-In/Out Cleaning', addition: 120 },
};

const ADD_ON_PRICING = {
  fridge: { label: 'Inside Fridge', price: 30 },
  oven: { label: 'Inside Oven', price: 30 },
  windows: { label: 'Interior Windows', price: 40 },
};

const HOME_SIZE_PRICING = [
  { id: '0_999', basePrice: 150 },
  { id: '1000_1500', basePrice: 187.5 },
  { id: '1501_2000', basePrice: 225 },
  { id: '2001_2500', basePrice: 262.5 },
  { id: '2501_3000', basePrice: 300 },
  { id: '3001_3500', basePrice: 337.5 },
  { id: '3501_4000', basePrice: 375 },
  { id: '4001_4500', basePrice: 412.5 },
  { id: '4501_5000', basePrice: 450 },
];

// Membership price IDs (these are real Stripe recurring prices)
const MEMBERSHIP_PRICE_IDS = {
  monthly: 'price_1SR2UhGc7k6gIVcMiKbuq1mo',  // $189/month
  biweekly: 'price_1SR2VNGc7k6gIVcMMI6Fuxga', // $289/month
  weekly: 'price_1SR2VYGc7k6gIVcML2W0jVKS',  // $389/month
};

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
    
    // Validate contact information
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
    
    // Validate address components
    if (!address || address.trim().length < 5) {
      validationErrors.push("Complete street address is required");
    }
    if (address && !/\d+/.test(address)) {
      validationErrors.push("Address must include a street number");
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
    
    // Validate booking details
    if (!homeSizeId) {
      validationErrors.push("Home size selection is required");
    }
    if (!serviceType) {
      validationErrors.push("Service type is required");
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
        JSON.stringify({ 
          error: "Validation failed", 
          details: validationErrors 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
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

    // SCENARIO DETECTION
    const isNewMember = membershipPlan !== 'none';
    const isMemberUsingCredit = useCredit === true;
    
    logStep("Scenario detected", { isNewMember, isMemberUsingCredit, membershipPlan });

    // Check for existing Stripe customer
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId = customers.data.length > 0 ? customers.data[0].id : undefined;
    logStep("Customer lookup", { customerId: customerId || 'new customer' });

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    let mode: 'payment' | 'subscription' = 'payment';

    // === SCENARIO 1: New Member Signup ===
    if (isNewMember) {
      logStep("Building membership subscription checkout");
      
      const membershipPriceId = MEMBERSHIP_PRICE_IDS[membershipPlan as keyof typeof MEMBERSHIP_PRICE_IDS];
      if (!membershipPriceId) {
        throw new Error(`Invalid membership plan: ${membershipPlan}`);
      }
      
      lineItems.push({
        price: membershipPriceId,
        quantity: 1,
      });
      
      mode = 'subscription';
    }
    
    // === SCENARIOS 2-4: One-time Cleaning Payment ===
    else {
      logStep("Building one-time payment checkout");
      
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
      
      const serviceAddition = servicePricing.addition;
      const totalServicePrice = basePrice + serviceAddition;
      
      // Main cleaning service using price_data
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${servicePricing.label} (${homeSizeId})`,
            description: `Cleaning service for ${homeSizeId.replace('_', '-')} sq ft home`,
          },
          unit_amount: Math.round(totalServicePrice * 100), // Convert to cents
        },
        quantity: 1,
      });
      logStep("Added service to line items", { 
        basePrice, 
        serviceAddition, 
        totalServicePrice 
      });
      
      // Deposit (only if NOT using credit)
      if (!isMemberUsingCredit) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Booking Deposit',
              description: 'Refundable deposit applied to final balance',
            },
            unit_amount: 3900, // $39
          },
          quantity: 1,
        });
        logStep("Added deposit to line items");
      } else {
        logStep("Skipping deposit - member using credit");
      }
      
      // Add-ons (smart filtering for Move-In/Out)
      if (addOns.length > 0) {
        addOns.forEach((addon: string) => {
          // Skip fridge & oven if moveInOut (already included)
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
              unit_amount: addonPricing.price * 100, // Convert to cents
            },
            quantity: 1,
          });
          logStep(`Added ${addon} add-on`, { price: addonPricing.price });
        });
      }
      
      mode = 'payment';
    }

    logStep("Line items built", { count: lineItems.length, mode });

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: lineItems,
      mode,
      success_url: `${req.headers.get("origin")}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/book/checkout`,
      metadata: {
        booking_data: JSON.stringify(bookingData),
        use_credit: String(useCredit),
        service_type: serviceType,
        home_size_id: homeSizeId,
        is_membership_signup: String(isNewMember),
      },
      // For members using credit, require card on file for future charges
      ...(isMemberUsingCredit && {
        payment_method_collection: 'always',
        setup_future_usage: 'off_session',
      }),
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    // Store provisional booking in database
    const homePricing = HOME_SIZE_PRICING.find(h => h.id === homeSizeId);
    const basePrice = homePricing?.basePrice || 150;
    const servicePricing = SERVICE_PRICING[serviceType as keyof typeof SERVICE_PRICING];
    const serviceAddition = servicePricing?.addition || 0;
    
    const depositCents = useCredit ? 0 : 3900;
    const totalEstimateCents = Math.round((basePrice + serviceAddition) * 100);

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
        base_price_cents: Math.round(basePrice * 100),
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
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
