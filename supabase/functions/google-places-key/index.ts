import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

/**
 * Edge function to securely provide the Google Places API key to the
 * frontend. The key never ships in the client bundle and the response
 * is short-cached at the CDN-edge because Places quota is billed per
 * load. Reads via the DB-override layer first so the key can be
 * rotated by inserting / updating a `public.app_secrets` row with
 * key='GOOGLE_PLACES_API_KEY' — falling back to the function env
 * var if no DB override exists.
 *
 * Returns `{ apiKey: "" }` with a 200 status when no key is configured
 * yet so the client can render a graceful fallback (Nominatim) rather
 * than breaking the booking flow with a 500.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const apiKey = await resolveSecret(supabase, "GOOGLE_PLACES_API_KEY");

    return new Response(
      JSON.stringify({ apiKey: apiKey || "" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in google-places-key function:", error);
    return new Response(
      JSON.stringify({ error: errorMessage, apiKey: "" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  }
});
