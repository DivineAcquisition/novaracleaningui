import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[TEST-PAYMENT-SCENARIOS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Test function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const testResults = {
      timestamp: new Date().toISOString(),
      tests: [] as any[],
    };

    // Test 1: Check for bookings with various statuses
    logStep("Test 1: Checking booking statuses");
    const { data: bookingsByStatus, error: statusError } = await supabase
      .from("bookings")
      .select("status, count")
      .limit(100);

    if (statusError) {
      testResults.tests.push({
        name: "Booking Status Count",
        status: "ERROR",
        error: statusError.message,
      });
    } else {
      const statusCounts = bookingsByStatus?.reduce((acc: any, booking: any) => {
        acc[booking.status] = (acc[booking.status] || 0) + 1;
        return acc;
      }, {});

      testResults.tests.push({
        name: "Booking Status Distribution",
        status: "PASS",
        data: statusCounts,
      });
    }

    // Test 2: Check for pending payments older than 48 hours
    logStep("Test 2: Checking stale pending payments");
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: staleBookings, error: staleError } = await supabase
      .from("bookings")
      .select("id, email, created_at, status")
      .eq("status", "pending_payment")
      .lt("created_at", fortyEightHoursAgo);

    if (staleError) {
      testResults.tests.push({
        name: "Stale Pending Payments",
        status: "ERROR",
        error: staleError.message,
      });
    } else {
      testResults.tests.push({
        name: "Stale Pending Payments (>48hrs)",
        status: staleBookings && staleBookings.length > 0 ? "WARN" : "PASS",
        count: staleBookings?.length || 0,
        message: staleBookings && staleBookings.length > 0 
          ? "Found bookings that may need cleanup"
          : "No stale pending payments",
      });
    }

    // Test 3: Check for credit inconsistencies
    logStep("Test 3: Checking membership credit integrity");
    const { data: credits, error: creditError } = await supabase
      .from("membership_credits")
      .select("*");

    if (creditError) {
      testResults.tests.push({
        name: "Credit Integrity Check",
        status: "ERROR",
        error: creditError.message,
      });
    } else {
      const issues = credits?.filter((c: any) => {
        return c.credits_remaining < 0 || 
               c.credits_used < 0 ||
               (c.credits_used + c.credits_remaining) > (c.credits_per_month * 2);
      });

      testResults.tests.push({
        name: "Membership Credit Integrity",
        status: issues && issues.length > 0 ? "FAIL" : "PASS",
        totalRecords: credits?.length || 0,
        issuesFound: issues?.length || 0,
        issues: issues?.map((c: any) => ({
          customerId: c.customer_id,
          plan: c.membership_plan,
          remaining: c.credits_remaining,
          used: c.credits_used,
        })),
      });
    }

    // Test 4: Check for duplicate payment intents
    logStep("Test 4: Checking for duplicate payment intents");
    const { data: bookingsWithPI, error: piError } = await supabase
      .from("bookings")
      .select("payment_intent_id")
      .not("payment_intent_id", "is", null);

    if (piError) {
      testResults.tests.push({
        name: "Duplicate Payment Intent Check",
        status: "ERROR",
        error: piError.message,
      });
    } else {
      const paymentIntents = bookingsWithPI?.map((b: any) => b.payment_intent_id);
      const duplicates = paymentIntents?.filter((item: string, index: number) => 
        paymentIntents.indexOf(item) !== index
      );

      testResults.tests.push({
        name: "Duplicate Payment Intents",
        status: duplicates && duplicates.length > 0 ? "FAIL" : "PASS",
        totalPaymentIntents: paymentIntents?.length || 0,
        duplicatesFound: [...new Set(duplicates)].length,
      });
    }

    // Test 5: Check for bookings with credit but no customer_id
    logStep("Test 5: Checking for orphaned credit bookings");
    const { data: orphanedCredits, error: orphanError } = await supabase
      .from("bookings")
      .select("id, email, uses_credit, customer_id")
      .eq("uses_credit", true)
      .is("customer_id", null);

    if (orphanError) {
      testResults.tests.push({
        name: "Orphaned Credit Bookings",
        status: "ERROR",
        error: orphanError.message,
      });
    } else {
      testResults.tests.push({
        name: "Orphaned Credit Bookings",
        status: orphanedCredits && orphanedCredits.length > 0 ? "WARN" : "PASS",
        count: orphanedCredits?.length || 0,
        message: orphanedCredits && orphanedCredits.length > 0
          ? "Found bookings with credit flag but no customer_id"
          : "No orphaned credit bookings",
      });
    }

    // Calculate overall health score
    const totalTests = testResults.tests.length;
    const passedTests = testResults.tests.filter((t: any) => t.status === "PASS").length;
    const failedTests = testResults.tests.filter((t: any) => t.status === "FAIL").length;
    const warnings = testResults.tests.filter((t: any) => t.status === "WARN").length;

    testResults.tests.unshift({
      name: "Overall System Health",
      status: failedTests > 0 ? "FAIL" : warnings > 0 ? "WARN" : "PASS",
      score: `${passedTests}/${totalTests} tests passed`,
      summary: {
        passed: passedTests,
        failed: failedTests,
        warnings,
        errors: testResults.tests.filter((t: any) => t.status === "ERROR").length,
      },
    });

    logStep("Tests complete", { 
      passed: passedTests, 
      failed: failedTests, 
      warnings 
    });

    return new Response(
      JSON.stringify(testResults, null, 2),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    logStep("ERROR in test function", { message: error.message });
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
