import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SYNC-TO-ANYTHING] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    logStep("Starting sync to Anything platform", { bookingId });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch booking details
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error(`Failed to fetch booking: ${fetchError?.message}`);
    }

    logStep("Booking data fetched", { 
      id: booking.id,
      customer: `${booking.first_name} ${booking.last_name}`,
      service_date: booking.service_date 
    });

    // Transform to Anything format
    const anythingData = {
      brand_id: "00000000-0000-0000-0000-000000000000", // TODO: Replace with actual brand_id
      customer_name: `${booking.first_name} ${booking.last_name}`.trim(),
      customer_phone: booking.phone,
      service_type: booking.service_type,
      address_line1: booking.address,
      city: booking.city,
      state: booking.state,
      zip: booking.zip_code,
      scheduled_start: `${booking.service_date}T${booking.time_slot.split('-')[0]}:00:00Z`,
      estimated_duration_min: (booking.estimated_duration_hours || 3) * 60,
      price_total: (booking.total_estimate_cents / 100).toFixed(2),
      cleaner_payout_amount: ((booking.cleaner_payout_cents || 0) / 100).toFixed(2),
    };

    logStep("Data transformed for Anything", anythingData);

    // Connect to Neon DB
    const neonUrl = Deno.env.get("NEON_DATABASE_URL");
    if (!neonUrl) {
      throw new Error("NEON_DATABASE_URL not configured");
    }

    const client = new Client(neonUrl);
    await client.connect();
    logStep("Connected to Neon DB");

    // Insert job data
    const insertQuery = `
      INSERT INTO jobs (
        brand_id, customer_name, customer_phone, service_type,
        address_line1, city, state, zip,
        scheduled_start, estimated_duration_min,
        price_total, cleaner_payout_amount
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING id
    `;

    const result = await client.queryObject<{ id: string }>(insertQuery, [
      anythingData.brand_id,
      anythingData.customer_name,
      anythingData.customer_phone,
      anythingData.service_type,
      anythingData.address_line1,
      anythingData.city,
      anythingData.state,
      anythingData.zip,
      anythingData.scheduled_start,
      anythingData.estimated_duration_min,
      parseFloat(anythingData.price_total),
      parseFloat(anythingData.cleaner_payout_amount),
    ]);

    await client.end();
    const jobId = result.rows[0]?.id;
    logStep("Job inserted successfully", { jobId });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Booking synced to Anything platform",
        anythingJobId: jobId
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
