import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Save the public booking-funnel "property details" step.
//
// The funnel runs as a guest (anon), and bookings has RLS with no public
// UPDATE policy — so a direct client update silently writes 0 rows and the
// street/beds/baths never persist, which made /book/details bounce back from
// the confirmation page forever. This function performs the write with the
// service role, but only:
//   - for a booking that exists and is still pre-completion
//   - on an explicit whitelist of property-detail columns (never price,
//     payout, status, payment, etc.)
//
// Booking ids are unguessable UUIDs, matching the funnel's existing
// public-insert / public-read trust model.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const bookingId: string | undefined = body.bookingId;
    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: loadErr } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (loadErr || !booking) return json({ error: "Booking not found" }, 404);

    const status = (booking as { status?: string }).status || "";
    if (["cancelled", "completed"].includes(status)) {
      return json({ error: "Booking can no longer be edited" }, 409);
    }

    // Whitelist of editable property-detail columns. Anything else in the
    // body is ignored.
    const updates: Record<string, unknown> = {};
    const setStr = (col: string, v: unknown) => {
      if (typeof v === "string" && v.trim().length > 0) updates[col] = v.trim();
    };

    setStr("address", body.address);
    setStr("city", body.city);
    setStr("state", body.state);
    setStr("zip_code", body.zipCode);
    setStr("dwelling_type", body.dwellingType);
    setStr("flooring_type", body.flooringType);
    setStr("pets", body.pets);
    setStr("access_notes", body.accessNotes);
    setStr("offer_type", body.offerType);
    setStr("second_visit_date", body.secondVisitDate);
    setStr("second_visit_time_slot", body.secondVisitTimeSlot);
    setStr("second_visit_start_time", body.secondVisitStartTime);
    setStr("second_visit_end_time", body.secondVisitEndTime);

    // Numeric fields — 0 is a legitimate value (studio / no full baths), so
    // accept anything that parses to a finite number.
    if (body.bedrooms !== undefined && body.bedrooms !== null && body.bedrooms !== "") {
      const n = parseInt(String(body.bedrooms), 10);
      if (Number.isFinite(n)) updates["bedrooms"] = n;
    }
    if (body.bathrooms !== undefined && body.bathrooms !== null && body.bathrooms !== "") {
      const n = parseFloat(String(body.bathrooms));
      if (Number.isFinite(n)) updates["bathrooms"] = n;
    }

    if (Object.keys(updates).length === 0) {
      return json({ error: "No valid fields to update" }, 400);
    }

    const { error: updErr } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", bookingId);

    if (updErr) return json({ error: updErr.message }, 500);

    return json({ success: true, updated: Object.keys(updates) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
