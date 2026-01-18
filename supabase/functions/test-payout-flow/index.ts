import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[TEST-PAYOUT-FLOW] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const results: any = {
    timestamp: new Date().toISOString(),
    checks: [],
    warnings: [],
    errors: [],
    isReady: true,
  };

  try {
    const { action } = await req.json().catch(() => ({}));
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check 1: Verify Stripe keys are configured
    logStep("Checking Stripe configuration");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      results.errors.push("STRIPE_SECRET_KEY is not configured");
      results.isReady = false;
    } else {
      results.checks.push("✓ STRIPE_SECRET_KEY is configured");
      
      // Test Stripe connection
      try {
        const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-08-27.basil" });
        const balance = await stripe.balance.retrieve();
        results.checks.push(`✓ Stripe connection verified (Available: $${(balance.available[0]?.amount || 0) / 100})`);
      } catch (stripeError) {
        results.errors.push(`Stripe connection failed: ${stripeError}`);
        results.isReady = false;
      }
    }

    // Check 2: Verify Stripe webhook secret
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      results.warnings.push("STRIPE_WEBHOOK_SECRET not configured - webhooks won't update payouts_enabled automatically");
    } else {
      results.checks.push("✓ STRIPE_WEBHOOK_SECRET is configured");
    }

    // Check 3: Verify database tables exist
    logStep("Checking database tables");
    
    const { data: payoutsCheck, error: payoutsError } = await supabase
      .from("payouts")
      .select("id")
      .limit(1);
    
    if (payoutsError) {
      results.errors.push(`Payouts table check failed: ${payoutsError.message}`);
      results.isReady = false;
    } else {
      results.checks.push("✓ Payouts table exists and accessible");
    }

    const { data: cleanersCheck, error: cleanersError } = await supabase
      .from("cleaners")
      .select("id, stripe_account_id, payouts_enabled")
      .not("stripe_account_id", "is", null)
      .eq("payouts_enabled", true)
      .limit(5);
    
    if (cleanersError) {
      results.errors.push(`Cleaners table check failed: ${cleanersError.message}`);
      results.isReady = false;
    } else {
      results.checks.push(`✓ Cleaners table exists - ${cleanersCheck?.length || 0} cleaners with payouts enabled`);
      
      if (cleanersCheck && cleanersCheck.length === 0) {
        results.warnings.push("No cleaners have payouts_enabled=true yet. Complete Stripe onboarding first.");
      }
    }

    // Check 4: Verify bookings table has required columns
    const { data: bookingsCheck, error: bookingsError } = await supabase
      .from("bookings")
      .select("id, status, cleaner_id, completion_trigger, payout_status")
      .limit(1);
    
    if (bookingsError) {
      results.errors.push(`Bookings table check failed: ${bookingsError.message}`);
      results.isReady = false;
    } else {
      results.checks.push("✓ Bookings table has required columns");
    }

    // Check 5: Verify jobs and job_assignments tables
    const { data: jobsCheck, error: jobsError } = await supabase
      .from("jobs")
      .select("id, status, check_in_time, check_out_time, booking_id")
      .limit(1);
    
    if (jobsError) {
      results.errors.push(`Jobs table check failed: ${jobsError.message}`);
      results.isReady = false;
    } else {
      results.checks.push("✓ Jobs table exists and accessible");
    }

    const { data: assignmentsCheck, error: assignmentsError } = await supabase
      .from("job_assignments")
      .select("id, job_id, cleaner_id, status")
      .limit(1);
    
    if (assignmentsError) {
      results.errors.push(`Job assignments table check failed: ${assignmentsError.message}`);
      results.isReady = false;
    } else {
      results.checks.push("✓ Job assignments table exists and accessible");
    }

    // If action is 'simulate', try to simulate the payout flow with a test booking
    if (action === "simulate") {
      logStep("Running payout simulation");
      results.simulation = { steps: [] };
      
      // Find a completed booking with a cleaner that has payouts enabled
      const { data: testBooking, error: testBookingError } = await supabase
        .from("bookings")
        .select(`
          id, 
          booking_number, 
          status, 
          cleaner_id, 
          total_estimate_cents,
          home_size_id,
          payout_status,
          cleaners!bookings_cleaner_id_fkey(
            id, 
            first_name, 
            last_name, 
            stripe_account_id, 
            payouts_enabled
          )
        `)
        .eq("status", "completed")
        .is("payout_status", null)
        .not("cleaner_id", "is", null)
        .limit(1)
        .maybeSingle();

      if (testBookingError) {
        results.simulation.error = `Failed to find test booking: ${testBookingError.message}`;
      } else if (!testBooking) {
        results.simulation.steps.push("No completed bookings without payouts found for simulation");
        results.simulation.message = "Create a test booking and mark it completed to test the payout flow";
      } else {
        results.simulation.booking = {
          id: testBooking.id,
          bookingNumber: testBooking.booking_number,
          totalCents: testBooking.total_estimate_cents,
          cleaner: testBooking.cleaners,
        };

        const cleaner = testBooking.cleaners as any;
        
        if (!cleaner) {
          results.simulation.steps.push("❌ No cleaner assigned to booking");
        } else if (!cleaner.stripe_account_id) {
          results.simulation.steps.push(`❌ Cleaner ${cleaner.first_name} has no Stripe account`);
        } else if (!cleaner.payouts_enabled) {
          results.simulation.steps.push(`❌ Cleaner ${cleaner.first_name} has payouts_enabled=false`);
          results.simulation.steps.push("→ Cleaner needs to complete Stripe onboarding");
        } else {
          results.simulation.steps.push(`✓ Booking ${testBooking.booking_number} ready for payout`);
          results.simulation.steps.push(`✓ Cleaner ${cleaner.first_name} has valid Stripe account`);
          results.simulation.steps.push(`✓ Payouts enabled for cleaner`);
          results.simulation.readyForPayout = true;
          results.simulation.message = "This booking can be used to test the payout. Use action='execute' to process it.";
        }
      }
    }

    // If action is 'execute', actually process a payout for testing
    if (action === "execute") {
      logStep("Executing test payout");
      
      // Find a completed booking ready for payout
      const { data: testBooking, error: testBookingError } = await supabase
        .from("bookings")
        .select(`
          id, 
          booking_number,
          cleaner_id,
          cleaners!bookings_cleaner_id_fkey(
            id, 
            stripe_account_id, 
            payouts_enabled
          )
        `)
        .eq("status", "completed")
        .is("payout_status", null)
        .not("cleaner_id", "is", null)
        .limit(1)
        .maybeSingle();

      if (testBookingError || !testBooking) {
        results.execution = { error: "No eligible booking found for test payout" };
      } else {
        const cleaner = testBooking.cleaners as any;
        
        if (!cleaner?.stripe_account_id || !cleaner?.payouts_enabled) {
          results.execution = { error: "Cleaner not ready for payouts" };
        } else {
          // Invoke the actual payout function
          const payoutResponse = await supabase.functions.invoke('process-payout-for-cleaner', {
            body: {
              bookingId: testBooking.id,
              cleanerId: cleaner.id
            }
          });

          results.execution = {
            bookingId: testBooking.id,
            bookingNumber: testBooking.booking_number,
            cleanerId: cleaner.id,
            response: payoutResponse.data,
            error: payoutResponse.error?.message
          };
        }
      }
    }

    // Summary
    if (results.errors.length > 0) {
      results.isReady = false;
      results.summary = `❌ System not ready: ${results.errors.length} error(s) found`;
    } else if (results.warnings.length > 0) {
      results.summary = `⚠️ System ready with ${results.warnings.length} warning(s)`;
    } else {
      results.summary = "✅ Payout system is fully configured and ready";
    }

    logStep("Test completed", results.summary);

    return new Response(
      JSON.stringify(results, null, 2),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    
    results.errors.push(errorMessage);
    results.isReady = false;
    
    return new Response(
      JSON.stringify(results, null, 2),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
