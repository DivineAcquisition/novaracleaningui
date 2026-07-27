// ─── Post-job feedback routing (tokenized) ─────────────────────────────
//
// Mint a job-specific feedback token + notify the customer. The token
// opens /feedback/<token> — 3 questions, first one gates:
//   overall >= threshold → rate + tip + Google review nudge
//   below threshold      → rate + private QC report into the existing hub
//
// SMS + email are personalized: customer first name, a short description of
// the booking (service · date · city), and the cleaner(s) assigned.
//
// Threshold, TTL, and the Google review URL are admin-tunable through
// app_secrets (FEEDBACK_POSITIVE_MIN_RATING / FEEDBACK_TOKEN_TTL_DAYS /
// FEEDBACK_GOOGLE_REVIEW_URL / FEEDBACK_REMINDER_DELAY_HOURS /
// FEEDBACK_MAX_REMINDERS).

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

/** Everything the personalized SMS/email need — resolved from the booking. */
export type FeedbackContext = {
  bookingId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  bookingNumber: number | null;
  serviceType: string | null;
  serviceDate: string | null;
  city: string | null;
  state: string | null;
  crewNames: string[];
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

/** Hours to wait after the previous send before a follow-up nudge (default 24). */
export async function feedbackReminderDelayHours(supabase: SupabaseClient): Promise<number> {
  const raw = await secret(supabase, "FEEDBACK_REMINDER_DELAY_HOURS", "24");
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 336 ? n : 24;
}

/** Max FOLLOW-UP nudges beyond the first send (default 2, 0 disables). */
export async function feedbackMaxReminders(supabase: SupabaseClient): Promise<number> {
  const raw = await secret(supabase, "FEEDBACK_MAX_REMINDERS", "2");
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 2;
}

export function feedbackUrl(token: string): string {
  return `${SITE_BASE}/feedback/${token}`;
}

// ─── Personalization helpers ───────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard Clean",
  standard_clean: "Standard Clean",
  deep: "Deep Clean",
  deep_clean: "Deep Clean",
  move_in_out: "Move-In/Out Clean",
  move_in: "Move-In Clean",
  move_out: "Move-Out Clean",
  post_construction: "Post-Construction Clean",
  recurring: "Recurring Clean",
  airbnb: "Turnover Clean",
  str_turnover: "Turnover Clean",
  turnover: "Turnover Clean",
  office: "Office Clean",
  commercial: "Commercial Clean",
};

export function serviceLabel(t?: string | null): string {
  if (!t) return "cleaning";
  const key = String(t).toLowerCase().trim();
  if (SERVICE_LABELS[key]) return SERVICE_LABELS[key];
  const titled = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return /(clean|turnover)/i.test(titled) ? titled : `${titled} Clean`;
}

/** "Fri, Jul 17" style label for a YYYY-MM-DD string. */
export function shortDate(d?: string | null): string {
  if (!d) return "";
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

/** "Maria", "Maria and Cat", "Maria, Cat, and Sam". */
export function crewPhrase(names: string[]): string {
  const clean = (names || []).map((n) => (n || "").trim()).filter(Boolean);
  if (clean.length === 0) return "your cleaner";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

/** Short human description: "Deep Clean on Fri, Jul 17 in Annapolis". */
export function bookingSummary(ctx: FeedbackContext): string {
  let s = serviceLabel(ctx.serviceType);
  const d = shortDate(ctx.serviceDate);
  if (d) s += ` on ${d}`;
  if (ctx.city) s += ` in ${ctx.city}`;
  return s;
}

async function crewFirstNames(
  supabase: SupabaseClient,
  booking: { job_id: string | null; cleaner_id: string | null },
): Promise<string[]> {
  const ids = new Set<string>();
  if (booking.job_id) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("cleaner_id, status")
      .eq("job_id", booking.job_id);
    for (const a of assigns || []) {
      const s = String((a as { status?: string }).status || "").toLowerCase();
      const cid = (a as { cleaner_id?: string }).cleaner_id;
      if (cid && ["confirmed", "accepted", "completed", "in progress"].includes(s)) ids.add(cid);
    }
  }
  if (ids.size === 0 && booking.cleaner_id) ids.add(booking.cleaner_id);
  if (ids.size === 0) return [];
  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id, first_name")
    .in("id", [...ids]);
  return (cleaners || [])
    .map((c) => String((c as { first_name?: string }).first_name || "").trim())
    .filter(Boolean);
}

/** Resolve the full personalization context for a booking. */
export async function feedbackContext(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<FeedbackContext> {
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, first_name, last_name, email, phone, booking_number, service_type, service_date, city, state, job_id, cleaner_id",
    )
    .eq("id", bookingId)
    .maybeSingle();
  const booking = (b || {}) as Record<string, unknown>;
  const crewNames = await crewFirstNames(supabase, {
    job_id: (booking.job_id as string | null) ?? null,
    cleaner_id: (booking.cleaner_id as string | null) ?? null,
  });
  return {
    bookingId,
    firstName: (booking.first_name as string | null) ?? null,
    lastName: (booking.last_name as string | null) ?? null,
    email: (booking.email as string | null) ?? null,
    phone: (booking.phone as string | null) ?? null,
    bookingNumber: (booking.booking_number as number | null) ?? null,
    serviceType: (booking.service_type as string | null) ?? null,
    serviceDate: (booking.service_date as string | null) ?? null,
    city: (booking.city as string | null) ?? null,
    state: (booking.state as string | null) ?? null,
    crewNames,
  };
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

// ─── Message builders (personalized) ───────────────────────────────────

export function buildFeedbackSms(ctx: FeedbackContext, url: string): string {
  const name = ctx.firstName?.trim() || "there";
  return (
    `Hi ${name}! How was your ${bookingSummary(ctx)} with ${crewPhrase(ctx.crewNames)}? ` +
    `Your feedback takes under a minute — 3 quick questions: ${url} ` +
    `Reply STOP to opt out.`
  );
}

/** Softer copy for the follow-up nudge (link still unopened). */
export function buildFeedbackReminderSms(ctx: FeedbackContext, url: string): string {
  const name = ctx.firstName?.trim() || "there";
  return (
    `Hi ${name}, just checking in from Novara Cleaning about your ${bookingSummary(ctx)} ` +
    `with ${crewPhrase(ctx.crewNames)} — we'd still love your quick feedback (under a minute): ${url} ` +
    `Reply STOP to opt out.`
  );
}

export function buildFeedbackEmailHtml(ctx: FeedbackContext, url: string, opts?: { reminder?: boolean }): string {
  const name = ctx.firstName?.trim() || "there";
  const ref = ctx.bookingNumber ? `NVC-${String(ctx.bookingNumber).padStart(4, "0")}` : null;
  const loc = [ctx.city, ctx.state].filter(Boolean).join(", ");
  const crewLabel = ctx.crewNames.length > 1 ? "Cleaners" : "Cleaner";
  const rows: Array<[string, string]> = [];
  if (ref) rows.push(["Booking", ref]);
  rows.push(["Service", serviceLabel(ctx.serviceType)]);
  if (ctx.serviceDate) rows.push(["Date", shortDate(ctx.serviceDate)]);
  if (loc) rows.push(["Location", loc]);
  rows.push([crewLabel, crewPhrase(ctx.crewNames)]);
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 16px 5px 0;color:#6b7280;font-size:13px;white-space:nowrap;">${k}</td>` +
        `<td style="padding:5px 0;color:#111827;font-size:13px;font-weight:600;">${v}</td></tr>`,
    )
    .join("");
  const intro = opts?.reminder
    ? `We'd still love your feedback on your recent Novara clean — it only takes about a minute.`
    : `Thanks again for choosing Novara Cleaning! We'd love about a minute of your time — three quick questions about your experience with ${crewPhrase(ctx.crewNames)}.`;
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <p>Hi ${name},</p>
      <p>${intro}</p>
      <table style="border-collapse:collapse;margin:18px 0;background:#f9fafb;border-radius:10px;padding:8px;">
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin:24px 0;">
        <a href="${url}"
           style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;">
          Share your feedback
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280;">Your answers help us keep quality high and take care of anything that missed the mark. This link is personal to your job and expires after a short window.</p>
    </div>
  `;
}

// ─── Senders ────────────────────────────────────────────────────────────

async function sendFeedbackEmail(
  supabase: SupabaseClient,
  ctx: FeedbackContext,
  url: string,
  opts?: { reminder?: boolean },
): Promise<boolean> {
  if (!ctx.email) return false;
  try {
    const { resolveSecret } = await import("./app-secrets.ts");
    const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");
    if (!resendKey) return false;
    const subject = opts?.reminder
      ? "A quick reminder — how was your Novara clean?"
      : "How was your Novara clean? (3 quick questions)";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Novara Cleaning <hello@novaracleaning.com>",
        to: [ctx.email],
        subject,
        html: buildFeedbackEmailHtml(ctx, url, opts),
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn("[job-feedback-offer] email failed", e);
    return false;
  }
}

/**
 * First send: mint token, personalized SMS + email to the booking's
 * contacts, stamp sent_at. Non-throwing; reports which channels went out.
 */
export async function sendJobFeedbackOffer(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<{ feedbackUrl: string; token: string; smsSent: boolean; emailSent: boolean }> {
  // Per-booking admin opt-out (bookings.suppress_review_request).
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("suppress_review_request")
      .eq("id", bookingId)
      .maybeSingle();
    if (b?.suppress_review_request === true) {
      return { feedbackUrl: "", token: "", smsSent: false, emailSent: false };
    }
  } catch {
    /* proceed — sweep also filters */
  }

  const row = await ensureJobFeedback(supabase, bookingId);
  const url = feedbackUrl(row.token);
  const ctx = await feedbackContext(supabase, bookingId);

  let smsSent = false;
  if (ctx.phone) {
    try {
      smsSent = await sendSms(supabase, {
        toPhone: ctx.phone,
        message: buildFeedbackSms(ctx, url),
        type: "confirmation",
      });
    } catch (e) {
      console.warn("[job-feedback-offer] SMS failed", e);
    }
  }

  const emailSent = await sendFeedbackEmail(supabase, ctx, url);

  if (smsSent || emailSent) {
    await supabase
      .from("job_feedback")
      .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("sent_at", null);
  }

  return { feedbackUrl: url, token: row.token, smsSent, emailSent };
}

/**
 * Follow-up nudge: personalized reminder SMS + email for an already-minted
 * token. Non-throwing; reports which channels went out.
 */
export async function sendFeedbackReminder(
  supabase: SupabaseClient,
  bookingId: string,
  token: string,
): Promise<{ smsSent: boolean; emailSent: boolean }> {
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("suppress_review_request")
      .eq("id", bookingId)
      .maybeSingle();
    if (b?.suppress_review_request === true) {
      return { smsSent: false, emailSent: false };
    }
  } catch {
    /* proceed — sweep also filters */
  }

  const url = feedbackUrl(token);
  const ctx = await feedbackContext(supabase, bookingId);

  let smsSent = false;
  if (ctx.phone) {
    try {
      smsSent = await sendSms(supabase, {
        toPhone: ctx.phone,
        message: buildFeedbackReminderSms(ctx, url),
        type: "confirmation",
      });
    } catch (e) {
      console.warn("[job-feedback-offer] reminder SMS failed", e);
    }
  }

  const emailSent = await sendFeedbackEmail(supabase, ctx, url, { reminder: true });
  return { smsSent, emailSent };
}
