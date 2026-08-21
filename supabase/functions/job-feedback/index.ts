// job-feedback
//
// Tokenized post-job feedback routing (public, no login). The token in the
// customer's SMS/email is the only credential — it resolves the job, its
// crew, and the customer automatically.
//
//   { action:'get', token }
//   { action:'submit_answers', token, overallRating, cleanerRating, qualityRating }
//       Saves all 3 answers FIRST, attributes the cleaner rating to the
//       job's crew (both paths), then returns the route (positive | qc).
//   { action:'submit_qc', token, issueType, description, severity? }
//       QC path only — creates a qc_issues row (reported_via='customer')
//       linked to the booking + its documentation, through the existing
//       workflow/severity/notification rules.
//   { action:'tip_checkout', token, amountCents, directedCleanerId? }
//       Positive path — Stripe tip checkout via the existing tip-cleaner
//       flow (100% pass-through, equal crew split, walled off from scores).
//   { action:'skip_tip', token }
//       Positive path — customer declined the tip; hands back the Google URL.
//   { action:'mark_google', token }
//       Records the Google click-through and completes the positive path.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  feedbackGoogleReviewUrl,
  feedbackPositiveMinRating,
  feedbackUrl,
} from "../_shared/job-feedback-offer.ts";
import {
  loadRecleanSettings,
  namedAreasFromText,
  recleanRequestColumns,
  recleanSourceForIntake,
} from "../_shared/reclean.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const log = (s: string, d?: unknown) =>
  console.log(`[job-feedback] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const ISSUE_TYPES = ["complaint", "reclean", "damage", "no_show", "late", "quality_flag", "payment", "other"];
const SEVERITIES = ["low", "medium", "high", "critical"];

async function loadFeedback(admin: SB, token: string) {
  const { data } = await admin
    .from("job_feedback")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return data;
}

async function loadBooking(admin: SB, bookingId: string) {
  const { data } = await admin
    .from("bookings")
    .select(
      "id, job_id, booking_number, first_name, last_name, email, phone, status, cleaner_id, service_date, service_type, city, state, booking_type, partner_details, rating_submitted, completed_at, is_reclean",
    )
    .eq("id", bookingId)
    .maybeSingle();
  return data;
}

/** The job's actual crew: confirmed/accepted/completed assignments, else the booking's cleaner. */
async function crewForBooking(
  admin: SB,
  booking: { job_id: string | null; cleaner_id: string | null },
): Promise<Array<{ id: string; first_name: string | null; last_name: string | null }>> {
  const ids = new Set<string>();
  if (booking.job_id) {
    const { data: assigns } = await admin
      .from("job_assignments")
      .select("cleaner_id, status")
      .eq("job_id", booking.job_id);
    for (const a of assigns || []) {
      const s = String(a.status || "").toLowerCase();
      if (a.cleaner_id && ["confirmed", "accepted", "completed", "in progress"].includes(s)) {
        ids.add(a.cleaner_id);
      }
    }
  }
  if (ids.size === 0 && booking.cleaner_id) ids.add(booking.cleaner_id);
  if (ids.size === 0) return [];
  const { data: cleaners } = await admin
    .from("cleaners")
    .select("id, first_name, last_name")
    .in("id", [...ids]);
  return cleaners || [];
}

/**
 * Q2 feeds the existing rating / Novara Score pipeline on BOTH paths —
 * one cleaner_ratings row per (booking, cleaner), then the same
 * average_rating/total_ratings recompute submit-rating uses.
 */
async function applyCleanerRating(
  admin: SB,
  booking: { id: string; email: string | null },
  crew: Array<{ id: string }>,
  rating: number,
) {
  if (crew.length === 0) return;
  const email = String(booking.email || "").trim().toLowerCase() || "feedback@novaracleaning.com";

  for (const c of crew) {
    const { data: existing } = await admin
      .from("cleaner_ratings")
      .select("id")
      .eq("booking_id", booking.id)
      .eq("cleaner_id", c.id)
      .maybeSingle();
    if (existing) continue;

    const { error } = await admin.from("cleaner_ratings").insert({
      booking_id: booking.id,
      cleaner_id: c.id,
      customer_email: email,
      rating,
      review: null,
    });
    if (error) {
      log("cleaner_ratings insert failed", { cleanerId: c.id, error: error.message });
      continue;
    }

    const { data: ratings } = await admin
      .from("cleaner_ratings")
      .select("rating")
      .eq("cleaner_id", c.id);
    if (ratings && ratings.length > 0) {
      const avg = ratings.reduce((sum: number, r: { rating: number }) => sum + Number(r.rating), 0) / ratings.length;
      await admin
        .from("cleaners")
        .update({ average_rating: avg.toFixed(2), total_ratings: ratings.length })
        .eq("id", c.id);
    }
  }

  await admin.from("bookings").update({ rating_submitted: true }).eq("id", booking.id);
}

function severityFromOverall(overall: number): string {
  if (overall <= 1) return "critical";
  if (overall === 2) return "high";
  return "medium";
}

/** Same client-type tagging the QC hub uses. */
function clientTypeOf(b: {
  booking_type?: string | null;
  partner_details?: Record<string, unknown> | null;
}): string {
  const t = String(b.booking_type || "");
  if (t === "commercial") return "commercial";
  if (t === "office") return "office";
  if (t === "str_turnover") return "str";
  if (t === "partnership") {
    return String((b.partner_details as Record<string, unknown> | null)?.booking_type || "") === "str_turnover"
      ? "str"
      : "commercial";
  }
  return "residential";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "get").toLowerCase();
    const token = String(body?.token || "").trim();
    if (!token) return json({ ok: false, error: "Missing token" }, 400);

    const feedback = await loadFeedback(admin, token);
    if (!feedback) return json({ ok: false, error: "not_found" }, 404);

    const expired = new Date(feedback.expires_at).getTime() < Date.now();
    if (expired && feedback.status === "pending") {
      await admin
        .from("job_feedback")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", feedback.id);
    }
    if (feedback.status === "expired" || expired) {
      return json({ ok: false, error: "expired" }, 410);
    }

    const booking = await loadBooking(admin, feedback.booking_id);
    if (!booking) return json({ ok: false, error: "not_found" }, 404);

    const crew = await crewForBooking(admin, booking);
    const crewPublic = crew.map((c) => ({
      id: c.id,
      name: `${c.first_name || ""} ${(c.last_name || "").slice(0, 1)}`.trim() || "Cleaner",
    }));
    const googleUrl = await feedbackGoogleReviewUrl(admin);
    const positiveMin = await feedbackPositiveMinRating(admin);

    if (action === "get") {
      // First page load = the customer clicked the link. Stamp it once so
      // the follow-up sweep knows the link was opened and stops nudging.
      if (!feedback.opened_at) {
        await admin
          .from("job_feedback")
          .update({ opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", feedback.id)
          .is("opened_at", null);
      }
      return json({
        ok: true,
        feedback: {
          status: feedback.status,
          path: feedback.path,
          overallRating: feedback.overall_rating,
          cleanerRating: feedback.cleaner_rating,
          qualityRating: feedback.quality_rating,
          expiresAt: feedback.expires_at,
          hasQcIssue: Boolean(feedback.qc_issue_id),
        },
        booking: {
          id: booking.id,
          bookingNumber: booking.booking_number,
          firstName: booking.first_name,
          serviceDate: booking.service_date,
          serviceType: booking.service_type,
          city: booking.city,
          state: booking.state,
        },
        crew: crewPublic,
        positiveMinRating: positiveMin,
        googleReviewUrl: googleUrl,
      });
    }

    if (action === "submit_answers") {
      if (feedback.status !== "pending") {
        // Answers are single-shot — a revisit resumes the saved path.
        return json({
          ok: true,
          alreadySaved: true,
          path: feedback.path,
          googleReviewUrl: googleUrl,
          crew: crewPublic,
        });
      }

      const overallRating = Math.round(Number(body?.overallRating));
      const cleanerRating = Math.round(Number(body?.cleanerRating));
      const qualityRating = Math.round(Number(body?.qualityRating));
      for (const [label, v] of [
        ["overallRating", overallRating],
        ["cleanerRating", cleanerRating],
        ["qualityRating", qualityRating],
      ] as const) {
        if (!Number.isFinite(v) || v < 1 || v > 5) {
          return json({ ok: false, error: `${label} must be 1–5` }, 400);
        }
      }

      const path = overallRating >= positiveMin ? "positive" : "qc";

      // Save all three answers BEFORE routing so the data is captured even
      // if the customer abandons the review / QC step.
      const { error: saveErr } = await admin
        .from("job_feedback")
        .update({
          overall_rating: overallRating,
          cleaner_rating: cleanerRating,
          quality_rating: qualityRating,
          path,
          status: "answers_saved",
          answers_saved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", feedback.id)
        .eq("status", "pending");
      if (saveErr) throw saveErr;

      // Cleaner rating feeds scoring on BOTH paths.
      await applyCleanerRating(admin, booking, crew, cleanerRating);

      log("answers saved", { bookingId: booking.id, path, overallRating, cleanerRating, qualityRating });

      return json({
        ok: true,
        path,
        googleReviewUrl: googleUrl,
        crew: crewPublic,
      });
    }

    if (action === "submit_qc") {
      if (feedback.path !== "qc") {
        return json({ ok: false, error: "QC path only" }, 400);
      }
      if (feedback.qc_issue_id) {
        return json({ ok: true, alreadySubmitted: true, issueId: feedback.qc_issue_id });
      }
      if (!["answers_saved", "qc_complete"].includes(feedback.status)) {
        return json({ ok: false, error: "Submit ratings first" }, 400);
      }

      const description = String(body?.description || "").trim().slice(0, 4000);
      if (description.length < 8) {
        return json({ ok: false, error: "Please describe what went wrong (a short note is fine)." }, 400);
      }
      const issueType = ISSUE_TYPES.includes(String(body?.issueType))
        ? String(body.issueType)
        : "complaint";
      const severity = SEVERITIES.includes(String(body?.severity))
        ? String(body.severity)
        : severityFromOverall(Number(feedback.overall_rating) || 3);

      const ref = booking.booking_number
        ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
        : `Job ${booking.id.slice(0, 8)}`;
      const clientName = `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "Customer";
      const primary = crew[0] || null;

      // Link the issue to the job's documentation packet so the QC console
      // opens with the before/after evidence attached.
      const { data: docRow } = await admin
        .from("job_documentation")
        .select("id")
        .eq("booking_id", booking.id)
        .maybeSingle();

      const title = `Customer feedback: ${issueType.replace(/_/g, " ")} on ${ref}`;
      const fullDescription =
        `${description}\n\n` +
        `— Feedback scores —\n` +
        `Overall: ${feedback.overall_rating}/5 · Cleaner: ${feedback.cleaner_rating}/5 · Quality: ${feedback.quality_rating}/5`;

      const recleanStamp: Record<string, unknown> = {};
      if (!booking.is_reclean) {
        const settings = await loadRecleanSettings(admin);
        Object.assign(recleanStamp, recleanRequestColumns({
          completedAt: booking.completed_at,
          serviceDate: booking.service_date,
          windowHours: settings.guarantee_window_hours,
        }), {
          reclean_source: recleanSourceForIntake({ issueType, reportedVia: "customer" }),
          reclean_scope: "targeted",
          reclean_areas_named: namedAreasFromText(description),
        });
      }

      const { data: issue, error: issueErr } = await admin
        .from("qc_issues")
        .insert({
          booking_id: booking.id,
          job_id: booking.job_id,
          client_type: clientTypeOf(booking),
          documentation_id: docRow?.id || null,
          cleaner_id: primary?.id || booking.cleaner_id || null,
          cleaner_name: primary
            ? `${primary.first_name || ""} ${primary.last_name || ""}`.trim() || null
            : null,
          client_name: clientName,
          client_email: booking.email,
          booking_ref: ref,
          issue_type: issueType,
          severity,
          status: "open",
          title,
          description: fullDescription,
          reported_via: "customer",
          reported_by: null,
          reported_by_name: clientName,
          ...recleanStamp,
        })
        .select("id")
        .single();
      if (issueErr) throw issueErr;

      await admin.from("qc_issue_events").insert({
        issue_id: issue.id,
        action: "created",
        to_status: "open",
        note: fullDescription.slice(0, 1000),
        actor_id: null,
        actor_name: clientName,
        data: {
          issue_type: issueType,
          severity,
          via: "customer",
          feedback_id: feedback.id,
          overall_rating: feedback.overall_rating,
          cleaner_rating: feedback.cleaner_rating,
          quality_rating: feedback.quality_rating,
        },
      });

      if (recleanStamp.reclean_status) {
        await admin.from("qc_issue_events").insert({
          issue_id: issue.id,
          action: "reclean_requested",
          note: recleanStamp.reclean_inside_window
            ? "Re-clean request from 1–3★ feedback, inside the Spotless Guarantee window. Verify original photos before dispatch."
            : "Re-clean request from 1–3★ feedback, outside the guarantee window — honor at admin discretion.",
          actor_name: clientName,
          data: {
            source: recleanStamp.reclean_source,
            inside_window: recleanStamp.reclean_inside_window,
            via: "review_gating",
          },
        });
      }

      // Same severity rules as qc-issues: High/Critical alert admin
      // immediately through the existing Discord event routing.
      if (severity === "high" || severity === "critical") {
        await admin.from("events").insert({
          event_type: "qc.issue.created",
          booking_id: booking.id,
          job_id: booking.job_id,
          cleaner_id: primary?.id || booking.cleaner_id || null,
          source: "job-feedback",
          summary:
            `🔴 ${severity.toUpperCase()} customer QC on ${ref} — ${issueType}: ${title}` +
            `\n${description.slice(0, 300)}\nReported by ${clientName} via feedback link.`,
          data: { issue_id: issue.id, severity, issue_type: issueType, via: "customer" },
        }).then(() => undefined, () => undefined);
      }

      await admin
        .from("job_feedback")
        .update({
          qc_issue_id: issue.id,
          status: "qc_complete",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", feedback.id);

      log("QC issue created from feedback", { issueId: issue.id, bookingId: booking.id });
      return json({ ok: true, issueId: issue.id });
    }

    if (action === "tip_checkout") {
      if (feedback.path !== "positive") {
        return json({ ok: false, error: "Tips are offered on the positive path only" }, 400);
      }
      if (!["answers_saved", "positive_complete"].includes(feedback.status)) {
        return json({ ok: false, error: "Submit ratings first" }, 400);
      }

      const amountCents = Math.round(Number(body?.amountCents) || 0);
      const directedCleanerId = body?.directedCleanerId ? String(body.directedCleanerId) : "";
      if (amountCents < 100 || amountCents > 50000) {
        return json({ ok: false, error: "Tip must be between $1 and $500." }, 400);
      }

      // Reuse tip-cleaner checkout (100% pass-through, equal crew split).
      // Return the customer to this feedback page so they still get the
      // Google nudge after paying.
      const feedbackReturn = feedbackUrl(token);
      const tipRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/tip-cleaner`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
          },
          body: JSON.stringify({
            action: "checkout",
            bookingId: booking.id,
            amountCents,
            ...(directedCleanerId ? { directedCleanerId } : {}),
            successUrl: `${feedbackReturn}?tipped=1&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: feedbackReturn,
          }),
        },
      );
      const tipData = await tipRes.json().catch(() => ({}));
      if (!tipRes.ok || !tipData?.ok || !tipData?.url) {
        return json({ ok: false, error: tipData?.error || "Could not start tip checkout" }, 502);
      }

      await admin
        .from("job_feedback")
        .update({
          tip_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", feedback.id);

      return json({ ok: true, url: tipData.url });
    }

    if (action === "mark_google") {
      if (feedback.path !== "positive") {
        return json({ ok: false, error: "Google path only" }, 400);
      }
      await admin
        .from("job_feedback")
        .update({
          google_clicked_at: new Date().toISOString(),
          status: "positive_complete",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", feedback.id);
      return json({ ok: true, googleReviewUrl: googleUrl });
    }

    if (action === "skip_tip") {
      // Customer declined the tip — still allow the Google step.
      if (feedback.path !== "positive") return json({ ok: false, error: "positive path only" }, 400);
      return json({ ok: true, googleReviewUrl: googleUrl });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
