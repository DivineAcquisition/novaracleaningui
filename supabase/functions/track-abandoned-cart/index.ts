import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrackCartRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  zipCode?: string;
  homeSize?: string;
  serviceType?: string;
  lastStep: string;
  bookingData?: Record<string, any>;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: TrackCartRequest = await req.json();
    const { 
      email, 
      firstName, 
      lastName, 
      phone, 
      zipCode, 
      homeSize, 
      serviceType, 
      lastStep,
      bookingData 
    } = body;

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Tracking abandoned cart for ${email} at step: ${lastStep}`);

    // Check for existing cart for this email (within last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const { data: existingCart } = await supabase
      .from("abandoned_carts")
      .select("id, converted_at")
      .eq("email", email.toLowerCase())
      .is("converted_at", null)
      .gt("created_at", twentyFourHoursAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (existingCart) {
      // Update existing cart
      const { error: updateError } = await supabase
        .from("abandoned_carts")
        .update({
          first_name: firstName,
          last_name: lastName,
          phone,
          zip_code: zipCode,
          home_size: homeSize,
          service_type: serviceType,
          last_step: lastStep,
          booking_data: bookingData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingCart.id);

      if (updateError) {
        console.error("Error updating cart:", updateError);
        throw new Error("Failed to update cart");
      }

      console.log(`Updated existing cart: ${existingCart.id}`);
      return new Response(
        JSON.stringify({ success: true, cartId: existingCart.id, updated: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create new cart
    const { data: newCart, error: insertError } = await supabase
      .from("abandoned_carts")
      .insert({
        email: email.toLowerCase(),
        first_name: firstName,
        last_name: lastName,
        phone,
        zip_code: zipCode,
        home_size: homeSize,
        service_type: serviceType,
        last_step: lastStep,
        booking_data: bookingData,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating cart:", insertError);
      throw new Error("Failed to create cart");
    }

    console.log(`Created new cart: ${newCart.id}`);
    return new Response(
      JSON.stringify({ success: true, cartId: newCart.id, created: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in track-abandoned-cart:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
