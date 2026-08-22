import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CLEANUP-PENDING-BOOKINGS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Cleanup function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 72 hours so the day-2 abandoned-checkout reminder can fire before cleanup.
    const seventyTwoHoursAgo = new Date();
    seventyTwoHoursAgo.setHours(seventyTwoHoursAgo.getHours() - 72);

    logStep("Cutoff time calculated", { cutoff: seventyTwoHoursAgo.toISOString() });

    // Find abandoned public-checkout pending_payment bookings older than
    // 72 hours. Invoice-backed pending deposits are auto-cancelled (not
    // deleted) by pending-deposit-reminders so ops can reinstate them.
    const { data: oldBookings, error: fetchError } = await supabase
      .from("bookings")
      .select("id, email, created_at, service_date, hosted_invoice_url, stripe_invoice_id")
      .eq("status", "pending_payment")
      .lt("created_at", seventyTwoHoursAgo.toISOString());

    if (fetchError) {
      logStep("Error fetching old bookings", fetchError);
      throw fetchError;
    }

    logStep("Found old pending bookings", { count: oldBookings?.length || 0 });

    if (!oldBookings || oldBookings.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          deleted: 0, 
          message: "No old pending bookings to clean up" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const bookingIds = oldBookings
      .filter((b) => !b.hosted_invoice_url && !b.stripe_invoice_id)
      .map((b) => b.id);
    if (bookingIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          deleted: 0,
          message: "No abandoned public-checkout bookings to clean up",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }
    
    const { error: deleteError } = await supabase
      .from("bookings")
      .delete()
      .in("id", bookingIds);

    if (deleteError) {
      logStep("Error deleting bookings", deleteError);
      throw deleteError;
    }

    logStep("Cleanup complete", { 
      deleted: oldBookings.length,
      bookingIds: bookingIds 
    });

    return new Response(
      JSON.stringify({
        success: true,
        deleted: oldBookings.length,
        message: `Cleaned up ${oldBookings.length} abandoned bookings`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    logStep("ERROR in cleanup function", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
