import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";

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

    // Trigger Zapier webhook for assigned booking
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier webhook triggered");
    } catch (webhookError) {
      // Log but don't fail the assignment if webhook fails
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    // Notify the customer (best-effort, non-blocking).
    try {
      if (booking.phone) {
        const cleanerName = `${selectedCleaner.first_name} ${selectedCleaner.last_name}`.trim();
        await sendSms(supabase, {
          toPhone: booking.phone,
          message:
            `Novara Cleaning: ${cleanerName} has been assigned to your cleaning` +
            (booking.service_date ? ` on ${formatServiceDate(booking.service_date)}` : "") +
            (booking.time_slot ? ` (${formatTimeSlot(booking.time_slot)})` : "") +
            `. We'll send a reminder before service. Reply STOP to opt out.`,
          type: "confirmation",
        });
        logStep("Customer assignment SMS sent");
      }
    } catch (smsErr) {
      logStep("Customer assignment SMS failed (non-blocking)", {
        error: smsErr instanceof Error ? smsErr.message : String(smsErr),
      });
    }

    // Notify the cleaner that they've been assigned (manual-assign path — the
    // auto-dispatch path uses dispatch-job's job-offer SMS instead).
    try {
      if (selectedCleaner.phone) {
        await sendSms(supabase, {
          toPhone: selectedCleaner.phone,
          message:
            `Novara Cleaning: You've been assigned to a job` +
            (booking.service_date ? ` on ${formatServiceDate(booking.service_date)}` : "") +
            (booking.time_slot ? ` (${formatTimeSlot(booking.time_slot)})` : "") +
            ` at ${booking.address}, ${booking.city}. Open the Cleaner app for full details.`,
          type: "job_offer",
        });
        logStep("Cleaner assignment SMS sent");
      }
    } catch (smsErr) {
      logStep("Cleaner assignment SMS failed (non-blocking)", {
        error: smsErr instanceof Error ? smsErr.message : String(smsErr),
      });
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
