import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[GEOCODE] ${step}${detailsStr}`);
};

// US state name → 2-letter code map for the rare cases where Nominatim
// returns the full state name instead of the abbreviation.
const STATE_NAME_TO_CODE: Record<string, string> = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC",
  "florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL",
  "indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA",
  "maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI",
  "minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT",
  "nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ",
  "new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND",
  "ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA",
  "rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN",
  "texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA",
  "west virginia":"WV","wisconsin":"WI","wyoming":"WY",
};

/**
 * Reduce Nominatim's `address` object down to the four shapes the
 * client cares about. Nominatim varies by region — apartments use
 * `road`, rural homes sometimes use `pedestrian`/`hamlet`, etc. — so
 * we coalesce across all the common keys.
 */
function pickAddressParts(addr: any): {
  street: string; city: string; state: string; zipCode: string;
} {
  if (!addr || typeof addr !== "object") {
    return { street: "", city: "", state: "", zipCode: "" };
  }
  const houseNumber = (addr.house_number || "").toString().trim();
  const road = (addr.road || addr.pedestrian || addr.footway || addr.path || "").toString().trim();
  const street = [houseNumber, road].filter(Boolean).join(" ").trim();
  const city = (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.suburb ||
    addr.municipality ||
    addr.county ||
    ""
  ).toString().trim();
  let state = (addr.state_code || "").toString().trim().toUpperCase();
  if (!state && addr.state) {
    const norm = String(addr.state).toLowerCase().trim();
    state = STATE_NAME_TO_CODE[norm] || String(addr.state).slice(0, 2).toUpperCase();
  }
  const zipCode = (addr.postcode || "").toString().trim().slice(0, 5);
  return { street, city, state, zipCode };
}

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

    // Call Nominatim API (free geocoding service).
    // `addressdetails=1` makes the response include a parsed `address`
    // object (house_number, road, city, state, postcode, …) so the
    // client can drop each component into the right field rather than
    // dumping the whole display string into the Street column.
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&q=${encodeURIComponent(query)}&limit=1`;
    
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
        const zipUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&postalcode=${zip}&country=US&limit=1`;
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
              display_name: zipData[0].display_name,
              parsed: pickAddressParts(zipData[0].address),
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
        display_name: result.display_name,
        // Parsed address parts so the client can drop them directly
        // into Street / City / State / ZIP without re-parsing the
        // display string.
        parsed: pickAddressParts(result.address),
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
