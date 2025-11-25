import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting cleanup of old availability slots...");
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Calculate cutoff date (90 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoffDateString = cutoffDate.toISOString().split('T')[0];

    console.log(`Deleting availability slots older than ${cutoffDateString}`);

    // Delete old slots
    const { data, error, count } = await supabaseClient
      .from('availability_slots')
      .delete({ count: 'exact' })
      .lt('service_date', cutoffDateString);

    if (error) {
      console.error("Error deleting old slots:", error);
      return new Response(
        JSON.stringify({ 
          error: error.message,
          details: error 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    const deletedCount = count || 0;
    console.log(`Successfully deleted ${deletedCount} old availability slots`);

    // Also clean up old bookings in 'pending_payment' status older than 48 hours
    const twoDaysAgo = new Date();
    twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);
    const twoDaysAgoString = twoDaysAgo.toISOString();

    const { count: pendingCount, error: pendingError } = await supabaseClient
      .from('bookings')
      .delete({ count: 'exact' })
      .eq('status', 'pending_payment')
      .lt('created_at', twoDaysAgoString);

    if (pendingError) {
      console.error("Error cleaning up pending bookings:", pendingError);
    } else {
      console.log(`Cleaned up ${pendingCount || 0} old pending bookings`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        slotsDeleted: deletedCount,
        pendingBookingsDeleted: pendingCount || 0,
        cutoffDate: cutoffDateString,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error: any) {
    console.error("Error in cleanup-old-slots:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
