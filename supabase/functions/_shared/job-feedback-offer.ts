// ─── Post-job feedback routing (tokenized) ─────────────────────────────
//
// Mint a job-specific feedback token + notify the customer. The token
// opens /feedback/<token> — 3 questions, first one gates:
//   overall >= threshold → rate + tip + Google review nudge
//   below threshold      → rate + private QC report into the existing hub
//
// Threshold, TTL, and the Google review URL are admin-tunable through
// app_secrets (FEEDBACK_POSITIVE_MIN_RATING / FEEDBACK_TOKEN_TTL_DAYS /
// FEEDBACK_GOOGLE_REVIEW_URL).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "./sms.ts";

const SITE_BASE = "https://try.novaracleaning.com";
export const DEFAULT_GOOGLE_REVIEW_URL = "https://g.page/r/Cc8fVvoYgXkaEAI/review";

export type JobFeedbackRow = {
  id: string;
  booking_id: string;
  token: string;
  status: string;
  overall_rating: number | null;
  cleaner_rating: number | null;
  quality_rating: number | null;
  path: string | null;
  qc_issue_id: string | null;
  expires_at: string;
  sent_at: string | null;
};

function randomToken(bytes = 20): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function secret(supabase: SupabaseClient, key: string, fallback: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    const v = String(data?.value || "").trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** Overall rating at/above this routes positive (default 4). */
export async function feedbackPositiveMinRating(supabase: SupabaseClient): Promise<number> {
  const raw = await secret(supabase, "FEEDBACK_POSITIVE_MIN_RATING", "4");
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 4;
}

export async function feedbackGoogleReviewUrl(supabase: SupabaseClient): Promise<string> {
  return secret(supabase, "FEEDBACK_GOOGLE_REVIEW_URL", DEFAULT_GOOGLE_REVIEW_URL);
}

export async function feedbackTtlDays(supabase: SupabaseClient): Promise<number> {
  const raw = await secret(supabase, "FEEDBACK_TOKEN_TTL_DAYS", "14");
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 14;
}

export function feedbackUrl(token: string): string {
  return `${SITE_BASE}/feedback/${token}`;
}

/** Ensure a feedback row exists for the booking; returns existing if present. */
export async function ensureJobFeedback(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<JobFeedbackRow> {
  const { data: existing } = await supabase
    .from("job_feedback")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (existing) return existing as JobFeedbackRow;

  const ttlDays = await feedbackTtlDays(supabase);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const token = randomToken(20);

  const { data: inserted, error } = await supabase
    .from("job_feedback")
    .insert({
      booking_id: bookingId,
      token,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) {
    // Race: another writer won the unique(booking_id) — re-read.
    const { data: again } = await supabase
      .from("job_feedback")
      .select("*")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (again) return again as JobFeedbackRow;
    throw error;
  }
  return inserted as JobFeedbackRow;
}

export function buildFeedbackSms(firstName: string | null, url: string): string {
  const name = firstName?.trim() || "there";
  return (
    `Hi ${name}! Your Novara clean is done — how did we do? ` +
    `3 quick questions (under a minute): ${url} ` +
    `Reply STOP to opt out.`
  );
}

export function buildFeedbackEmailHtml(opts: {
  firstName: string | null;
  feedbackUrl: string;
  bookingNumber?: number | null;
}): string {
  const name = opts.firstName?.trim() || "there";
  const ref = opts.bookingNumber
    ? `NVC-${String(opts.bookingNumber).padStart(4, "0")}`
    : "your cleaning";
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <p>Hi ${name},</p>
      <p>Thanks again for choosing Novara Cleaning for <strong>${ref}</strong>.</p>
      <p>We'd love 60 seconds of feedback — three quick questions about your experience.
         Your answers help us keep quality high and take care of anything that missed the mark.</p>
      <p style="margin:28px 0;">
        <a href="${opts.feedbackUrl}"
           style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;">
          Share your feedback
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280;">This link is personal to your job and expires after a short window.</p>
    </div>
  `;
}

/** Mint token + SMS (and optional lightweight HTML email). Non-throwing for callers. */
export async function sendJobFeedbackOffer(
  supabase: SupabaseClient,
  booking: {
    id: string;
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    booking_number?: number | null;
  },
): Promise<{ feedbackUrl: string; token: string }> {
  const row = await ensureJobFeedback(supabase, booking.id);
  const url = feedbackUrl(row.token);

  if (booking.phone) {
    try {
      await sendSms(supabase, {
        toPhone: booking.phone,
        message: buildFeedbackSms(booking.first_name || null, url),
        type: "confirmation",
      });
    } catch (e) {
      console.warn("[job-feedback-offer] SMS failed", e);
    }
  }

  if (booking.email) {
    try {
      const { resolveSecret } = await import("./app-secrets.ts");
      const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");
      if (resendKey) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Novara Cleaning <hello@novaracleaning.com>",
            to: [booking.email],
            subject: "How was your Novara clean? (3 quick questions)",
            html: buildFeedbackEmailHtml({
              firstName: booking.first_name || null,
              feedbackUrl: url,
              bookingNumber: booking.booking_number ?? null,
            }),
          }),
        });
      }
    } catch (e) {
      console.warn("[job-feedback-offer] email failed", e);
    }
  }

  await supabase
    .from("job_feedback")
    .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("sent_at", null);

  return { feedbackUrl: url, token: row.token };
}
