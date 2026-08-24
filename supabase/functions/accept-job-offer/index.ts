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
import { checklistUrlForToken, ensureJobChecklist } from "../_shared/job-checklist.ts";
import { checkScheduleBuffer } from "../_shared/schedule-buffer.ts";
import { accountCompliance, logComplianceBlock } from "../_shared/commercial-config.ts";

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
      .select("id, job_id, cleaner_id, role, status, expires_at, estimated_pay_cents, reliability_neutral")
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

      const { data: recleanBooking } = await supabase
        .from("bookings")
        .select("id, is_reclean")
        .eq("job_id", assignment.job_id)
        .maybeSingle();
      const reliabilityNeutral = assignment.reliability_neutral === true || recleanBooking?.is_reclean === true;

      if (reliabilityNeutral && recleanBooking?.id) {
        try {
          await supabase.functions.invoke("qc-reclean", {
            body: { action: "on_original_declined", bookingId: recleanBooking.id },
          });
        } catch (err) {
          log("reclean fallback after decline failed", err instanceof Error ? err.message : String(err));
        }
      } else {
        try {
          await runJobDispatchBackfill(
            supabase,
            assignment.job_id,
            "Cleaner declined the job offer",
          );
        } catch (err) {
          log("backfill after decline failed", err instanceof Error ? err.message : String(err));
        }
      }

      return new Response(JSON.stringify({ ok: true, status: "Declined", reliabilityPenalty: false }), {
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

    // Back-to-back is not the same as overlapping, and it is what cascades.
    // The DB write guard would refuse this commitment anyway; catching it here
    // means the cleaner gets a sentence they can act on instead of an error,
    // and the office finds out there's a job still to staff.
    const { data: acceptBooking } = await supabase
      .from("bookings")
      .select("id, business_account_id")
      .eq("job_id", assignment.job_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Commercial compliance: an offer sent while the account was covered can
    // be accepted days later, by which time the certificate may have lapsed.
    // Acceptance is the moment a cleaner is actually committed to the site, so
    // it is a dispatch point and gets the same gate.
    if (acceptBooking?.business_account_id) {
      const compliance = await accountCompliance(supabase, String(acceptBooking.business_account_id));
      if (!compliance.ok) {
        await logComplianceBlock(supabase, {
          compliance,
          action: "Offer acceptance",
          bookingId: acceptBooking.id,
          detail: { job_id: assignment.job_id, cleaner_id: assignment.cleaner_id },
        });
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "account_compliance_blocked",
            message:
              "This job is on hold — the client's certificate of insurance isn't current, " +
              "so we can't send anyone to the site. The office has been told; nothing for you to do.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }
    }

    if (acceptBooking?.id) {
      const bufferCheck = await checkScheduleBuffer(supabase, {
        bookingId: acceptBooking.id,
        cleanerIds: [assignment.cleaner_id],
      });
      if (!bufferCheck.ok) {
        await supabase.from("events").insert({
          event_type: "dispatch.approval_needed",
          booking_id: acceptBooking.id,
          job_id: assignment.job_id,
          cleaner_id: assignment.cleaner_id,
          source: "accept-job-offer",
          summary:
            `🚫 An offer acceptance was refused for lack of schedule buffer — this job still needs a crew.\n` +
            `${bufferCheck.message || ""}`,
          data: { reason: "buffer_conflict_on_accept", conflicts: bufferCheck.conflicts },
        }).then(() => undefined, () => undefined);

        return new Response(
          JSON.stringify({
            ok: false,
            reason: "buffer_conflict",
            message:
              "This starts too soon after your other job that day to be safe. " +
              "We've told the office — they'll sort the schedule and come back to you.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }
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

    // Bookkeeping on bookings table — ONE update so notify_ghl_sync fires
    // once (not once per field). The trigger handles GHL; do not also
    // invoke send-zapier-webhook here.
    let bookingRow: {
      id: string;
      ghl_contact_id?: string | null;
      num_cleaners_assigned?: number | null;
    } | null = null;
    if (job.customer_id) {
      const { data: b } = await supabase
        .from("bookings")
        .select("id, ghl_contact_id, num_cleaners_assigned, status")
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
      if (bookingRow) {
        const { count } = await supabase
          .from("job_assignments")
          .select("id", { count: "exact", head: true })
          .eq("job_id", job.id)
          .or("status.ilike.confirmed,status.ilike.accepted");
        const crewCount = count ?? 1;
        const bookingPatch: Record<string, unknown> = {
          num_cleaners_assigned: crewCount,
        };
        if (effectiveRole === "lead") {
          bookingPatch.cleaner_id = assignment.cleaner_id;
          bookingPatch.assigned_at = new Date().toISOString();
          bookingPatch.status = haveCleaners >= needCleaners ? "assigned" : "confirmed";
        } else if (haveCleaners >= needCleaners) {
          bookingPatch.status = "assigned";
        }
        const st = String((bookingRow as { status?: string }).status || "").toLowerCase();
        if (st !== "completed" && st !== "cancelled") {
          await supabase
            .from("bookings")
            .update(bookingPatch)
            .eq("id", bookingRow.id)
            .neq("status", "completed")
            .neq("status", "cancelled");
        } else {
          // Completed/cancelled: still stamp crew count without touching status.
          await supabase
            .from("bookings")
            .update({ num_cleaners_assigned: crewCount })
            .eq("id", bookingRow.id);
        }
      }
    }

    // Cleaner acceptance metrics — skip re-clean offers (reliability-neutral).
    try {
      const recleanOffer = assignment.reliability_neutral === true ||
        (await supabase.from("bookings").select("is_reclean").eq("job_id", assignment.job_id).maybeSingle()).data?.is_reclean === true;
      if (!recleanOffer) {
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
      } else if (bookingRow?.id) {
        await supabase.functions.invoke("qc-reclean", {
          body: { action: "on_offer_accepted", bookingId: bookingRow.id, cleanerId: assignment.cleaner_id },
        }).then(() => undefined, () => undefined);
      }
    } catch (err) {
      log("acceptance metric update failed", err instanceof Error ? err.message : String(err));
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

    // The cleaner's offer token doubles as their checklist access token —
    // make sure the job's shared checklist row exists and hand the link
    // back so the offer page can route them straight into it.
    let checklistUrl: string | null = null;
    try {
      await ensureJobChecklist(supabase, { jobId: job.id, bookingId: (bookingRow as any)?.id || null });
      checklistUrl = checklistUrlForToken(token);
    } catch { /* non-blocking */ }

    return new Response(JSON.stringify({ ok: true, status: "Confirmed", checklistUrl }), {
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
