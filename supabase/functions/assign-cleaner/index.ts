import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ASSIGN-CLEANER] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    logStep("Starting assignment", { bookingId });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    logStep("Retrieved booking", { zipCode: booking.zip_code });

    // Strategy 1: Find cleaner who services this ZIP code
    let { data: availableCleaners } = await supabase
      .from("cleaners")
      .select("*")
      .eq("status", "active")
      .eq("available_for_bookings", true)
      .eq("payouts_enabled", true)
      .contains("service_zip_codes", [booking.zip_code])
      .order("total_bookings", { ascending: true });

    // Strategy 2: If no ZIP-specific cleaner, find any available cleaner
    if (!availableCleaners || availableCleaners.length === 0) {
      logStep("No ZIP-specific cleaners, trying all available");
      const { data } = await supabase
        .from("cleaners")
        .select("*")
        .eq("status", "active")
        .eq("available_for_bookings", true)
        .eq("payouts_enabled", true)
        .order("total_bookings", { ascending: true })
        .limit(10);
      
      availableCleaners = data || [];
    }

    if (!availableCleaners || availableCleaners.length === 0) {
      throw new Error("No available cleaners found");
    }

    logStep("Found available cleaners", { count: availableCleaners.length });

    // Get the cleaner with fewest bookings (round-robin)
    let selectedCleaner = availableCleaners[0];

    // Check weekly booking limit
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    
    const { count: weeklyBookings } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("cleaner_id", selectedCleaner.id)
      .gte("service_date", startOfWeek.toISOString().split("T")[0]);

    if (weeklyBookings && weeklyBookings >= selectedCleaner.max_weekly_bookings) {
      logStep("First cleaner at capacity, trying next");
      // Try next cleaner
      if (availableCleaners.length > 1) {
        selectedCleaner = availableCleaners[1];
      } else {
        throw new Error("All cleaners at capacity");
      }
    }

    logStep("Selected cleaner", { id: selectedCleaner.id, name: `${selectedCleaner.first_name} ${selectedCleaner.last_name}` });

    // Assign cleaner to booking
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        cleaner_id: selectedCleaner.id,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (updateError) throw updateError;

    // Increment cleaner's total bookings
    await supabase
      .from("cleaners")
      .update({
        total_bookings: selectedCleaner.total_bookings + 1,
      })
      .eq("id", selectedCleaner.id);

    logStep("Assignment complete");

    // Trigger webhooks for assigned booking
    try {
      // Trigger booking update webhook (Zapier/GHL)
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier booking webhook triggered");
      
      // Trigger cleaner assignment specific webhook
      await supabase.functions.invoke('send-cleaner-assignment-webhook', {
        body: { bookingId, cleanerId: selectedCleaner.id, assignmentType: 'assigned' }
      });
      logStep("Cleaner assignment webhook triggered");
    } catch (webhookError) {
      // Log but don't fail the assignment if webhook fails
      logStep("Webhook failed (non-critical)", { error: webhookError });
    }

    return new Response(
      JSON.stringify({
        success: true,
        cleaner: {
          id: selectedCleaner.id,
          name: `${selectedCleaner.first_name} ${selectedCleaner.last_name}`,
          email: selectedCleaner.email,
        },
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
