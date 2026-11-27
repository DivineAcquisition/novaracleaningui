// ─── Today: actionable exceptions ─────────────────────────────────────────
//
// Turns booking rows Today already loads into work items an owner or VA can
// act on: which job, by when, why, and the next action with a link to the
// exact record. Pure so it can be tested without a database
// (scripts/verify-today-exceptions.ts).
//
// Only statuses the bookings table really uses are read:
//   pending_payment · pending_details · confirmed · assigned · completed · cancelled

export interface ExceptionJob {
  id: string;
  booking_number: number | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  status: string;
  service_date: string; // YYYY-MM-DD (Eastern)
  time_slot: string | null;
  cleaner_id?: string | null;
}

export type ExceptionKind = "needs_staffing" | "awaiting_payment" | "missing_details" | "not_closed";

export interface TodayException {
  key: string;
  kind: ExceptionKind;
  jobId: string;
  job: string;
  customer: string;
  /** When this stops being fixable without customer impact. */
  deadline: string;
  deadlineDate: string;
  reason: string;
  action: string;
  href: string;
  /** Lower sorts first. */
  urgency: number;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

export function jobLabel(j: Pick<ExceptionJob, "booking_number" | "id">): string {
  return j.booking_number ? `NVC-${String(j.booking_number).padStart(4, "0")}` : `Booking ${j.id.slice(0, 8)}`;
}

function customerName(j: ExceptionJob): string {
  return j.business_name || `${j.first_name || ""} ${j.last_name || ""}`.trim() || "Customer";
}

function whenLabel(j: ExceptionJob, todayIso: string): string {
  const d = daysBetween(todayIso, j.service_date);
  const day = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : j.service_date;
  return `${day}${j.time_slot ? ` · ${j.time_slot}` : ""}`;
}

/**
 * Rules (each produces at most one item per booking, most urgent wins):
 *  - Needs staffing: confirmed, no cleaner, visit within the next 2 days.
 *  - Awaiting payment: pending_payment with the visit within 3 days — it
 *    can't be staffed until paid.
 *  - Missing details: pending_details within 3 days.
 *  - Not closed out: confirmed/assigned with a visit date in the past 7 days.
 */
export function buildTodayExceptions(rows: ExceptionJob[], todayIso: string): TodayException[] {
  const out: TodayException[] = [];
  for (const j of rows) {
    if (j.status === "cancelled" || j.status === "completed") continue;
    const ahead = daysBetween(todayIso, j.service_date);
    const base = {
      jobId: j.id,
      job: jobLabel(j),
      customer: customerName(j),
      deadline: whenLabel(j, todayIso),
      deadlineDate: j.service_date,
    };
    if (ahead < 0 && ahead >= -7 && (j.status === "confirmed" || j.status === "assigned")) {
      out.push({
        ...base,
        key: `${j.id}:not_closed`,
        kind: "not_closed",
        reason: "Visit date has passed but the job isn't marked complete",
        action: "Review and close out",
        href: `/admin/bookings?highlight=${encodeURIComponent(j.id)}`,
        urgency: 30 + ahead, // older first within the band
      });
      continue;
    }
    if (ahead < 0) continue;
    if (j.status === "confirmed" && !j.cleaner_id && ahead <= 2) {
      out.push({
        ...base,
        key: `${j.id}:needs_staffing`,
        kind: "needs_staffing",
        reason: "Paid and confirmed, no cleaner assigned",
        action: "Offer to a cleaner",
        href: `/admin/operations?tab=dispatch&job=${encodeURIComponent(j.id)}`,
        urgency: ahead,
      });
    } else if (j.status === "pending_payment" && ahead <= 3) {
      out.push({
        ...base,
        key: `${j.id}:awaiting_payment`,
        kind: "awaiting_payment",
        reason: "Deposit not paid — can't be staffed until it clears",
        action: "Follow up on payment",
        href: `/admin/bookings?highlight=${encodeURIComponent(j.id)}`,
        urgency: 10 + ahead,
      });
    } else if (j.status === "pending_details" && ahead <= 3) {
      out.push({
        ...base,
        key: `${j.id}:missing_details`,
        kind: "missing_details",
        reason: "Booking details incomplete",
        action: "Complete the booking",
        href: `/admin/bookings?highlight=${encodeURIComponent(j.id)}`,
        urgency: 20 + ahead,
      });
    }
  }
  return out.sort((a, b) => a.urgency - b.urgency || a.deadlineDate.localeCompare(b.deadlineDate));
}

/** Window Today must load for the rules above. */
export function exceptionWindow(todayIso: string): { from: string; to: string } {
  return { from: addDays(todayIso, -7), to: addDays(todayIso, 3) };
}
