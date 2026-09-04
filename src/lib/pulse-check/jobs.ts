import type { SupabaseClient } from "@supabase/supabase-js";

import { computeCrewPay, payExplanation, shareFor, type CrewPayShare } from "@/lib/crew-pay";
import {
  assignmentOccupiesSlot,
  isEligibleForPulseJob,
  weekdayShort,
  type PulseCleanerForMatch,
} from "@/lib/pulse-check/eligibility";

export interface PulseJobCard {
  bookingId: string;
  jobId: string | null;
  serviceType: string;
  serviceLabel: string;
  dateLabel: string;
  timeLabel: string;
  zoneLabel: string;
  payCents: number;
  payLabel: string;
  crewSize: number;
}

const SKIP_BOOKING_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "refunded",
  "draft",
  "pending",
]);

const SKIP_JOB_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "in progress",
  "in_progress",
]);

export function serviceTypeLabel(serviceType: string | null | undefined): string {
  const key = String(serviceType || "standard").toLowerCase().replace(/-/g, "_");
  const map: Record<string, string> = {
    standard: "Standard Clean",
    deep: "Deep Clean",
    move_in_out: "Move-in / move-out",
    moveinout: "Move-in / move-out",
    recurring: "Recurring Clean",
    combo: "Combo (Deep + Standard)",
    focused: "Focused Clean",
    commercial: "Commercial",
    office: "Office Clean",
  };
  return map[key] || String(serviceType || "Cleaning").replace(/_/g, " ");
}

export function formatPulseDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function formatArrivalWindow(slot?: string | null): string {
  if (!slot) return "";
  const map: Record<string, string> = {
    "8-12": "8:00 AM – 12:00 PM",
    "12-16": "12:00 PM – 4:00 PM",
    "16-20": "4:00 PM – 8:00 PM",
    morning: "Morning",
    midday: "Midday",
    afternoon: "Afternoon",
    evening: "Evening",
  };
  return map[slot] || slot.replace(/\s*-\s*/, " – ");
}

export function zoneLabel(args: {
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const cityState = [args.city, args.state].filter(Boolean).join(", ");
  const zip = String(args.zip || "").replace(/\D/g, "").slice(0, 5);
  return [cityState, zip].filter(Boolean).join(" · ") || "Service area";
}

/** Mirror of supabase/functions/_shared/reclean.ts jobValueForPay. */
export function jobValueForPay(booking: {
  is_reclean?: boolean | null;
  reclean_assessed_value_cents?: number | null;
  final_charge_cents?: number | null;
  total_estimate_cents?: number | null;
}): number {
  if (booking.is_reclean) {
    const assessed = Math.round(Number(booking.reclean_assessed_value_cents) || 0);
    if (assessed <= 0) {
      throw new Error("Reclean pay basis missing — unpaid re-cleans are prohibited.");
    }
    return assessed;
  }
  return Math.max(
    0,
    Math.round(Number(booking.final_charge_cents) || Number(booking.total_estimate_cents) || 0),
  );
}

function parseTimeSlotStart(timeSlot: string | null | undefined): string {
  const raw = String(timeSlot || "").trim();
  const canonical: Record<string, string> = {
    "8-12": "08:00:00",
    "12-16": "12:00:00",
    "16-20": "16:00:00",
    morning: "08:00:00",
    midday: "12:00:00",
    afternoon: "12:00:00",
    evening: "16:00:00",
  };
  if (canonical[raw] || canonical[raw.toLowerCase()]) {
    return canonical[raw] || canonical[raw.toLowerCase()];
  }
  const m = raw.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return "09:00:00";
  let hour = parseInt(m[1], 10);
  const mer = (m[3] || "").toUpperCase();
  if (mer === "PM" && hour < 12) hour += 12;
  if (mer === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}:00`;
}

function todayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type SB = SupabaseClient;

interface CleanerRow extends PulseCleanerForMatch {
  id: string;
}

function crewIdsForPay(
  occupyingCleanerIds: string[],
  thisCleanerId: string,
): string[] {
  const ids = occupyingCleanerIds.filter((id) => id && id !== thisCleanerId);
  ids.push(thisCleanerId);
  return [...new Set(ids)];
}

async function payCard(
  supabase: SB,
  booking: Record<string, unknown>,
  occupyingCleanerIds: string[],
  cleanerId: string,
): Promise<{ payCents: number; payLabel: string; crewSize: number; share: CrewPayShare | null }> {
  let value = 0;
  try {
    value = jobValueForPay(booking);
  } catch {
    return { payCents: 0, payLabel: "", crewSize: occupyingCleanerIds.length + 1, share: null };
  }
  if (value <= 0) {
    return { payCents: 0, payLabel: "", crewSize: occupyingCleanerIds.length + 1, share: null };
  }
  const crew = crewIdsForPay(occupyingCleanerIds, cleanerId);
  const shares = await computeCrewPay(supabase, value, crew);
  const share = shareFor(shares, cleanerId);
  return {
    payCents: share?.shareCents ?? 0,
    payLabel: share ? payExplanation(share) : "",
    crewSize: share?.crewSize ?? crew.length,
    share,
  };
}

export async function listEligiblePulseJobs(
  supabase: SB,
  cleaner: CleanerRow,
): Promise<PulseJobCard[]> {
  const today = todayYmd();
  const end = new Date();
  end.setDate(end.getDate() + 21);
  const endYmd = todayYmd(end);

  const [{ data: bookings }, { data: jobs }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, job_id, status, service_date, time_slot, arrival_window, service_type, city, state, zip_code, address, total_estimate_cents, final_charge_cents, is_reclean, reclean_assessed_value_cents, estimated_duration_hours, num_cleaners_assigned",
      )
      .gte("service_date", today)
      .lte("service_date", endYmd)
      .order("service_date", { ascending: true })
      .limit(250),
    supabase
      .from("jobs")
      .select(
        "id, status, service_type, city, state, zip, address, start_datetime, duration_est_hours, min_cleaners_required, lat, lng",
      )
      .gte("start_datetime", `${today}T00:00:00`)
      .lte("start_datetime", `${endYmd}T23:59:59`)
      .order("start_datetime", { ascending: true })
      .limit(250),
  ]);

  const liveBookings = (bookings || []).filter(
    (b: Record<string, unknown>) => !SKIP_BOOKING_STATUSES.has(String(b.status || "").toLowerCase()),
  );
  const liveJobs = (jobs || []).filter(
    (j: Record<string, unknown>) => !SKIP_JOB_STATUSES.has(String(j.status || "").toLowerCase()),
  );

  const jobIds = liveJobs.map((j: Record<string, unknown>) => String(j.id));
  const assignmentsByJob = new Map<string, Record<string, unknown>[]>();
  if (jobIds.length > 0) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("id, job_id, cleaner_id, status")
      .in("job_id", jobIds);
    for (const a of assigns || []) {
      const jid = String(a.job_id);
      const list = assignmentsByJob.get(jid) || [];
      list.push(a);
      assignmentsByJob.set(jid, list);
    }
  }

  const bookingByJob = new Map<string, Record<string, unknown>>();
  for (const b of liveBookings) {
    if (b.job_id) bookingByJob.set(String(b.job_id), b);
  }

  const seenBooking = new Set<string>();
  const seenJob = new Set<string>();
  const eligible: Array<{
    booking: Record<string, unknown> | null;
    job: Record<string, unknown> | null;
    bookingId: string;
    jobId: string | null;
    occupyingIds: string[];
    serviceDate: string;
    zip: string | null;
  }> = [];

  const consider = (opts: {
    booking: Record<string, unknown> | null;
    job: Record<string, unknown> | null;
  }) => {
    const booking = opts.booking;
    const job = opts.job;
    const bookingId = booking ? String(booking.id) : "";
    const jobId = job ? String(job.id) : booking?.job_id ? String(booking.job_id) : null;
    if (bookingId && seenBooking.has(bookingId)) return;
    if (jobId && seenJob.has(jobId)) return;

    const assigns = jobId ? assignmentsByJob.get(jobId) || [] : [];
    if (assigns.some((a) => String(a.cleaner_id) === cleaner.id && assignmentOccupiesSlot(String(a.status)))) {
      return;
    }
    const occupying = assigns.filter((a) => assignmentOccupiesSlot(String(a.status)));
    const minRequired = Number(job?.min_cleaners_required) || Math.max(1, Number(booking?.num_cleaners_assigned) || 1);
    if (occupying.length >= minRequired) return;

    const serviceDate = String(booking?.service_date || "").slice(0, 10)
      || String(job?.start_datetime || "").slice(0, 10);
    const weekday = weekdayShort(serviceDate || String(job?.start_datetime || ""));
    const zip = String(booking?.zip_code || job?.zip || "") || null;
    const lat = Number(job?.lat);
    const lng = Number(job?.lng);

    const match = isEligibleForPulseJob(cleaner, {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      zip,
      weekday,
      timeSlot: String(booking?.time_slot || "") || null,
      arrivalWindow: String(booking?.arrival_window || "") || null,
      startDatetime: String(job?.start_datetime || "") || null,
      durationHours: Number(job?.duration_est_hours ?? booking?.estimated_duration_hours) || 3,
    });
    if (!match.ok) return;
    if (bookingId) seenBooking.add(bookingId);
    if (jobId) seenJob.add(jobId);
    eligible.push({
      booking,
      job,
      bookingId,
      jobId,
      occupyingIds: occupying.map((a) => String(a.cleaner_id)),
      serviceDate,
      zip,
    });
  };

  for (const job of liveJobs) {
    consider({ job, booking: bookingByJob.get(String(job.id)) || null });
  }
  for (const booking of liveBookings) {
    if (booking.job_id) continue;
    consider({ booking, job: null });
  }

  const cards: PulseJobCard[] = [];
  for (const item of eligible) {
    if (cards.length >= 12) break;
    if (!item.booking) continue;
    const pay = await payCard(supabase, item.booking, item.occupyingIds, cleaner.id);
    if (!pay.share || pay.payCents <= 0) continue;
    const serviceType = String(item.booking.service_type || item.job?.service_type || "standard");
    cards.push({
      bookingId: item.bookingId,
      jobId: item.jobId,
      serviceType,
      serviceLabel: serviceTypeLabel(serviceType),
      dateLabel: formatPulseDate(item.serviceDate),
      timeLabel: formatArrivalWindow(String(item.booking.time_slot || item.booking.arrival_window || "")) || "Time window on file",
      zoneLabel: zoneLabel({
        city: String(item.booking.city || item.job?.city || "") || null,
        state: String(item.booking.state || item.job?.state || "") || null,
        zip: item.zip,
      }),
      payCents: pay.payCents,
      payLabel: pay.payLabel,
      crewSize: pay.crewSize,
    });
  }

  return cards;
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function ensureJobForBooking(
  supabase: SB,
  bookingId: string,
): Promise<{ jobId: string; booking: Record<string, unknown> } | { error: string; taken?: boolean }> {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, job_id, customer_id, address, city, state, zip_code, service_type, service_date, time_slot, arrival_window, estimated_duration_hours, sqft, bedrooms, bathrooms, dispatch_notes, team_notes, status, total_estimate_cents, final_charge_cents, is_reclean, reclean_assessed_value_cents, num_cleaners_assigned",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!booking) return { error: "That job is no longer available.", taken: true };
  if (SKIP_BOOKING_STATUSES.has(String(booking.status || "").toLowerCase())) {
    return { error: "That job is no longer available.", taken: true };
  }
  if (booking.job_id) {
    return { jobId: String(booking.job_id), booking };
  }

  const startTime = parseTimeSlotStart(booking.time_slot || "morning");
  const startDatetime = `${booking.service_date}T${startTime}`;
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      customer_id: uuidOrNull(booking.customer_id),
      address: booking.address,
      city: booking.city,
      state: booking.state,
      zip: booking.zip_code,
      service_type: booking.service_type || "standard",
      start_datetime: startDatetime,
      duration_est_hours: Number(booking.estimated_duration_hours) || 3,
      sq_ft: Math.round(Number(booking.sqft) || 2000),
      bedrooms: Math.round(Number(booking.bedrooms) || 0),
      bathrooms: Number(booking.bathrooms) || 0,
      min_cleaners_required: Math.max(1, Number(booking.num_cleaners_assigned) || 1),
      status: "Offered",
    })
    .select("id")
    .single();
  if (jobErr || !job) return { error: jobErr?.message || "Could not open this job." };

  const { data: claimed } = await supabase
    .from("bookings")
    .update({ job_id: job.id })
    .eq("id", bookingId)
    .is("job_id", null)
    .select("id, job_id")
    .maybeSingle();

  if (!claimed) {
    const { data: refreshed } = await supabase
      .from("bookings")
      .select(
        "id, job_id, customer_id, address, city, state, zip_code, service_type, service_date, time_slot, arrival_window, estimated_duration_hours, sqft, bedrooms, bathrooms, status, total_estimate_cents, final_charge_cents, is_reclean, reclean_assessed_value_cents, num_cleaners_assigned",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (refreshed?.job_id) {
      return { jobId: String(refreshed.job_id), booking: refreshed };
    }
  }

  return { jobId: String(job.id), booking: { ...booking, job_id: job.id } };
}

export async function jobStillClaimable(
  supabase: SB,
  jobId: string,
  cleanerId: string,
): Promise<{ ok: true } | { ok: false; taken: boolean; message: string }> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, min_cleaners_required")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, taken: true, message: "That job is no longer available." };
  if (SKIP_JOB_STATUSES.has(String(job.status || "").toLowerCase())) {
    return { ok: false, taken: true, message: "That job is no longer available." };
  }
  const { data: assigns } = await supabase
    .from("job_assignments")
    .select("id, cleaner_id, status")
    .eq("job_id", jobId);
  const occupying = (assigns || []).filter((a) => assignmentOccupiesSlot(String(a.status)));
  if (occupying.some((a) => String(a.cleaner_id) === cleanerId)) {
    return { ok: false, taken: false, message: "This job is already on your schedule." };
  }
  const need = Number(job.min_cleaners_required) || 1;
  if (occupying.length >= need) {
    return {
      ok: false,
      taken: true,
      message: "That job was just claimed by someone else. It's been removed from your list.",
    };
  }
  return { ok: true };
}

export function newResponseToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function offerThenAccept(args: {
  supabase: SB;
  jobId: string;
  cleanerId: string;
  booking: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  taken?: boolean;
  already?: boolean;
  assignmentId?: string;
  jobId?: string;
  message?: string;
  reason?: string;
}> {
  const staffed = await jobStillClaimable(args.supabase, args.jobId, args.cleanerId);
  if (!staffed.ok) {
    return {
      ok: false,
      taken: staffed.taken,
      already: !staffed.taken,
      message: staffed.message,
      reason: staffed.taken ? "taken" : "already_yours",
    };
  }

  const { data: existing } = await args.supabase
    .from("job_assignments")
    .select("id, status, response_token")
    .eq("job_id", args.jobId)
    .eq("cleaner_id", args.cleanerId)
    .maybeSingle();

  const existingStatus = String(existing?.status || "").toLowerCase();
  if (existingStatus === "confirmed" || existingStatus === "accepted" || existingStatus === "assigned") {
    return {
      ok: true,
      already: true,
      assignmentId: String(existing.id),
      jobId: args.jobId,
    };
  }

  let token = String(existing?.response_token || "").trim();
  if (token.length < 16) token = newResponseToken();

  let value = 0;
  try {
    value = jobValueForPay(args.booking);
  } catch {
    value = Math.max(0, Math.round(Number(args.booking.total_estimate_cents) || 0));
  }
  const { data: occupying } = await args.supabase
    .from("job_assignments")
    .select("cleaner_id, status")
    .eq("job_id", args.jobId);
  const occupyingIds = (occupying || [])
    .filter((a) => assignmentOccupiesSlot(String(a.status)))
    .map((a) => String(a.cleaner_id));
  const crew = crewIdsForPay(occupyingIds, args.cleanerId);
  let shareCents: number | null = null;
  let ratePercent: number | null = null;
  let crewSize = crew.length;
  try {
    const shares = await computeCrewPay(args.supabase, value, crew);
    const share = shareFor(shares, args.cleanerId);
    shareCents = share?.shareCents ?? null;
    ratePercent = share?.ratePercent ?? null;
    crewSize = share?.crewSize ?? crew.length;
  } catch {
    /* pay snapshot is best-effort; accept-job-offer still assigns */
  }

  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const row = {
    job_id: args.jobId,
    cleaner_id: args.cleanerId,
    role: occupyingIds.length === 0 ? "Lead" : "Support",
    status: "Offered",
    response_token: token,
    estimated_pay_cents: shareCents,
    pay_percentage_snapshot: ratePercent,
    crew_size_snapshot: crewSize,
    expires_at: expires,
    reliability_neutral: Boolean(args.booking.is_reclean),
  };

  const { data: upserted, error: upErr } = await args.supabase
    .from("job_assignments")
    .upsert(row, { onConflict: "job_id,cleaner_id" })
    .select("id, response_token")
    .maybeSingle();
  if (upErr || !upserted) {
    return { ok: false, message: upErr?.message || "Could not claim this job." };
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, message: "Assignment service is not configured." };
  }

  const res = await fetch(`${url}/functions/v1/accept-job-offer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: JSON.stringify({ token: upserted.response_token || token, action: "accept" }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    reason?: string;
    message?: string;
    status?: string;
  };

  if (json.status === "already_accepted" || json.ok) {
    return {
      ok: true,
      assignmentId: String(upserted.id),
      jobId: args.jobId,
    };
  }

  const reason = String(json.reason || "");
  const taken = reason === "taken" || res.status === 409 && reason !== "overlap" && reason !== "buffer_conflict";
  return {
    ok: false,
    taken: taken || reason === "taken",
    reason,
    message: json.message || "That job is no longer available.",
    assignmentId: String(upserted.id),
    jobId: args.jobId,
  };
}
