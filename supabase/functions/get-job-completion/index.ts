// get-job-completion
//
// Token-only access. Returns the full job + customer + cleaner so the
// /cleaner/job/[token]/complete page can render the wrap-up form.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
        "id, job_id, cleaner_id, status, role, estimated_pay_cents, completion_submitted_at, completion_outcome, before_photo_urls, after_photo_urls, completion_token",
      )
      .eq("completion_token", token)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!assignment) {
      return new Response(JSON.stringify({ error: "Not found" }), {
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
    let customer: { first_name: string | null } = { first_name: null };
    if (job?.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("first_name")
        .eq("id", job.customer_id)
        .maybeSingle();
      if (c) customer = { first_name: c.first_name };
    }
    const { completion_token: _omit, ...assignmentPublic } = assignment as any;
    return new Response(
      JSON.stringify({
        assignment: assignmentPublic,
        job: job || null,
        customer,
        cleaner: { first_name: cleaner?.first_name || null },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[get-job-completion] error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
