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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // Get authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user?.email) {
      throw new Error("Not authenticated");
    }

    const { bookingId, rating, review } = await req.json();

    // Validate input
    if (!bookingId || !rating || rating < 1 || rating > 5) {
      throw new Error("Invalid rating data");
    }

    console.log(`Processing rating for booking ${bookingId} by user ${user.email}`);

    // Get booking details
    const { data: booking, error: bookingError } = await supabaseClient
      .from("bookings")
      .select("id, email, status, cleaner_id, rating_submitted")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    // Validate booking status
    if (booking.status !== "completed") {
      throw new Error("Can only rate completed bookings");
    }

    // Validate customer email matches
    if (booking.email !== user.email) {
      throw new Error("Not authorized to rate this booking");
    }

    // Check if already rated
    if (booking.rating_submitted) {
      throw new Error("Booking already rated");
    }

    // Check if cleaner assigned
    if (!booking.cleaner_id) {
      throw new Error("No cleaner assigned to this booking");
    }

    // Insert rating
    const { error: ratingError } = await supabaseClient
      .from("cleaner_ratings")
      .insert({
        booking_id: bookingId,
        cleaner_id: booking.cleaner_id,
        customer_email: user.email,
        rating,
        review: review || null,
      });

    if (ratingError) {
      console.error("Error inserting rating:", ratingError);
      throw new Error("Failed to save rating");
    }

    // Update booking
    const { error: updateError } = await supabaseClient
      .from("bookings")
      .update({ rating_submitted: true })
      .eq("id", bookingId);

    if (updateError) {
      console.error("Error updating booking:", updateError);
    }

    // Recalculate cleaner's average rating
    const { data: ratings } = await supabaseClient
      .from("cleaner_ratings")
      .select("rating")
      .eq("cleaner_id", booking.cleaner_id);

    if (ratings && ratings.length > 0) {
      const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
      
      await supabaseClient
        .from("cleaners")
        .update({
          average_rating: avgRating.toFixed(2),
          total_ratings: ratings.length,
        })
        .eq("id", booking.cleaner_id);
    }

    console.log(`Rating submitted successfully for booking ${bookingId}`);

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in submit-rating function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
