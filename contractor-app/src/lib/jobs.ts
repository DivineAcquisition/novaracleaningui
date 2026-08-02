// Job + offer data access. The queries here intentionally mirror
// src/views/cleaner/MobileDashboard.tsx so the native app and the web portal
// show a cleaner the same work; the write paths go through the same edge
// functions rather than touching job_assignments directly, because those
// functions own the overlap checks, pay locking and checklist provisioning.

import { supabase } from "./supabase";

/** job_assignments.status is written with inconsistent casing across the
 *  dispatch history, so every comparison here is case-insensitive. */
const ACCEPTED_STATUSES = ["Confirmed", "Accepted", "accepted", "In Progress"];

export interface JobRow {
  id: string;
  service_type: string | null;
  start_datetime: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  duration_est_hours: number | null;
  check_in_time: string | null;
  status: string | null;
}

export interface AssignmentRow {
  id: string;
  role: string | null;
  status: string | null;
  estimated_pay_cents: number | null;
  pay_percentage_snapshot: number | null;
  crew_size_snapshot: number | null;
  distance_miles: number | null;
  response_token: string | null;
  assigned_at: string | null;
  expires_at: string | null;
  jobs: JobRow | null;
}

export interface BookingLite {
  id: string;
  job_id: string | null;
  service_date: string | null;
  time_slot: string | null;
  arrival_window: string | null;
  status: string | null;
}

export interface UpcomingJob {
  assignment: AssignmentRow;
  booking: BookingLite | null;
}

/** Jobs the cleaner has accepted and still has to work. */
export async function fetchUpcomingJobs(cleanerId: string): Promise<UpcomingJob[]> {
  const { data, error } = await supabase
    .from("job_assignments")
    .select(
      `id, role, status, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot,
       distance_miles, response_token, assigned_at, expires_at,
       jobs ( id, service_type, start_datetime, address, city, state, zip,
              duration_est_hours, check_in_time, status )`,
    )
    .eq("cleaner_id", cleanerId)
    .in("status", ACCEPTED_STATUSES)
    .order("assigned_at", { ascending: true });

  if (error) throw error;

  const assignments = (data ?? []) as unknown as AssignmentRow[];
  const jobIds = assignments.map((a) => a.jobs?.id).filter((id): id is string => !!id);

  // The booking is the lifecycle source of truth: an assignment can still read
  // "Confirmed" after the booking was completed or cancelled, and showing that
  // as upcoming work would send a cleaner to a job that no longer exists.
  let bookings: BookingLite[] = [];
  if (jobIds.length > 0) {
    const { data: bookingRows } = await supabase
      .from("bookings")
      .select("id, job_id, service_date, time_slot, arrival_window, status")
      .in("job_id", jobIds);
    bookings = (bookingRows ?? []) as BookingLite[];
  }

  const byJobId = new Map(bookings.map((b) => [b.job_id, b]));
  const dead = new Set(["completed", "cancelled", "canceled", "pending_review"]);

  return assignments
    .map((assignment) => ({
      assignment,
      booking: assignment.jobs?.id ? byJobId.get(assignment.jobs.id) ?? null : null,
    }))
    .filter(({ booking }) => !booking || !dead.has((booking.status ?? "").toLowerCase()));
}

/** Live offers waiting on a yes/no from this cleaner. */
export async function fetchOpenOffers(cleanerId: string): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from("job_assignments")
    .select(
      `id, role, status, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot,
       distance_miles, response_token, assigned_at, expires_at,
       jobs ( id, service_type, start_datetime, address, city, state, zip,
              duration_est_hours, check_in_time, status )`,
    )
    .eq("cleaner_id", cleanerId)
    .in("status", ["Offered", "offered", "Broadcast"])
    .order("assigned_at", { ascending: false });

  if (error) throw error;

  const now = Date.now();
  return ((data ?? []) as unknown as AssignmentRow[]).filter(
    (a) => !a.expires_at || new Date(a.expires_at).getTime() > now,
  );
}

export interface OfferResponse {
  ok: boolean;
  status?: string;
  reason?: string;
  message?: string;
}

/**
 * Accept or decline via the edge function rather than updating the row. The
 * function runs the double-booking check, locks pay, sets bookings.cleaner_id
 * for the lead, and provisions the job checklist — none of which a direct
 * table write would do.
 */
export async function respondToOffer(
  token: string,
  action: "accept" | "decline",
): Promise<OfferResponse> {
  const { data, error } = await supabase.functions.invoke("accept-job-offer", {
    body: { token, action },
  });
  if (error) return { ok: false, reason: "network", message: error.message };
  return (data ?? { ok: false, reason: "empty" }) as OfferResponse;
}

/** Check in / out. Stamps the job, the assignment and the booking server-side. */
export async function checkInOut(params: {
  jobAssignmentId?: string;
  bookingId?: string;
  cleanerId: string;
  action: "check_in" | "check_out";
}): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await supabase.functions.invoke("job-check-in", {
    body: params,
  });
  if (error) return { ok: false, message: error.message };
  return (data ?? { ok: true }) as { ok: boolean; message?: string };
}

export interface MarkCompleteResponse {
  ok: boolean;
  status?: string;
  photoUploadUrl?: string;
  photoUploadToken?: string;
  alreadyCompleted?: boolean;
  error?: string;
}

/**
 * Cleaner-side completion. This is `cleaner-mark-complete`, which moves the
 * booking to pending_review for QC — not `complete-booking`, which is the
 * admin finalize that charges the customer and releases payout.
 */
export async function markJobComplete(
  bookingId: string,
  cleanerId: string,
): Promise<MarkCompleteResponse> {
  const { data, error } = await supabase.functions.invoke("cleaner-mark-complete", {
    body: { bookingId, cleanerId },
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "empty response" }) as MarkCompleteResponse;
}

export function formatMoney(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

export function formatServiceType(type: string | null | undefined): string {
  const map: Record<string, string> = {
    standard: "Standard Clean",
    deep: "Deep Clean",
    combo: "Deep + Standard Combo",
    moveInOut: "Move In/Out",
    move_in_out: "Move In/Out",
    focused: "Focused Clean",
  };
  if (!type) return "Cleaning";
  return map[type] ?? type;
}

export function formatWhen(job: JobRow | null, booking?: BookingLite | null): string {
  const iso = job?.start_datetime;
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }
  if (booking?.service_date) {
    // Bare calendar dates parse as UTC midnight, which renders as the previous
    // day in every timezone we operate in — anchor at local noon.
    const d = new Date(`${booking.service_date}T12:00:00`);
    const day = Number.isNaN(d.getTime())
      ? booking.service_date
      : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return booking.arrival_window || booking.time_slot
      ? `${day} · ${booking.arrival_window || booking.time_slot}`
      : day;
  }
  return "Date TBD";
}

export function formatAddress(job: JobRow | null): string {
  if (!job) return "";
  return [job.address, [job.city, job.state].filter(Boolean).join(", "), job.zip]
    .filter(Boolean)
    .join(" · ");
}
