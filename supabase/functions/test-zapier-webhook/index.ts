import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[TEST-ZAPIER-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

async function testBookingWebhook(supabase: any) {
  logStep("Creating test booking");
  
  // Create a realistic test booking
  const testBooking = {
    first_name: "Test",
    last_name: "Customer",
    email: `test-${Date.now()}@example.com`,
    phone: "555-0123",
    address: "123 Test Street",
    city: "Test City",
    state: "CA",
    zip_code: "90210",
    home_size_id: "2000-3000",
    service_type: "standard",
    service_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
    time_slot: "8-12",
    add_ons: ["fridge", "oven"],
    membership_plan: "none",
    bedrooms: 3,
    bathrooms: 2,
    dwelling_type: "house",
    sqft: 2500,
    estimated_duration_hours: 4,
    base_price_cents: 25000,
    deposit_cents: 12500,
    total_estimate_cents: 25000,
    tax_cents: 2000,
    status: "confirmed",
    payment_option: "deposit",
    payment_method: "Card",
    uses_credit: false,
    booking_channel: "Website",
    booker_source: "Test Webhook",
    frequency: "One-Time"
  };

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert(testBooking)
    .select()
    .single();

  if (bookingError) {
    logStep("Error creating booking", { error: bookingError });
    throw new Error(`Failed to create test booking: ${bookingError.message}`);
  }

  logStep("Test booking created", { bookingId: booking.id });

  // Invoke the send-zapier-webhook function with booking
  const { data, error: webhookError } = await supabase.functions.invoke(
    'send-zapier-webhook',
    { body: { bookingId: booking.id } }
  );

  if (webhookError) {
    logStep("Error sending webhook", { error: webhookError });
    throw webhookError;
  }

  logStep("Test booking webhook sent successfully");

  return {
    success: true,
    bookingId: booking.id,
    message: 'Test booking webhook sent. Check your Zapier booking catch hook.',
    webhookData: data
  };
}

async function testDispatchWebhook(supabase: any) {
  logStep("Creating test job with cleaners");

  // Get available cleaners
  const { data: cleaners, error: cleanersError } = await supabase
    .from('cleaners')
    .select('id, first_name, last_name, email, phone, home_lat, home_lng')
    .eq('status', 'active')
    .eq('available_for_bookings', true)
    .limit(2);

  if (cleanersError || !cleaners || cleaners.length === 0) {
    throw new Error('No available cleaners found for test dispatch. Please ensure you have active cleaners.');
  }

  logStep("Found cleaners", { count: cleaners.length });

  // Create a test job
  const testJob = {
    address: "456 Dispatch Test Ave",
    city: "Test City",
    state: "CA",
    zip: "90210",
    service_type: "Standard",
    sq_ft: 2500,
    bedrooms: 3,
    bathrooms: 2,
    lat: 34.0522,
    lng: -118.2437,
    start_datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    duration_est_hours: 4,
    min_cleaners_required: 2,
    status: "Assigned",
    notes: "Test dispatch webhook job"
  };

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .insert(testJob)
    .select()
    .single();

  if (jobError) {
    logStep("Error creating job", { error: jobError });
    throw new Error(`Failed to create test job: ${jobError.message}`);
  }

  logStep("Test job created", { jobId: job.id });

  // Assign cleaners to the job
  const assignments = cleaners.map((cleaner: any, index: number) => ({
    job_id: job.id,
    cleaner_id: cleaner.id,
    status: "Accepted",
    role: index === 0 ? "Lead" : "Support",
    distance_miles: 5.5,
    pay_rate_hr: 18.00,
    estimated_pay_cents: 7200
  }));

  const { error: assignmentError } = await supabase
    .from('job_assignments')
    .insert(assignments);

  if (assignmentError) {
    logStep("Error creating assignments", { error: assignmentError });
    throw new Error(`Failed to assign cleaners: ${assignmentError.message}`);
  }

  logStep("Cleaners assigned", { count: assignments.length });

  // Invoke the send-zapier-webhook function with job dispatch
  const { data, error: webhookError } = await supabase.functions.invoke(
    'send-zapier-webhook',
    { body: { jobId: job.id } }
  );

  if (webhookError) {
    logStep("Error sending webhook", { error: webhookError });
    throw webhookError;
  }

  logStep("Test dispatch webhook sent successfully");

  return {
    success: true,
    jobId: job.id,
    message: 'Test dispatch webhook sent with cleaner team. Check your Zapier dispatch catch hook.',
    webhookData: data
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    logStep("Test webhook invocation started");

    const { type } = await req.json();
    
    if (!type || !['booking', 'dispatch'].includes(type)) {
      throw new Error('Invalid type. Must be "booking" or "dispatch"');
    }

    logStep("Test type", { type });

    let result;
    if (type === 'booking') {
      result = await testBookingWebhook(supabase);
    } else {
      result = await testDispatchWebhook(supabase);
    }

    return new Response(
      JSON.stringify(result),
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
