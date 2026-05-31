// ─── GHL booking team helpers ───────────────────────────────────────────
//
// Loads assigned cleaners from job_assignments (Cleaner directory rows)
// for GHL ops fields: Contractor 1–3, Contractor Number 1–3,
// Team Size (Assigned), Estimated Duration (hrs).

import { getEstimatedHours, getTeamSize } from "./payout-utils.ts";

export const GHL_ACTIVE_ASSIGNMENT_STATUSES = [
  "Confirmed",
  "Accepted",
  "Assigned",
];

export interface TeamCleanerForGhl {
  name?: string;
  phone?: string;
  payTier?: string | null;
  payRate?: number;
}

export interface BookingLikeForTeam {
  id?: string;
  job_id?: string | null;
  cleaner_id?: string | null;
  home_size_id?: string | null;
  estimated_duration_hours?: number | null;
  num_cleaners_assigned?: number | null;
  cleaners?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    pay_tier?: string | null;
    pay_percentage?: number | null;
  } | null;
}

/** Load up to 3 cleaners for GHL contractor slots (Lead first). */
export async function loadTeamCleanersForBooking(
  supabase: any,
  booking: BookingLikeForTeam,
): Promise<TeamCleanerForGhl[]> {
  const teamCleaners: TeamCleanerForGhl[] = [];

  if (booking.job_id) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select(
        "role, accepted_at, status, cleaners (first_name, last_name, phone, pay_tier, pay_percentage)",
      )
      .eq("job_id", booking.job_id)
      .in("status", GHL_ACTIVE_ASSIGNMENT_STATUSES);

    const rows = (assigns || []).slice().sort((a: any, b: any) => {
      const ra = String(a.role || "").toLowerCase() === "lead" ? 0 : 1;
      const rb = String(b.role || "").toLowerCase() === "lead" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return new Date(a.accepted_at || 0).getTime() - new Date(b.accepted_at || 0).getTime();
    });

    for (const a of rows) {
      const c = a?.cleaners;
      if (!c) continue;
      teamCleaners.push({
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
        phone: c.phone ?? undefined,
        payTier: c.pay_tier ?? null,
        payRate: Number(c.pay_percentage) || undefined,
      });
      if (teamCleaners.length >= 3) break;
    }
  }

  if (teamCleaners.length === 0 && booking.cleaners) {
    const c = booking.cleaners;
    teamCleaners.push({
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      phone: c.phone ?? undefined,
      payTier: c.pay_tier ?? null,
      payRate: Number(c.pay_percentage) || undefined,
    });
  }

  return teamCleaners;
}

export function plannedTeamSizeForBooking(booking: BookingLikeForTeam): number {
  if (booking.num_cleaners_assigned && booking.num_cleaners_assigned > 0) {
    return booking.num_cleaners_assigned;
  }
  if (booking.home_size_id) return getTeamSize(String(booking.home_size_id));
  return 2;
}

export function estimatedDurationForBooking(booking: BookingLikeForTeam): number | null {
  if (booking.estimated_duration_hours != null && booking.estimated_duration_hours > 0) {
    return Number(booking.estimated_duration_hours);
  }
  if (booking.home_size_id) return getEstimatedHours(String(booking.home_size_id));
  return null;
}

/** Ops-only custom fields for GHL (always includes 3 contractor slots for clearing). */
export function buildGhlOpsCustomFields(
  booking: BookingLikeForTeam,
  cleaners: TeamCleanerForGhl[],
): Record<string, string> {
  const teamSize = cleaners.length > 0
    ? cleaners.length
    : plannedTeamSizeForBooking(booking);
  const duration = estimatedDurationForBooking(booking);

  const out: Record<string, string> = {
    team_size_assigned: String(teamSize),
    estimated_duration_hrs: duration != null ? String(duration) : "",
    "1_contractor": cleaners[0]?.name || "",
    "1_contractor_number": cleaners[0]?.phone || "",
    "2_contractor": cleaners[1]?.name || "",
    "2_contractor_number": cleaners[1]?.phone || "",
    "3_contractor": cleaners[2]?.name || "",
    "3_contractor_number": cleaners[2]?.phone || "",
  };
  return out;
}
