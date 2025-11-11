import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[MODIFY-BOOKING] ${step}${detailsStr}`);
};

// Pricing configuration (must match frontend)
const HOME_SIZE_PRICING: Record<string, { standardPrice: number }> = {
  '0_999': { standardPrice: 150 },
  '1000_1500': { standardPrice: 187.5 },
  '1501_2000': { standardPrice: 225 },
  '2001_2500': { standardPrice: 262.5 },
  '2501_3000': { standardPrice: 300 },
  '3001_3500': { standardPrice: 337.5 },
  '3501_4000': { standardPrice: 375 },
  '4001_4500': { standardPrice: 412.5 },
  '4501_5000': { standardPrice: 450 },
};

const SERVICE_PRICING: Record<string, number> = {
  standard: 0,
  deep: 50,
  moveInOut: 120,
};

const ADD_ON_PRICING: Record<string, number> = {
  fridge: 30,
  oven: 30,
  windows: 40,
};

const MEMBERSHIP_DISCOUNTS: Record<string, number> = {
  none: 0,
  monthly: 0.20,
  biweekly: 0.25,
  weekly: 0.30,
};

function calculatePrice(
  homeSizeId: string,
  serviceType: string,
  addOns: string[],
  membershipPlan: string,
  useCredit: boolean
): number {
  const basePrice = HOME_SIZE_PRICING[homeSizeId]?.standardPrice || 0;
  const serviceAddition = SERVICE_PRICING[serviceType] || 0;
  
  let addOnsTotal = 0;
  if (serviceType === 'moveInOut') {
    // Move-In/Out includes fridge & oven
    addOnsTotal = addOns
      .filter(addon => addon === 'windows')
      .reduce((total, addon) => total + (ADD_ON_PRICING[addon] || 0), 0);
  } else {
    addOnsTotal = addOns.reduce((total, addon) => total + (ADD_ON_PRICING[addon] || 0), 0);
  }
  
  const subtotal = basePrice + serviceAddition + addOnsTotal;
  
  // Membership discount on extras only
  const membershipDiscount = MEMBERSHIP_DISCOUNTS[membershipPlan] || 0;
  const extrasAmount = serviceAddition + addOnsTotal;
  const discountAmount = extrasAmount * membershipDiscount;
  
  // Credit coverage
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;
  
  return subtotal - discountAmount - creditCoverage;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");
    
    logStep("User authenticated", { userId: user.id, email: user.email });

    const { 
      bookingId, 
      serviceType, 
      addOns, 
      bedrooms, 
      bathrooms, 
      dwellingType 
    } = await req.json();

    logStep("Request parsed", { bookingId, serviceType, addOns });

    // Fetch current booking
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .eq('email', user.email!)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    // Validate booking can be modified
    if (booking.status === 'completed') {
      throw new Error("Cannot modify completed bookings");
    }
    if (booking.status === 'cancelled') {
      throw new Error("Cannot modify cancelled bookings");
    }
    
    const serviceDate = new Date(booking.service_date);
    if (serviceDate < new Date()) {
      throw new Error("Cannot modify bookings in the past");
    }

    logStep("Booking validation passed", { originalStatus: booking.status });

    // Calculate pricing
    const originalTotal = calculatePrice(
      booking.home_size_id,
      booking.service_type,
      booking.add_ons || [],
      booking.membership_plan,
      booking.uses_credit
    );

    const newTotal = calculatePrice(
      booking.home_size_id,
      serviceType,
      addOns,
      booking.membership_plan,
      booking.uses_credit
    );

    const priceDifference = newTotal - originalTotal;
    const priceDifferenceCents = Math.round(priceDifference * 100);

    logStep("Price calculated", { originalTotal, newTotal, priceDifference });

    let requiresPayment = false;
    let checkoutUrl = null;

    // If price increased, create Stripe checkout for difference
    if (priceDifferenceCents > 0) {
      const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
        apiVersion: "2025-08-27.basil",
      });

      const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
      let customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : user.email!,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Booking Modification Fee',
                description: `Additional charge for booking #${bookingId.slice(0, 8)}`,
              },
              unit_amount: priceDifferenceCents,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${req.headers.get("origin")}/account?modified=true`,
        cancel_url: `${req.headers.get("origin")}/account`,
        metadata: {
          booking_id: bookingId,
          modification: 'true',
        },
      });

      requiresPayment = true;
      checkoutUrl = session.url;
      
      logStep("Stripe checkout created for additional payment", { sessionId: session.id, amount: priceDifferenceCents });
    }

    // Update booking with new details
    const { error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({
        service_type: serviceType,
        add_ons: addOns,
        bedrooms: bedrooms,
        bathrooms: bathrooms,
        dwelling_type: dwellingType,
        total_estimate_cents: Math.round(newTotal * 100),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateError) throw updateError;

    logStep("Booking updated successfully");

    // Send modification confirmation email (only if no payment required)
    if (!requiresPayment) {
      try {
        await supabaseAdmin.functions.invoke('send-booking-email', {
          body: {
            to: user.email,
            type: 'modification',
            bookingData: {
              ...booking,
              service_type: serviceType,
              add_ons: addOns,
              bedrooms,
              bathrooms,
              dwelling_type: dwellingType,
              total_estimate_cents: Math.round(newTotal * 100),
              priceDifference: priceDifference.toFixed(2),
            },
          },
        });
        logStep("Modification confirmation email sent");
      } catch (emailError) {
        console.error("Failed to send email:", emailError);
        // Don't fail the whole operation if email fails
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        requiresPayment,
        checkoutUrl,
        priceDifference: priceDifference.toFixed(2),
      }),
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
        status: 400,
      }
    );
  }
});
