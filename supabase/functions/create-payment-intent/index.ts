import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PAYMENT-INTENT] ${step}${detailsStr}`);
};

// Service pricing configuration
const SERVICE_PRICING = {
  standard: 0,
  deep: 5000,
  moveInOut: 8000,
};

const ADD_ON_PRICING = {
  fridge: 4000,
  oven: 4000,
  windows: 5000,
  laundry: 4000,
  dishes: 2000,
};

const HOME_SIZE_PRICING = [
  { id: "0-999", minSqft: 0, maxSqft: 999, price: 15000 },
  { id: "1000-1499", minSqft: 1000, maxSqft: 1499, price: 20000 },
  { id: "1500-1999", minSqft: 1500, maxSqft: 1999, price: 25000 },
  { id: "2000-2499", minSqft: 2000, maxSqft: 2499, price: 30000 },
  { id: "2500-2999", minSqft: 2500, maxSqft: 2999, price: 35000 },
  { id: "3000-3999", minSqft: 3000, maxSqft: 3999, price: 42000 },
  { id: "4000-4999", minSqft: 4000, maxSqft: 4999, price: 50000 },
  { id: "5000+", minSqft: 5000, maxSqft: 999999, price: 60000 },
];

const DEPOSIT_AMOUNT = 3900;

const MEMBERSHIP_DISCOUNTS = {
  basic: 0.05,
  premium: 0.10,
  elite: 0.15,
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
    });

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Calculate pricing
    const homeSizePrice = HOME_SIZE_PRICING.find(h => h.id === bookingData.homeSizeId)?.price || 0;
    const serviceTierPrice = SERVICE_PRICING[bookingData.serviceType as keyof typeof SERVICE_PRICING] || 0;
    
    let addOnsTotal = 0;
    const serviceAddOns = bookingData.addOns || [];
    
    // Filter add-ons for moveInOut service
    const relevantAddOns = bookingData.serviceType === 'moveInOut' 
      ? serviceAddOns.filter((addon: string) => addon !== 'fridge' && addon !== 'oven')
      : serviceAddOns;
    
    relevantAddOns.forEach((addon: string) => {
      addOnsTotal += ADD_ON_PRICING[addon as keyof typeof ADD_ON_PRICING] || 0;
    });

    let totalAmount = homeSizePrice + serviceTierPrice + addOnsTotal;
    logStep("Base calculation", { totalAmount });

    // Apply membership discount
    const membershipPlan = bookingData.membershipPlan || 'none';
    let membershipDiscount = 0;
    if (membershipPlan !== 'none' && MEMBERSHIP_DISCOUNTS[membershipPlan as keyof typeof MEMBERSHIP_DISCOUNTS]) {
      membershipDiscount = Math.round(totalAmount * MEMBERSHIP_DISCOUNTS[membershipPlan as keyof typeof MEMBERSHIP_DISCOUNTS]);
      totalAmount -= membershipDiscount;
      logStep("Applied membership discount", { membershipDiscount, newTotal: totalAmount });
    }

    // Determine amount to charge based on payment option
    let amountToCharge = 0;
    let fullPaymentDiscount = 0;

    if (bookingData.paymentOption === 'full') {
      // Apply 10% discount for full payment
      fullPaymentDiscount = Math.round(totalAmount * 0.10);
      amountToCharge = totalAmount - fullPaymentDiscount;
      logStep("Full payment selected", { 
        originalAmount: totalAmount, 
        discount: fullPaymentDiscount, 
        finalAmount: amountToCharge 
      });
    } else {
      // Deposit payment
      if (bookingData.useCredit && membershipPlan !== 'none') {
        amountToCharge = 0; // Member using credit pays no deposit
        logStep("Member using credit - no deposit required");
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

    // Create PaymentIntent only if amount is greater than 0
    let paymentIntentId = null;
    let clientSecret = null;

    if (amountToCharge > 0) {
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
        },
      });

      paymentIntentId = paymentIntent.id;
      clientSecret = paymentIntent.client_secret;
      logStep("Created payment intent", { paymentIntentId, amount: amountToCharge });
    } else {
      logStep("No payment required - member using credit");
    }

    // Store provisional booking in database
    const { data: booking, error: bookingError } = await supabaseClient
      .from("bookings")
      .insert({
        email: bookingData.email,
        first_name: bookingData.firstName,
        last_name: bookingData.lastName,
        phone: bookingData.phone,
        address: bookingData.address,
        city: bookingData.city,
        state: bookingData.state,
        zip_code: bookingData.zipCode,
        home_size_id: bookingData.homeSizeId,
        service_type: bookingData.serviceType,
        add_ons: relevantAddOns,
        service_date: bookingData.serviceDate,
        time_slot: bookingData.timeSlot,
        membership_plan: membershipPlan,
        uses_credit: bookingData.useCredit || false,
        base_price_cents: homeSizePrice + serviceTierPrice,
        deposit_cents: bookingData.paymentOption === 'deposit' ? DEPOSIT_AMOUNT : 0,
        total_estimate_cents: totalAmount,
        payment_intent_id: paymentIntentId,
        customer_id: customerId,
        status: amountToCharge === 0 ? 'confirmed' : 'pending_payment',
        payment_option: bookingData.paymentOption,
        full_payment_discount: fullPaymentDiscount,
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
        requiresPayment: amountToCharge > 0,
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
