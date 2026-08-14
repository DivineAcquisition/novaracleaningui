import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  console.log(`[JOB-CHECK-IN] ${step}`, details ? JSON.stringify(details) : '');
};

// After the first successful check-in, text the cleaner their BEFORE-photos
// upload link (operator directive 2026-07-06: the SMS cadence is check in /
// start job first, THEN the photos link lands right after). Idempotent per
// booking via bookings.before_photo_link_sent_at.
// deno-lint-ignore no-explicit-any
async function sendBeforePhotosLink(supabase: any, jobId: string, cleanerId: string): Promise<void> {
  try {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, first_name, photo_upload_token, before_photo_link_sent_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!booking || booking.before_photo_link_sent_at) return;
    await deliverBeforePhotosSms(supabase, booking, cleanerId);
  } catch (err) {
    logStep("Warning: before-photos SMS failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Same cadence for bookings that have no jobs row (booking-only check-in).
// deno-lint-ignore no-explicit-any
async function sendBeforePhotosLinkForBooking(supabase: any, bookingId: string, cleanerId: string): Promise<void> {
  try {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, first_name, photo_upload_token, before_photo_link_sent_at")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking || booking.before_photo_link_sent_at) return;
    await deliverBeforePhotosSms(supabase, booking, cleanerId);
  } catch (err) {
    logStep("Warning: before-photos SMS failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// deno-lint-ignore no-explicit-any
async function deliverBeforePhotosSms(supabase: any, booking: any, cleanerId: string): Promise<void> {
  {

    let token = booking.photo_upload_token as string | null;
    if (!token) {
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      await supabase.from("bookings").update({ photo_upload_token: token }).eq("id", booking.id);
    }

    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("first_name, phone, sms_notifications_enabled")
      .eq("id", cleanerId)
      .maybeSingle();
    if (!cleaner?.phone || cleaner.sms_notifications_enabled === false) return;

    const link = `https://contractor.novaracleaning.com/cleaner/job-photos/${token}?phase=before`;
    const msg =
      `Novara: you're checked in${booking.first_name ? ` at ${booking.first_name}'s` : ""} — nice. ` +
      `First step before you start: upload your BEFORE photos & videos here:\n${link}`;
    const ok = await sendSms(supabase, { toPhone: cleaner.phone, message: msg, type: "reminder" });
    if (ok) {
      await supabase
        .from("bookings")
        .update({ before_photo_link_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
        .is("before_photo_link_sent_at", null);
      logStep("BEFORE-photos link sent after check-in", { bookingId: booking.id });
    }
  }
}

// On-time window: ±15 minutes
const ON_TIME_WINDOW_MINUTES = 15;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobAssignmentId, bookingId, action, cleanerId, lat, lng } = await req.json();
    logStep("Processing check-in/out", { jobAssignmentId, bookingId, action, cleanerId });

    if ((!jobAssignmentId && !bookingId) || !action || !cleanerId) {
      throw new Error("Missing required fields: jobAssignmentId (or bookingId), action, cleanerId");
    }

    if (!["check_in", "check_out"].includes(action)) {
      throw new Error("Invalid action. Must be 'check_in' or 'check_out'");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ── Booking-only fallback ────────────────────────────────────────────
    // Some manually-created bookings have no job_assignments row. The
    // contractor portal used to work around this with a raw bookings
    // update, which silently skipped the BEFORE-photos SMS. Handle it
    // here instead so every check-in follows the same cadence.
    if (!jobAssignmentId && bookingId && action === "check_in") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, cleaner_id, status, check_in_time, job_id")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) throw new Error("Booking not found");
      if (booking.cleaner_id !== cleanerId) throw new Error("Booking not assigned to this cleaner");
      if (booking.check_in_time) {
        return new Response(
          JSON.stringify({ success: true, message: "Job already checked in", alreadyCheckedIn: true, checkInTime: booking.check_in_time }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const nowIso = new Date().toISOString();
      const { error: bookErr } = await supabase
        .from("bookings")
        .update({ status: "in_progress", check_in_time: nowIso })
        .eq("id", bookingId);
      if (bookErr) throw new Error(`Failed to update booking: ${bookErr.message}`);
      await sendBeforePhotosLinkForBooking(supabase, bookingId, cleanerId);
      return new Response(
        JSON.stringify({ success: true, message: "Checked in successfully", checkInTime: nowIso, viaBooking: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!jobAssignmentId) throw new Error("jobAssignmentId required for this action");

    // Fetch job assignment with job details
    const { data: assignment, error: assignmentError } = await supabase
      .from("job_assignments")
      .select("*, jobs(*)")
      .eq("id", jobAssignmentId)
      .eq("cleaner_id", cleanerId)
      .single();

    if (assignmentError || !assignment) {
      throw new Error("Job assignment not found or unauthorized");
    }

    const now = new Date();
    const job = assignment.jobs;

    if (action === "check_in") {
      logStep("Processing check-in", { jobId: job.id });

      // Verify job hasn't already been checked in
      if (job.check_in_time) {
        logStep("Job already checked in", { checkInTime: job.check_in_time });
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Job already checked in",
            alreadyCheckedIn: true,
            checkInTime: job.check_in_time
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate if on-time (within ±15 minutes of scheduled start)
      const scheduledStart = new Date(job.start_datetime);
      const diffMinutes = (now.getTime() - scheduledStart.getTime()) / (1000 * 60);
      const isOnTime = Math.abs(diffMinutes) <= ON_TIME_WINDOW_MINUTES;

      logStep("Checking on-time status", { 
        scheduledStart: job.start_datetime,
        actualArrival: now.toISOString(),
        diffMinutes,
        isOnTime 
      });

      // Update job with check-in time (first cleaner to arrive)
      const { error: jobUpdateError } = await supabase
        .from("jobs")
        .update({ 
          check_in_time: now.toISOString(),
          status: "In Progress"
        })
        .eq("id", job.id);

      if (jobUpdateError) {
        throw new Error(`Failed to update job: ${jobUpdateError.message}`);
      }

      // Update assignment status
      const { error: assignmentUpdateError } = await supabase
        .from("job_assignments")
        .update({ 
          status: "In Progress",
          responded_at: now.toISOString()
        })
        .eq("id", jobAssignmentId);

      if (assignmentUpdateError) {
        throw new Error(`Failed to update assignment: ${assignmentUpdateError.message}`);
      }

      // Update cleaner's on-time tracking
      if (isOnTime) {
        logStep("Updating cleaner on-time stats", { cleanerId });
        
        const { data: cleaner, error: cleanerFetchError } = await supabase
          .from("cleaners")
          .select("total_on_time_arrivals, completed_bookings")
          .eq("id", cleanerId)
          .single();

        if (cleanerFetchError) {
          logStep("Warning: Could not fetch cleaner stats", { error: cleanerFetchError });
        } else {
          const newOnTimeArrivals = (cleaner.total_on_time_arrivals || 0) + 1;
          const completedBookings = cleaner.completed_bookings || 1;
          // Stored as a 0-1 fraction (see update-cleaner-performance).
          const newOnTimeRate = newOnTimeArrivals / completedBookings;

          const { error: cleanerUpdateError } = await supabase
            .from("cleaners")
            .update({
              total_on_time_arrivals: newOnTimeArrivals,
              on_time_rate: Math.round(newOnTimeRate * 1000) / 1000
            })
            .eq("id", cleanerId);

          if (cleanerUpdateError) {
            logStep("Warning: Could not update cleaner stats", { error: cleanerUpdateError });
          } else {
            logStep("Updated cleaner on-time rate", { 
              cleanerId,
              onTimeRate: newOnTimeRate,
              totalOnTime: newOnTimeArrivals 
            });
          }
        }
      }

      // Text the BEFORE-photos link right after check-in (idempotent —
      // skipped if the day-of reminder already delivered it).
      await sendBeforePhotosLink(supabase, job.id, cleanerId);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Checked in successfully",
          checkInTime: now.toISOString(),
          isOnTime,
          scheduledStart: job.start_datetime
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "check_out") {
      logStep("Processing check-out", { jobId: job.id });

      if (!job.check_in_time) {
        throw new Error("Cannot check out before checking in");
      }

      if (job.check_out_time) {
        logStep("Job already checked out", { checkOutTime: job.check_out_time });
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Job already checked out",
            alreadyCheckedOut: true,
            checkOutTime: job.check_out_time
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate actual duration
      const checkInTime = new Date(job.check_in_time);
      const durationMs = now.getTime() - checkInTime.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);

      logStep("Calculating duration", {
        checkInTime: job.check_in_time,
        checkOutTime: now.toISOString(),
        durationHours
      });

      // Update job with check-out time and duration
      const { error: jobUpdateError } = await supabase
        .from("jobs")
        .update({ 
          check_out_time: now.toISOString(),
          actual_duration_hours: Math.round(durationHours * 100) / 100,
          status: "Completed"
        })
        .eq("id", job.id);

      if (jobUpdateError) {
        throw new Error(`Failed to update job: ${jobUpdateError.message}`);
      }

      // Update assignment status to completed
      const { error: assignmentUpdateError } = await supabase
        .from("job_assignments")
        .update({ status: "Completed" })
        .eq("id", jobAssignmentId);

      if (assignmentUpdateError) {
        throw new Error(`Failed to update assignment: ${assignmentUpdateError.message}`);
      }

      // Trigger completion workflow (could call complete-booking here)
      logStep("Check-out complete, triggering completion workflow");

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Checked out successfully",
          checkOutTime: now.toISOString(),
          actualDurationHours: Math.round(durationHours * 100) / 100
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Should never reach here due to validation above
    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("Error", { error: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
