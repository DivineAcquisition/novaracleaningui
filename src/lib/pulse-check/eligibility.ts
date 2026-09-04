import { scoreCleanerForJob } from "@/lib/dispatch-scoring";

/** Assignment statuses that do not count as "got work" for idle detection. */
export const PULSE_NON_WORK_ASSIGNMENT_STATUSES = [
  "declined",
  "expired",
  "withdrawn",
  "broadcast_lost",
  "needs_reassignment",
] as const;

/** Crew rows that occupy a slot on a live job. */
export const PULSE_ACTIVE_CREW_STATUSES = [
  "confirmed",
  "accepted",
  "assigned",
  "in progress",
  "in_progress",
] as const;

export function assignmentCountsAsWork(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase().replace(/-/g, "_");
  return !PULSE_NON_WORK_ASSIGNMENT_STATUSES.includes(
    s as (typeof PULSE_NON_WORK_ASSIGNMENT_STATUSES)[number],
  );
}

export function assignmentOccupiesSlot(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase().replace(/-/g, "_");
  return (PULSE_ACTIVE_CREW_STATUSES as readonly string[]).includes(s);
}

export function isActivePulseContractor(cleaner: {
  status?: string | null;
  approved?: boolean | null;
  available_for_bookings?: boolean | null;
}): boolean {
  return (
    String(cleaner.status || "").toLowerCase() === "active" &&
    cleaner.approved === true &&
    cleaner.available_for_bookings === true
  );
}

export function qualifiesForPulseCheck(args: {
  cleaner: {
    status?: string | null;
    approved?: boolean | null;
    available_for_bookings?: boolean | null;
  };
  recentAssignmentStatuses: Array<string | null | undefined>;
}): boolean {
  if (!isActivePulseContractor(args.cleaner)) return false;
  return !args.recentAssignmentStatuses.some((s) => assignmentCountsAsWork(s));
}

export function toMinutes(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (!Number.isFinite(h) || h > 23) return null;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h * 60 + min;
}

const CANONICAL_WINDOWS: Record<string, { start: string; end: string }> = {
  "8-12": { start: "08:00:00", end: "12:00:00" },
  "12-16": { start: "12:00:00", end: "16:00:00" },
  "16-20": { start: "16:00:00", end: "20:00:00" },
  morning: { start: "08:00:00", end: "12:00:00" },
  midday: { start: "12:00:00", end: "16:00:00" },
  afternoon: { start: "12:00:00", end: "16:00:00" },
  evening: { start: "16:00:00", end: "20:00:00" },
};

function clockToMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const m = String(clock).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Start/end minutes for a booking window or job timestamp. */
export function jobWindowMinutes(args: {
  timeSlot?: string | null;
  arrivalWindow?: string | null;
  startDatetime?: string | null;
  durationHours?: number | null;
}): { start: number | null; end: number | null } {
  const slot = String(args.timeSlot || args.arrivalWindow || "").trim();
  const canonical = CANONICAL_WINDOWS[slot] || CANONICAL_WINDOWS[slot.toLowerCase()];
  if (canonical) {
    return { start: clockToMinutes(canonical.start), end: clockToMinutes(canonical.end) };
  }
  const free = slot.match(
    /(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i,
  );
  if (free) {
    const toMin = (h: string, mm: string | undefined, mer: string | undefined) => {
      let hour = parseInt(h, 10);
      if (mer) {
        const u = mer.toUpperCase();
        if (u === "PM" && hour < 12) hour += 12;
        if (u === "AM" && hour === 12) hour = 0;
      }
      return hour * 60 + parseInt(mm || "0", 10);
    };
    return { start: toMin(free[1], free[2], free[3]), end: toMin(free[4], free[5], free[6]) };
  }
  if (args.startDatetime) {
    const start = new Date(args.startDatetime);
    if (!Number.isNaN(start.getTime())) {
      const startMin = start.getHours() * 60 + start.getMinutes();
      const dur = Number(args.durationHours);
      const endMin = Number.isFinite(dur) && dur > 0 ? startMin + Math.round(dur * 60) : startMin + 180;
      return { start: startMin, end: endMin };
    }
  }
  return { start: null, end: null };
}

export function passesHardCutoffs(args: {
  noWorkAfter?: string | null;
  noWorkBefore?: string | null;
  window: { start: number | null; end: number | null };
}): boolean {
  const after = toMinutes(args.noWorkAfter);
  const before = toMinutes(args.noWorkBefore);
  if (after != null && args.window.end != null && args.window.end > after) return false;
  if (before != null && args.window.start != null && args.window.start < before) return false;
  return true;
}

export function weekdayShort(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const d = isoDate.length <= 10
    ? new Date(`${isoDate}T12:00:00`)
    : new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function passesPreferredDays(
  preferredWorkDays: string[] | null | undefined,
  weekday: string,
): boolean {
  const prefs = (preferredWorkDays || []).map((d) => String(d).slice(0, 3).toLowerCase());
  if (prefs.length === 0) return true;
  const day = String(weekday || "").slice(0, 3).toLowerCase();
  if (!day) return true;
  return prefs.includes(day);
}

export function zipInServiceZone(
  jobZip: string | null | undefined,
  cleaner: { service_zip_codes?: string[] | null; home_zip?: string | null },
): boolean {
  const zip = String(jobZip || "").replace(/\D/g, "").slice(0, 5);
  if (!zip) return false;
  const zips = (cleaner.service_zip_codes || [])
    .map((z) => String(z).replace(/\D/g, "").slice(0, 5))
    .filter(Boolean);
  if (zips.length > 0) return zips.includes(zip);
  const home = String(cleaner.home_zip || "").replace(/\D/g, "").slice(0, 5);
  return home ? home === zip : false;
}

export interface PulseCleanerForMatch {
  home_lat?: number | null;
  home_lng?: number | null;
  average_rating?: number | null;
  total_ratings?: number | null;
  workload_score?: number | null;
  acceptance_rate?: number | null;
  on_time_rate?: number | null;
  preferred_work_days?: string[] | null;
  max_travel_miles?: number | null;
  upcoming_jobs_count?: number | null;
  max_weekly_bookings?: number | null;
  service_zip_codes?: string[] | null;
  home_zip?: string | null;
  constraints?: { no_work_after?: string; no_work_before?: string } | null;
}

export interface PulseJobForMatch {
  lat?: number | null;
  lng?: number | null;
  zip?: string | null;
  weekday: string;
  timeSlot?: string | null;
  arrivalWindow?: string | null;
  startDatetime?: string | null;
  durationHours?: number | null;
}

/**
 * Pulse-check listing filter. Reuses scoreCleanerForJob for zone/capacity,
 * then applies availability windows as hard filters (preferred days + cutoffs)
 * so a contractor never sees a job they cannot actually take.
 */
export function isEligibleForPulseJob(
  cleaner: PulseCleanerForMatch,
  job: PulseJobForMatch,
): { ok: boolean; reason?: string; distanceMiles?: number | null } {
  const window = jobWindowMinutes({
    timeSlot: job.timeSlot,
    arrivalWindow: job.arrivalWindow,
    startDatetime: job.startDatetime,
    durationHours: job.durationHours,
  });
  if (!passesHardCutoffs({
    noWorkAfter: cleaner.constraints?.no_work_after,
    noWorkBefore: cleaner.constraints?.no_work_before,
    window,
  })) {
    return { ok: false, reason: "outside_hard_cutoff" };
  }
  if (!passesPreferredDays(cleaner.preferred_work_days, job.weekday)) {
    return { ok: false, reason: "outside_preferred_days" };
  }

  const lat = Number(job.lat);
  const lng = Number(job.lng);
  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lng) && Boolean(cleaner.home_lat) && Boolean(cleaner.home_lng);

  if (hasCoords) {
    const scored = scoreCleanerForJob(cleaner, { lat, lng, weekday: job.weekday });
    if (!scored.available) {
      return { ok: false, reason: scored.reason, distanceMiles: scored.distance };
    }
    return { ok: true, distanceMiles: scored.distance };
  }

  if (!zipInServiceZone(job.zip, cleaner)) {
    return { ok: false, reason: "outside_service_zone" };
  }
  const upcoming = Number(cleaner.upcoming_jobs_count) || 0;
  const maxWeekly = Number(cleaner.max_weekly_bookings) || 10;
  if (upcoming >= maxWeekly) {
    return { ok: false, reason: "at_capacity" };
  }
  return { ok: true, distanceMiles: null };
}
