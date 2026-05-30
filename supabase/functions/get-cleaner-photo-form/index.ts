// ─── get-cleaner-photo-form ──────────────────────────────────────────────
//
// Public, token-protected resolver used by the /cleaner/job-photos/[token]
// page so an SMS-only cleaner (no login) can pull just enough booking
// detail to render the upload form.
//
// Body / query: { token: string }
// Response (200): {
//   ok: true,
//   bookingNumber,
//   serviceDate,
//   timeSlot,
//   addressLine, // street + city only (last 2 of ZIP), no PII beyond that
//   cleanerFirstName,
//   beforeCount, afterCount, alreadySubmitted: bool
// }
// Response (404|410): { ok: false, reason }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
      token = String((body as any)?.token || "");
    } else {
      token = new URL(req.url).searchParams.get("token") || "";
    }
    if (!token) return json({ ok: false, reason: "missing_token" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: b } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, first_name, last_name, service_date, time_slot, address, city, state, zip_code, status, before_photos, after_photos, cleaner_id, photo_upload_submitted_at",
      )
      .eq("photo_upload_token", token)
      .maybeSingle();
    if (!b) return json({ ok: false, reason: "not_found" }, 404);

    let cleanerFirstName: string | null = null;
    if (b.cleaner_id) {
      const { data: c } = await supabase
        .from("cleaners")
        .select("first_name")
        .eq("id", b.cleaner_id)
        .maybeSingle();
      cleanerFirstName = c?.first_name || null;
    }

    const addressLine = [b.address, b.city]
      .filter(Boolean)
      .join(", ");

    return json({
      ok: true,
      bookingId: b.id,
      bookingNumber: b.booking_number,
      serviceDate: b.service_date,
      timeSlot: b.time_slot,
      customerFirstName: b.first_name || null,
      addressLine,
      cleanerFirstName,
      status: b.status,
      beforeCount: Array.isArray(b.before_photos) ? b.before_photos.length : 0,
      afterCount: Array.isArray(b.after_photos) ? b.after_photos.length : 0,
      alreadySubmitted: !!b.photo_upload_submitted_at,
    });
  } catch (err) {
    return json({ ok: false, reason: "server_error", message: (err as Error).message }, 500);
  }
});
