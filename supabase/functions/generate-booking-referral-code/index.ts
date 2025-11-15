import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[GENERATE-REFERRAL] ${step}${detailsStr}`);
};

const generateCode = (firstName: string, lastName: string): string => {
  // Create code from name + random numbers
  const namePart = (firstName.substring(0, 3) + lastName.substring(0, 3)).toUpperCase();
  const numberPart = Math.floor(10 + Math.random() * 90); // 2 random digits
  return `${namePart}${numberPart}`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    
    if (!bookingId) {
      throw new Error("Booking ID is required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    logStep("Generating referral code", { bookingId });

    // Get booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("first_name, last_name, email, customer_id")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    // Generate unique code
    let code = generateCode(booking.first_name, booking.last_name);
    let attempts = 0;
    const maxAttempts = 10;

    // Ensure code is unique
    while (attempts < maxAttempts) {
      const { data: existing } = await supabase
        .from("referrals")
        .select("id")
        .eq("code", code)
        .maybeSingle();

      if (!existing) break;
      
      // Add random suffix if code exists
      code = generateCode(booking.first_name, booking.last_name) + Math.floor(Math.random() * 100);
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error("Failed to generate unique referral code");
    }

    logStep("Generated unique code", { code });

    // Create referral record
    const { data: referral, error: insertError } = await supabase
      .from("referrals")
      .insert({
        code,
        customer_id: booking.customer_id,
        booking_id: bookingId,
        referrer_email: booking.email,
        status: 'pending',
        credit_cents: 0,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create referral: ${insertError.message}`);
    }

    logStep("Referral created successfully", { code, referralId: referral.id });

    const referralLink = `${Deno.env.get("SUPABASE_URL").replace("sxdraeptzuamsgjcvfeg.supabase.co", "book.novaracleaning.com")}/book/zip?ref=${code}`;

    return new Response(
      JSON.stringify({ 
        success: true,
        code,
        link: referralLink,
        referral,
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
        status: 500,
      }
    );
  }
});
