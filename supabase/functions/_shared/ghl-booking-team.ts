// ─── GHL booking team helpers ───────────────────────────────────────────
//
// Loads assigned cleaners from job_assignments (Cleaner directory rows)
// for GHL ops fields: Contractor 1–3, numbers, pay amounts, team size, duration.

import { getEstimatedHours, getTeamSize } from "./payout-utils.ts";
import { formatPhoneDisplayUS } from "./phone-format.ts";
import { fmtMoney } from "./ghl-client.ts";

export const GHL_ACTIVE_ASSIGNMENT_STATUSES = [
  "Confirmed",
  "Accepted",
  "Assigned",
  "In Progress",
  "Offered",
  "Broadcast",
];

export interface TeamCleanerForGhl {
  name?: string;
  phone?: string;
  payTier?: string | null;
  payRate?: number;
  payPercentage?: number | null;
  estimatedPayCents?: number | null;
}

export interface BookingLikeForTeam {
  id?: string;
  job_id?: string | null;
  cleaner_id?: string | null;
  home_size_id?: string | null;
  estimated_duration_hours?: number | null;
  num_cleaners_assigned?: number | null;
  total_estimate_cents?: number | null;
  final_charge_cents?: number | null;
  cleaners?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    pay_tier?: string | null;
    pay_percentage?: number | null;
  } | null;
}

function perCleanerPayDisplay(c: TeamCleanerForGhl, revenueCents: number, teamCount: number): string {
  let cents = c.estimatedPayCents != null ? Number(c.estimatedPayCents) : 0;
  const pct = c.payPercentage ?? c.payRate ?? 35;
  if (cents <= 0 && revenueCents > 0 && pct > 0) {
    cents = Math.floor((revenueCents * pct) / 100 / Math.max(1, teamCount));
  }
  if (cents > 0) return fmtMoney(cents);
  return "";
}

/** Load up to 3 cleaners for GHL contractor slots (Lead first). */
export async function loadTeamCleanersForBooking(
  supabase: any,
  booking: BookingLikeForTeam,
): Promise<TeamCleanerForGhl[]> {
  const teamCleaners: TeamCleanerForGhl[] = [];
  const revenueCents = Number(booking.final_charge_cents || booking.total_estimate_cents || 0);

  if (booking.job_id) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select(
        "role, accepted_at, status, estimated_pay_cents, pay_percentage_snapshot, cleaners (first_name, last_name, phone, pay_tier, pay_percentage)",
      )
      .eq("job_id", booking.job_id)
      .in("status", GHL_ACTIVE_ASSIGNMENT_STATUSES);

    const rows = (assigns || []).slice().sort((a: any, b: any) => {
      const ra = String(a.role || "").toLowerCase() === "lead" ? 0 : 1;
      const rb = String(b.role || "").toLowerCase() === "lead" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return new Date(a.accepted_at || 0).getTime() - new Date(b.accepted_at || 0).getTime();
    });

    const teamCount = Math.max(1, rows.length);

    for (const a of rows) {
      const c = a?.cleaners;
      if (!c) continue;
      const payPct = Number(a.pay_percentage_snapshot ?? c.pay_percentage) || 35;
      let estPay = a.estimated_pay_cents != null ? Number(a.estimated_pay_cents) : null;
      if ((estPay == null || estPay <= 0) && revenueCents > 0) {
        estPay = Math.floor((revenueCents * payPct) / 100 / teamCount);
      }
      teamCleaners.push({
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
        phone: formatPhoneDisplayUS(c.phone ?? undefined),
        payTier: c.pay_tier ?? null,
        payRate: Number(c.pay_percentage) || undefined,
        payPercentage: payPct,
        estimatedPayCents: estPay,
      });
      if (teamCleaners.length >= 3) break;
    }
  }

  if (teamCleaners.length === 0 && booking.cleaners) {
    const c = booking.cleaners;
    const payPct = Number(c.pay_percentage) || 35;
    const estPay = revenueCents > 0 ? Math.floor((revenueCents * payPct) / 100) : null;
    teamCleaners.push({
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      phone: formatPhoneDisplayUS(c.phone ?? undefined),
      payTier: c.pay_tier ?? null,
      payRate: payPct,
      payPercentage: payPct,
      estimatedPayCents: estPay,
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

const CONTRACTOR_PAY_KEYS = [
  "1_contractor_pay",
  "2_contractor_pay",
  "3_contractor_pay",
  "1_contractor_pay_percentage",
  "2_contractor_pay_percentage",
  "3_contractor_pay_percentage",
] as const;

/** Ops-only custom fields for GHL (always includes 3 contractor slots for clearing). */
export function buildGhlOpsCustomFields(
  booking: BookingLikeForTeam,
  cleaners: TeamCleanerForGhl[],
): Record<string, string> {
  const teamSize = cleaners.length > 0
    ? cleaners.length
    : plannedTeamSizeForBooking(booking);
  const duration = estimatedDurationForBooking(booking);

  const revenueCents = Number(booking.final_charge_cents || booking.total_estimate_cents || 0);
  const payTeamCount = Math.max(1, cleaners.length);

  const out: Record<string, string> = {
    team_size_assigned: String(teamSize),
    estimated_duration_hrs: duration != null ? String(duration) : "",
    "1_contractor": cleaners[0]?.name || "",
    "1_contractor_number": cleaners[0]?.phone || "",
    "2_contractor": cleaners[1]?.name || "",
    "2_contractor_number": cleaners[1]?.phone || "",
    "3_contractor": cleaners[2]?.name || "",
    "3_contractor_number": cleaners[2]?.phone || "",
    "1_contractor_pay": perCleanerPayDisplay(cleaners[0] || {}, revenueCents, payTeamCount),
    "2_contractor_pay": perCleanerPayDisplay(cleaners[1] || {}, revenueCents, payTeamCount),
    "3_contractor_pay": perCleanerPayDisplay(cleaners[2] || {}, revenueCents, payTeamCount),
    "1_contractor_pay_percentage": cleaners[0]?.payPercentage != null
      ? `${cleaners[0].payPercentage}%`
      : "",
    "2_contractor_pay_percentage": cleaners[1]?.payPercentage != null
      ? `${cleaners[1].payPercentage}%`
      : "",
    "3_contractor_pay_percentage": cleaners[2]?.payPercentage != null
      ? `${cleaners[2].payPercentage}%`
      : "",
  };
  return out;
}

export { CONTRACTOR_PAY_KEYS };
