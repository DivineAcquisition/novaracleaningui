// admin-booking-checklist
//
// Hands the admin Bookings tab a read key for one booking's cleaning checklist.
//
// Admins could already see checklist progress on the Dispatch board and in QC,
// but not in Bookings — which is where you are standing when a customer asks
// what's included, or whether the oven actually got done. Answering meant going
// to find the job on another screen.
//
// This deliberately does NOT resolve the checklist content. `cleaner-job-checklist`
// already turns a token into sections, items and progress, and duplicating that
// resolution here would mean a second copy of the checklist templates drifting
// out of step with the crew's. So this only does the part that endpoint can't:
// find the booking's job and make sure a checklist row exists to point at.
// The caller then reads it through the existing token path, read-only.
//
// Admin/VA JWT required — this is not a tokenized contractor endpoint.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CONTRACTOR_PORTAL_BASE = "https://contractor.novaracleaning.com";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    try {
      await ensureAdminOrVa(admin, jwt);
    } catch (e) {
      return json({ error: (e as Error).message }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const { data: booking, error: bookingErr } = await admin
      .from("bookings")
      .select("id, service_type, job_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingErr) return json({ error: bookingErr.message }, 500);
    if (!booking) return json({ error: "Booking not found." }, 404);

    // A checklist belongs to a job, so an undispatched booking has nowhere to
    // hang one yet. Say so plainly instead of inventing an empty checklist.
    if (!booking.job_id) {
      return json({ ok: true, hasJob: false, token: null, contractorUrl: null });
    }

    const jobId = String(booking.job_id);
    const { data: existing } = await admin
      .from("job_checklists")
      .select("token")
      .eq("job_id", jobId)
      .maybeSingle();

    let token: string | null = existing?.token ?? null;

    if (!token) {
      // Jobs dispatched before checklists existed (and any the assign path
      // missed) have no row. Create it now so the crew's progress has somewhere
      // to land the moment they start.
      //
      // total_items is left at its default of 0: the reader recomputes it from
      // the template it resolves, so it self-corrects on first read rather than
      // needing the templates duplicated into this function.
      const fresh = randomToken();
      const { data: created, error: insertErr } = await admin
        .from("job_checklists")
        .insert({
          job_id: jobId,
          booking_id: booking.id,
          // Stored raw; the reader normalizes service types when picking a
          // template, so this does not need to be pre-normalized here.
          service_type: booking.service_type || "standard",
          token: fresh,
        })
        .select("token")
        .maybeSingle();

      if (insertErr) {
        // Another path created it in between — read it back rather than failing.
        const { data: raced } = await admin
          .from("job_checklists")
          .select("token")
          .eq("job_id", jobId)
          .maybeSingle();
        token = raced?.token ?? null;
        if (!token) return json({ error: insertErr.message }, 500);
      } else {
        token = created?.token ?? fresh;
      }
    }

    return json({
      ok: true,
      hasJob: true,
      token,
      contractorUrl: `${CONTRACTOR_PORTAL_BASE}/cleaner/job-checklist/${token}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-booking-checklist]", msg);
    return json({ error: msg }, 500);
  }
});
