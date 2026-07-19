import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";
import {
  buildFeedbackReminderSms,
  ensureJobFeedback,
  feedbackMaxReminders,
  feedbackReminderDelayHours,
  feedbackUrl,
} from "../_shared/job-feedback-offer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours after completion
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // skip bookings completed >7 days ago

const logStep = (step: string, details?: Record<string, unknown>) => {
  const suffix = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-RATING-REMINDERS] ${step}${suffix}`);
};

// deno-lint-ignore no-explicit-any
type SB = any;

/**
 * Phase A — first feedback link.
 *
 * Completed bookings with a cleaner + phone that were never sent a rating
 * reminder get the tokenized feedback link ~2h after completion. Keyed on
 * bookings.rating_reminder_sent_at so this fires exactly once per booking.
 * We also stamp job_feedback.sent_at so Phase B can measure "sent X hours
 * ago" for the follow-up nudge.
 */
async function firstSendSweep(supabase: SB, now: number) {
  const eligibleBefore = new Date(now - REMINDER_DELAY_MS).toISOString();
  const eligibleAfter = new Date(now - MAX_AGE_MS).toISOString();

  logStep("Phase A — first-send sweep", { eligibleBefore, eligibleAfter });

  const { data: bookings, error: fetchError } = await supabase
    .from("bookings")
    .select(
      "id, phone, first_name, completed_at, rating_submitted, rating_reminder_sent_at, cleaner_id, cleaners(first_name)",
    )
    .eq("status", "completed")
    .is("rating_reminder_sent_at", null)
    .eq("rating_submitted", false)
    .not("phone", "is", null)
    .not("cleaner_id", "is", null)
    .lte("completed_at", eligibleBefore)
    .gte("completed_at", eligibleAfter)
    .limit(50);

  if (fetchError) throw fetchError;

  const results = { attempted: 0, sent: 0, skipped: 0, failed: 0 };

  for (const booking of bookings || []) {
    results.attempted++;

    if (booking.rating_submitted || booking.rating_reminder_sent_at) {
      results.skipped++;
      continue;
    }

    // Skip (and stamp) if they already went through the tokenized flow.
    const { data: fbExisting } = await supabase
      .from("job_feedback")
      .select("status")
      .eq("booking_id", booking.id)
      .maybeSingle();
    if (fbExisting && ["answers_saved", "positive_complete", "qc_complete"].includes(fbExisting.status)) {
      results.skipped++;
      await supabase
        .from("bookings")
        .update({ rating_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id);
      continue;
    }

    // Mint (or reuse) the job-specific feedback token — the SMS link
    // resolves the job, crew, and customer with no manual entry.
    let token: string;
    let feedbackId: string;
    try {
      const fb = await ensureJobFeedback(supabase, booking.id);
      token = fb.token;
      feedbackId = fb.id;
    } catch (e) {
      logStep("feedback token mint failed", {
        bookingId: booking.id,
        error: e instanceof Error ? e.message : String(e),
      });
      results.failed++;
      continue;
    }

    const url = feedbackUrl(token);
    const cleanerName =
      (booking as { cleaners?: { first_name?: string | null } | null })
        .cleaners?.first_name?.trim() || "your cleaner";
    const greeting = booking.first_name?.trim() ? `Hi ${booking.first_name.trim()},` : "Hi,";

    const message =
      `${greeting} thanks again for choosing Novara Cleaning! ` +
      `How did ${cleanerName} do? 3 quick questions (under a minute): ${url}\n\n` +
      `Reply STOP to opt out.`;

    const sent = await sendSms(supabase, {
      toPhone: booking.phone,
      message,
      type: "confirmation",
    });

    if (!sent) {
      results.failed++;
      logStep("SMS failed", { bookingId: booking.id });
      continue;
    }

    // Stamp both the one-shot booking marker AND the job_feedback baseline
    // the follow-up sweep measures against.
    await supabase
      .from("bookings")
      .update({ rating_reminder_sent_at: new Date().toISOString() })
      .eq("id", booking.id)
      .is("rating_reminder_sent_at", null);
    await supabase
      .from("job_feedback")
      .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", feedbackId)
      .is("sent_at", null);

    results.sent++;
    logStep("First feedback link sent", { bookingId: booking.id });
  }

  return results;
}

/**
 * Phase B — follow-up nudge for links that were never opened.
 *
 * Pulls job_feedback rows that are still pending, whose link has NOT been
 * opened (opened_at IS NULL), whose previous send is older than the
 * configured delay, and that haven't hit the reminder cap. Re-sends the
 * SAME link with softer copy and bumps reminder_count. Once the customer
 * opens the link (opened_at set) or answers (status advances), they drop
 * out of this sweep automatically.
 */
async function followUpSweep(supabase: SB, now: number) {
  const delayHours = await feedbackReminderDelayHours(supabase);
  const maxReminders = await feedbackMaxReminders(supabase);
  const results = { attempted: 0, sent: 0, skipped: 0, failed: 0, maxReminders, delayHours };

  if (maxReminders <= 0) {
    logStep("Phase B — follow-up disabled (FEEDBACK_MAX_REMINDERS=0)");
    return results;
  }

  const delayMs = delayHours * 60 * 60 * 1000;
  const dueBefore = new Date(now - delayMs).toISOString();
  const nowIso = new Date().toISOString();

  logStep("Phase B — follow-up sweep", { dueBefore, maxReminders });

  const { data: rows, error } = await supabase
    .from("job_feedback")
    .select(
      "id, token, reminder_count, sent_at, booking_id, " +
        "bookings(phone, first_name, status, rating_submitted)",
    )
    .eq("status", "pending")
    .is("opened_at", null)
    .not("sent_at", "is", null)
    .lte("sent_at", dueBefore)
    .lt("reminder_count", maxReminders)
    .gt("expires_at", nowIso)
    .or(`last_reminder_at.is.null,last_reminder_at.lte.${dueBefore}`)
    .limit(50);

  if (error) throw error;

  for (const row of rows || []) {
    results.attempted++;

    const booking = (row as { bookings?: Record<string, unknown> | null }).bookings || null;
    // Only nudge live, still-unrated jobs with a phone on file.
    if (
      !booking ||
      booking.status !== "completed" ||
      booking.rating_submitted === true ||
      !booking.phone
    ) {
      results.skipped++;
      continue;
    }

    const url = feedbackUrl(row.token);
    const message = buildFeedbackReminderSms(
      (booking.first_name as string | null) || null,
      url,
    );

    const sent = await sendSms(supabase, {
      toPhone: booking.phone as string,
      message,
      type: "confirmation",
    });

    if (!sent) {
      results.failed++;
      logStep("Follow-up SMS failed", { feedbackId: row.id });
      continue;
    }

    // Optimistic guard on reminder_count so overlapping sweeps can't
    // double-bump the same row.
    const { data: bumped } = await supabase
      .from("job_feedback")
      .update({
        reminder_count: (Number(row.reminder_count) || 0) + 1,
        last_reminder_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("reminder_count", row.reminder_count)
      .select("id");

    if (Array.isArray(bumped) && bumped.length > 0) {
      results.sent++;
      logStep("Follow-up feedback link sent", {
        feedbackId: row.id,
        reminderNumber: (Number(row.reminder_count) || 0) + 1,
      });
    } else {
      results.skipped++;
    }
  }

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase: SB = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = Date.now();

    const firstSend = await firstSendSweep(supabase, now);

    // Follow-up is isolated so a failure here never blocks first sends.
    let followUp: Record<string, number> = { attempted: 0, sent: 0, skipped: 0, failed: 0 };
    try {
      followUp = await followUpSweep(supabase, now);
    } catch (e) {
      logStep("Follow-up sweep error (non-blocking)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        results: firstSend,
        followUp,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
