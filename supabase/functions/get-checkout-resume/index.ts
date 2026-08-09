// get-checkout-resume
//
// Public lookup for a pending_payment booking by checkout_resume_token.
// Returns only the funnel fields needed to rehydrate /book/checkout.
// Never returns payment secrets or admin notes.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || body.resume_token || "").trim();
    if (!/^[a-f0-9]{40}$/i.test(token)) {
      return new Response(JSON.stringify({ error: "Invalid resume token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, status, email, first_name, last_name, phone, address, city, state, zip_code, home_size_id, service_type, add_ons, service_date, time_slot, membership_plan, payment_option, bedrooms, bathrooms, dwelling_type, referral_code, focused_areas, condition_level, is_same_day, same_day_acknowledged_at, booking_channel, hosted_invoice_url, stripe_invoice_id",
      )
      .eq("checkout_resume_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!booking) {
      return new Response(JSON.stringify({ error: "Resume link not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (booking.status !== "pending_payment") {
      return new Response(
        JSON.stringify({
          error: "This booking is no longer awaiting checkout",
          status: booking.status,
        }),
        {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Internal / invoice flows use /pay/[token], not public checkout resume.
    if (
      booking.booking_channel === "admin" ||
      booking.hosted_invoice_url ||
      booking.stripe_invoice_id
    ) {
      return new Response(
        JSON.stringify({ error: "Use the deposit payment link for this booking" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        booking: {
          bookingId: booking.id,
          bookingNumber: booking.booking_number,
          zipCode: booking.zip_code || "",
          homeSizeId: booking.home_size_id || "",
          serviceType: booking.service_type || "",
          addOns: booking.add_ons || [],
          membershipPlan: booking.membership_plan || "none",
          serviceDate: booking.service_date || "",
          timeSlot: booking.time_slot || "",
          firstName: booking.first_name || "",
          lastName: booking.last_name || "",
          email: booking.email || "",
          phone: booking.phone || "",
          address: booking.address || "",
          city: booking.city || "",
          state: booking.state || "",
          paymentOption: booking.payment_option === "full" ? "full" : "deposit",
          bedrooms: booking.bedrooms ?? undefined,
          bathrooms: booking.bathrooms ?? undefined,
          dwellingType: booking.dwelling_type || undefined,
          referralCode: booking.referral_code || undefined,
          focusedAreas: booking.focused_areas || [],
          conditionLevel: booking.condition_level || "normal",
          isSameDay: !!booking.is_same_day,
          sameDayAcknowledgedAt: booking.same_day_acknowledged_at || null,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
