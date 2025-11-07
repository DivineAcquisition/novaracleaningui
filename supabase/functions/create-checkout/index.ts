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

// PRICE_MAPPING - Replace these with actual Stripe price IDs after creating products
const PRICE_MAPPING = {
  standard: {
    '0_999': 'price_STANDARD_0_999',
    '1000_1500': 'price_STANDARD_1000_1500',
    '1501_2000': 'price_STANDARD_1501_2000',
    '2001_2500': 'price_STANDARD_2001_2500',
    '2501_3000': 'price_STANDARD_2501_3000',
    '3001_3500': 'price_STANDARD_3001_3500',
    '3501_4000': 'price_STANDARD_3501_4000',
    '4001_4500': 'price_STANDARD_4001_4500',
    '4501_5000': 'price_STANDARD_4501_5000',
  },
  deep: {
    '0_999': 'price_DEEP_0_999',
    '1000_1500': 'price_DEEP_1000_1500',
    '1501_2000': 'price_DEEP_1501_2000',
    '2001_2500': 'price_DEEP_2001_2500',
    '2501_3000': 'price_DEEP_2501_3000',
    '3001_3500': 'price_DEEP_3001_3500',
    '3501_4000': 'price_DEEP_3501_4000',
    '4001_4500': 'price_DEEP_4001_4500',
    '4501_5000': 'price_DEEP_4501_5000',
  },
  moveInOut: {
    '0_999': 'price_MOVEINOUT_0_999',
    '1000_1500': 'price_MOVEINOUT_1000_1500',
    '1501_2000': 'price_MOVEINOUT_1501_2000',
    '2001_2500': 'price_MOVEINOUT_2001_2500',
    '2501_3000': 'price_MOVEINOUT_2501_3000',
    '3001_3500': 'price_MOVEINOUT_3001_3500',
    '3501_4000': 'price_MOVEINOUT_3501_4000',
    '4001_4500': 'price_MOVEINOUT_4001_4500',
    '4501_5000': 'price_MOVEINOUT_4501_5000',
  },
  deposit: 'price_DEPOSIT_39',
  addOns: {
    fridge: 'price_ADDON_FRIDGE_30',
    oven: 'price_ADDON_OVEN_30',
    windows: 'price_ADDON_WINDOWS_40',
  },
  memberships: {
    monthly: 'price_MEMBERSHIP_MONTHLY_189',
    biweekly: 'price_MEMBERSHIP_BIWEEKLY_289',
    weekly: 'price_MEMBERSHIP_WEEKLY_389',
  },
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
      
      lineItems.push({
        price: PRICE_MAPPING.memberships[membershipPlan as keyof typeof PRICE_MAPPING.memberships],
        quantity: 1,
      });
      
      mode = 'subscription';
    }
    
    // === SCENARIOS 2-4: One-time Cleaning Payment ===
    else {
      logStep("Building one-time payment checkout");
      
      // Main cleaning service price
      const tierMapping = PRICE_MAPPING[serviceType as 'standard' | 'deep' | 'moveInOut'];
      const servicePriceId = tierMapping[homeSizeId as keyof typeof tierMapping];
      lineItems.push({
        price: servicePriceId,
        quantity: 1,
      });
      logStep("Added service to line items", { priceId: servicePriceId });
      
      // Deposit (only if NOT using credit)
      if (!isMemberUsingCredit) {
        lineItems.push({
          price: PRICE_MAPPING.deposit,
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
          
          lineItems.push({
            price: PRICE_MAPPING.addOns[addon as keyof typeof PRICE_MAPPING.addOns],
            quantity: 1,
          });
          logStep(`Added ${addon} add-on`);
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

    // Store provisional booking in database (calculate pricing for storage)
    const homeSizeIndex = ['0_999', '1000_1500', '1501_2000', '2001_2500', '2501_3000', '3001_3500', '3501_4000', '4001_4500', '4501_5000'].indexOf(homeSizeId);
    const basePrices = [150, 187.5, 225, 262.5, 300, 337.5, 375, 412.5, 450];
    const basePrice = basePrices[homeSizeIndex] || 150;
    
    const serviceAdditions: Record<string, number> = { standard: 0, deep: 50, moveInOut: 120 };
    const serviceAddition = serviceAdditions[serviceType] || 0;
    
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