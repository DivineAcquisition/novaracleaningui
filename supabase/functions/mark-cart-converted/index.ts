import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MarkConvertedRequest {
  email?: string;
  cartId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: MarkConvertedRequest = await req.json();
    const { email, cartId } = body;

    if (!email && !cartId) {
      return new Response(
        JSON.stringify({ error: "Either email or cartId is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Marking cart as converted: ${cartId || email}`);

    let query = supabase
      .from("abandoned_carts")
      .update({
        converted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (cartId) {
      query = query.eq("id", cartId);
    } else if (email) {
      query = query.eq("email", email.toLowerCase()).is("converted_at", null);
    }

    const { data, error } = await query.select();

    if (error) {
      console.error("Error marking cart converted:", error);
      throw new Error("Failed to mark cart as converted");
    }

    console.log(`Marked ${data?.length || 0} carts as converted`);

    return new Response(
      JSON.stringify({ success: true, convertedCount: data?.length || 0 }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in mark-cart-converted:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
