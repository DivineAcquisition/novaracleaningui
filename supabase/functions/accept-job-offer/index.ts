// accept-job-offer
//
// Token-protected accept/decline endpoint for the cleaner job-offer
// SMS link. On accept:
//   * Validates the offer exists, isn't expired, and isn't already taken.
//   * Runs has_overlap_for_cleaner RPC to enforce "no concurrent jobs
//     with overlapping windows". Cleaner can still hold 3-4 jobs across
//     the week as long as the time windows don't intersect.
//   * Atomically flips the assignment to Confirmed.
//   * Pushes the cleaner's name + phone onto the customer's GHL
//     contact via custom fields (1_contractor / 2_contractor /
//     3_contractor depending on role + slot availability).
//   * Stamps bookings.cleaner_id (when Lead) + jobs.status='Assigned'.
//
// Body: { token: string, action: 'accept' | 'decline' }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { runJobDispatchBackfill } from "../_shared/dispatch-backfill.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: unknown) =>
  console.log(`[ACCEPT-OFFER] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const action = String(body?.action || "").toLowerCase();
    if (!token || (action !== "accept" && action !== "decline")) {
      return new Response(
        JSON.stringify({ ok: false, reason: "bad_request", message: "Missing token or action" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: assignment } = await supabase
      .from("job_assignments")
      .select("id, job_id, cleaner_id, role, status, expires_at, estimated_pay_cents")
      .eq("response_token", token)
      .maybeSingle();
    if (!assignment) {
      return new Response(
        JSON.stringify({ ok: false, reason: "not_found", message: "Offer not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 },
      );
    }

    const status = String(assignment.status || "").toLowerCase();
    if (status === "confirmed" || status === "accepted") {
      return new Response(JSON.stringify({ ok: true, status: "already_accepted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    if (status === "declined" || status === "withdrawn") {
      return new Response(JSON.stringify({ ok: true, status: "already_declined" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (assignment.expires_at && new Date(assignment.expires_at).getTime() < Date.now()) {
      await supabase.from("job_assignments").update({ status: "Expired" }).eq("id", assignment.id);
      return new Response(
        JSON.stringify({ ok: false, reason: "expired", message: "Offer expired" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 410 },
      );
    }

    // ─── DECLINE ───────────────────────────────────────────────────────
    if (action === "decline") {
      await supabase
        .from("job_assignments")
        .update({
          status: "Declined",
          declined_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
        })
        .eq("id", assignment.id);

      try {
        await runJobDispatchBackfill(
          supabase,
          assignment.job_id,
          "Cleaner declined the job offer",
        );
      } catch (err) {
        log("backfill after decline failed", err instanceof Error ? err.message : String(err));
      }

      return new Response(JSON.stringify({ ok: true, status: "Declined" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── ACCEPT ────────────────────────────────────────────────────────
    const { data: job } = await supabase
      .from("jobs")
      .select("id, customer_id, start_datetime, duration_est_hours, status")
      .eq("id", assignment.job_id)
      .maybeSingle();
    if (!job || !job.start_datetime) {
      return new Response(
        JSON.stringify({ ok: false, reason: "missing_job", message: "Job is missing schedule" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      );
    }

    const startIso = new Date(job.start_datetime).toISOString();
    const endIso = new Date(
      new Date(job.start_datetime).getTime() + (Number(job.duration_est_hours) || 3) * 60 * 60 * 1000,
    ).toISOString();

    const { data: overlapResult } = await supabase.rpc("has_overlap_for_cleaner" as any, {
      _cleaner_id: assignment.cleaner_id,
      _start_at: startIso,
      _end_at: endIso,
      _exclude_id: assignment.id,
    });
    if (overlapResult === true) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "overlap",
          message: "You already accepted another job that overlaps with this time window.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      );
    }

    // Atomically flip THIS assignment to Confirmed only if it's still
    // in a takeable state (Offered or Broadcast). Then, for broadcast
    // jobs, retire every OTHER broadcast row on the same job to
    // 'Broadcast_Lost' so siblings see "already taken" when they click.
    const takeableStatuses = ["offered", "broadcast"];
    const wasBroadcast = status === "broadcast";
    const { data: updated, error: updateErr } = await supabase
      .from("job_assignments")
      .update({
        status: "Confirmed",
        role: wasBroadcast ? "Lead" : assignment.role || "Lead",
        accepted_at: new Date().toISOString(),
        responded_at: new Date().toISOString(),
      })
      .eq("id", assignment.id)
      .in("status", takeableStatuses.map((s) => s.charAt(0).toUpperCase() + s.slice(1)))
      .select("id, role")
      .maybeSingle();
    if (updateErr) throw updateErr;
    if (!updated) {
      // Try a case-insensitive variant for legacy rows.
      const { data: updated2 } = await supabase
        .from("job_assignments")
        .update({
          status: "Confirmed",
          role: wasBroadcast ? "Lead" : assignment.role || "Lead",
          accepted_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
        })
        .eq("id", assignment.id)
        .or("status.ilike.offered,status.ilike.broadcast")
        .select("id")
        .maybeSingle();
      if (!updated2) {
        return new Response(
          JSON.stringify({ ok: false, reason: "taken", message: "Offer is no longer available." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }
    }

    // First-to-claim cleanup for broadcast jobs — bulk-mark the other
    // broadcast rows as Broadcast_Lost so they can't be double-claimed
    // and the cleaners see a graceful "already taken" on the offer page.
    if (wasBroadcast) {
      try {
        await supabase
          .from("job_assignments")
          .update({ status: "Broadcast_Lost" })
          .eq("job_id", assignment.job_id)
          .neq("id", assignment.id)
          .ilike("status", "broadcast");
      } catch (_) { /* non-fatal */ }
      // Update the cleaner's role on the winning row to Lead — the
      // broadcast had no roles assigned. (Already done above when we
      // updated.)
    }

    const { count: confirmedCount } = await supabase
      .from("job_assignments")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id)
      .or("status.ilike.confirmed,status.ilike.accepted");

    const { data: jobMeta } = await supabase
      .from("jobs")
      .select("min_cleaners_required")
      .eq("id", job.id)
      .maybeSingle();
    const needCleaners = Number(jobMeta?.min_cleaners_required) || 1;
    const haveCleaners = confirmedCount ?? 0;

    if (haveCleaners >= needCleaners) {
      if (job.status !== "Assigned" && job.status !== "In Progress") {
        await supabase.from("jobs").update({ status: "Assigned" }).eq("id", job.id);
      }
    } else {
      await supabase.from("jobs").update({ status: "Offered" }).eq("id", job.id);
    }

    // Bookkeeping on bookings table.
    let bookingRow: {
      id: string;
      ghl_contact_id?: string | null;
      num_cleaners_assigned?: number | null;
    } | null = null;
    if (job.customer_id) {
      const { data: b } = await supabase
        .from("bookings")
        .select("id, ghl_contact_id, num_cleaners_assigned")
        .eq("job_id", job.id)
        .limit(1)
        .maybeSingle();
      bookingRow = (b as any) || null;
      // Use the EFFECTIVE role, not the pre-update one. Broadcast offers
      // carry role "Broadcast" before acceptance; the winner is promoted
      // to "Lead" above. Checking the stale assignment.role here meant
      // broadcast winners never got bookings.cleaner_id set, so
      // complete-booking later failed with "No cleaner assigned".
      const effectiveRole = wasBroadcast ? "lead" : String(assignment.role || "lead").toLowerCase();
      if (bookingRow && effectiveRole === "lead") {
        await supabase
          .from("bookings")
          .update({
            cleaner_id: assignment.cleaner_id,
            assigned_at: new Date().toISOString(),
            status: haveCleaners >= needCleaners ? "assigned" : "confirmed",
          })
          .eq("id", bookingRow.id)
          .neq("status", "completed")
          .neq("status", "cancelled");
      } else if (bookingRow && haveCleaners >= needCleaners) {
        await supabase
          .from("bookings")
          .update({ status: "assigned" })
          .eq("id", bookingRow.id)
          .neq("status", "completed")
          .neq("status", "cancelled");
      }
      if (bookingRow) {
        const { count } = await supabase
          .from("job_assignments")
          .select("id", { count: "exact", head: true })
          .eq("job_id", job.id)
          .or("status.ilike.confirmed,status.ilike.accepted");
        await supabase
          .from("bookings")
          .update({ num_cleaners_assigned: count ?? 1 })
          .eq("id", bookingRow.id);
      }
    }

    // Cleaner acceptance metrics.
    try {
      const { data: c } = await supabase
        .from("cleaners")
        .select("total_offers_received, total_offers_accepted")
        .eq("id", assignment.cleaner_id)
        .maybeSingle();
      if (c) {
        const received = Number(c.total_offers_received || 0);
        const accepted = Number(c.total_offers_accepted || 0) + 1;
        await supabase
          .from("cleaners")
          .update({
            total_offers_accepted: accepted,
            acceptance_rate: received > 0 ? accepted / received : 1,
          })
          .eq("id", assignment.cleaner_id);
      }
    } catch (err) {
      log("acceptance metric update failed", err instanceof Error ? err.message : String(err));
    }

    // Refresh GHL contractor / team size / duration fields via full booking sync.
    if (bookingRow?.id) {
      try {
        await supabase.functions.invoke("send-zapier-webhook", {
          body: { bookingId: bookingRow.id },
        });
        log("GHL booking sync triggered after accept", { bookingId: bookingRow.id });
      } catch (err) {
        log("GHL sync invoke failed (non-fatal)", err instanceof Error ? err.message : String(err));
      }
    }

    try {
      await supabase.from("events").insert({
        event_type: "job.assignment.accepted",
        cleaner_id: assignment.cleaner_id,
        job_id: job.id,
        booking_id: (bookingRow as any)?.id || null,
        source: "accept-job-offer",
        summary: "Cleaner accepted job offer",
        data: { assignment_id: assignment.id, role: assignment.role },
      });
    } catch { /* non-blocking */ }

    return new Response(JSON.stringify({ ok: true, status: "Confirmed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[accept-job-offer] error", msg);
    return new Response(JSON.stringify({ ok: false, reason: "server_error", message: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
