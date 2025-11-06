import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Price ID mapping based on booking configuration
const PRICE_MAPPING: Record<string, Record<string, string>> = {
  regular: {
    one_time: "price_1SQYNYGc7k6gIVcMLcn7bhw6",
    weekly: "price_1SQYNoGc7k6gIVcM7q7mj2KD",
    biweekly: "price_1SQYOYGc7k6gIVcMceZUd8x9",
  },
  deep: {
    one_time: "price_1SQYOlGc7k6gIVcMccTBtCEB",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[CREATE-CHECKOUT] Function started");
    
    const { bookingData } = await req.json();
    console.log("[CREATE-CHECKOUT] Booking data received:", bookingData);

    if (!bookingData) {
      throw new Error("Booking data is required");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Get the appropriate price ID
    const serviceType = bookingData.serviceType || "regular";
    const frequency = bookingData.frequency || "one_time";
    const priceId = PRICE_MAPPING[serviceType]?.[frequency];

    if (!priceId) {
      throw new Error(`No price found for service: ${serviceType}, frequency: ${frequency}`);
    }

    console.log("[CREATE-CHECKOUT] Using price ID:", priceId);

    // Determine checkout mode
    const isRecurring = frequency !== "one_time";
    const mode = isRecurring ? "subscription" : "payment";

    // Check for existing customer by email
    let customerId: string | undefined;
    if (bookingData.email) {
      const customers = await stripe.customers.list({
        email: bookingData.email,
        limit: 1,
      });
      
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log("[CREATE-CHECKOUT] Found existing customer:", customerId);
      }
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : bookingData.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode,
      success_url: `${req.headers.get("origin")}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/book/summary`,
      metadata: {
        booking_data: JSON.stringify(bookingData),
      },
      // Pre-fill customer information
      ...(bookingData.firstName && bookingData.lastName && {
        customer_creation: customerId ? undefined : "always",
      }),
    });

    console.log("[CREATE-CHECKOUT] Checkout session created:", session.id);

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[CREATE-CHECKOUT] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
