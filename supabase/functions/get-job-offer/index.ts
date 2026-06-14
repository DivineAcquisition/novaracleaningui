// get-job-offer
//
// Token-only access — the response_token IS the credential. Returns the
// assignment + job + scrubbed customer info + cleaner first name so the
// /cleaner/job-offer/[token] page can render everything.
//
// Body: { token: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: assignment, error: aErr } = await supabase
      .from("job_assignments")
      .select(
        "id, job_id, cleaner_id, status, role, distance_miles, pay_rate_hr, pay_percentage_snapshot, estimated_pay_cents, expires_at, accepted_at, declined_at, response_token",
      )
      .eq("response_token", token)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!assignment) {
      return new Response(JSON.stringify({ error: "Offer not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const [{ data: job }, { data: cleaner }] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, customer_id, service_type, start_datetime, duration_est_hours, bedrooms, bathrooms, sq_ft, address, city, state, zip, notes",
        )
        .eq("id", assignment.job_id)
        .maybeSingle(),
      supabase
        .from("cleaners")
        .select("id, first_name, last_name")
        .eq("id", assignment.cleaner_id)
        .maybeSingle(),
    ]);

    let customer: { first_name: string | null; phone_last4: string | null } = {
      first_name: null,
      phone_last4: null,
    };
    if (job?.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("first_name, phone")
        .eq("id", job.customer_id)
        .maybeSingle();
      if (c) customer = { first_name: c.first_name, phone_last4: maskPhone(c.phone) };
    }

    // Pull the linked booking's canonical service date + arrival window.
    // jobs.start_datetime is stored tz-naive and historically defaulted to
    // 09:00, so the offer page must display the booking's real time_slot
    // (the same thing the customer booked) rather than re-deriving the time
    // from the timestamp.
    let booking: {
      service_date: string | null;
      time_slot: string | null;
      arrival_window: string | null;
    } | null = null;
    if (assignment.job_id) {
      const { data: b } = await supabase
        .from("bookings")
        .select("service_date, time_slot, arrival_window")
        .eq("job_id", assignment.job_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (b) {
        booking = {
          service_date: b.service_date ?? null,
          time_slot: b.time_slot ?? null,
          arrival_window: b.arrival_window ?? null,
        };
      }
    }

    // Don't leak the raw token back out.
    const { response_token: _omit, ...assignmentPublic } = assignment as any;

    return new Response(
      JSON.stringify({
        assignment: assignmentPublic,
        job: job || null,
        booking,
        customer,
        cleaner: { first_name: cleaner?.first_name || null },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[get-job-offer] error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
