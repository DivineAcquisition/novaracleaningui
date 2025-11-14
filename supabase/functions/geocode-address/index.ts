import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[GEOCODE] ${step}${detailsStr}`);
};

/**
 * Geocode an address using OpenStreetMap Nominatim API (free, no key required)
 * Returns latitude and longitude coordinates
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { address, city, state, zip } = await req.json();
    logStep("Geocoding request", { city, state, zip });

    // Build query string
    const query = `${address || ''}, ${city || ''}, ${state || ''} ${zip || ''}`.trim();
    
    if (!query) {
      throw new Error("Address information required");
    }

    // Call Nominatim API (free geocoding service)
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'CleaningDispatchSystem/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data || data.length === 0) {
      // Fallback: try with just zip code
      if (zip) {
        logStep("Trying fallback with zip only", { zip });
        const zipUrl = `https://nominatim.openstreetmap.org/search?format=json&postalcode=${zip}&country=US&limit=1`;
        const zipResponse = await fetch(zipUrl, {
          headers: {
            'User-Agent': 'CleaningDispatchSystem/1.0'
          }
        });
        const zipData = await zipResponse.json();
        
        if (zipData && zipData.length > 0) {
          logStep("Geocoded via zip fallback", { lat: zipData[0].lat, lon: zipData[0].lon });
          return new Response(
            JSON.stringify({
              lat: parseFloat(zipData[0].lat),
              lng: parseFloat(zipData[0].lon),
              display_name: zipData[0].display_name
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
      }
      
      throw new Error("Address not found");
    }

    const result = data[0];
    logStep("Geocoded successfully", { lat: result.lat, lon: result.lon });

    return new Response(
      JSON.stringify({
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        display_name: result.display_name
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
