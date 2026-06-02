import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { TESTIMONIAL_QUESTIONS } from "../_shared/testimonial-offer.ts";

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
    let token = "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      token = String((body as { token?: string })?.token || "");
    } else {
      token = new URL(req.url).searchParams.get("token") || "";
    }
    if (!token) return json({ ok: false, reason: "missing_token" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: offer } = await supabase
      .from("testimonial_offers")
      .select(
        "id, status, customer_first_name, promo_code, submitted_at, booking_id, bookings(booking_number, service_date, service_type)",
      )
      .eq("submit_token", token)
      .maybeSingle();

    if (!offer) return json({ ok: false, reason: "not_found" }, 404);

    const booking = (offer as unknown as { bookings?: Record<string, unknown> }).bookings;

    return json({
      ok: true,
      status: offer.status,
      firstName: offer.customer_first_name,
      promoCode: offer.status === "submitted" ? offer.promo_code : null,
      submittedAt: offer.submitted_at,
      bookingNumber: booking?.booking_number ?? null,
      serviceDate: booking?.service_date ?? null,
      serviceType: booking?.service_type ?? null,
      questions: TESTIMONIAL_QUESTIONS,
    });
  } catch (err) {
    return json(
      { ok: false, reason: "server_error", message: (err as Error).message },
      500,
    );
  }
});
