// ─── Bookings: saved views and separate job / payment / staffing status ──
//
// A booking carries three different questions that a single status badge
// blurred together: where is the JOB (scheduled, done, cancelled), where is
// the MONEY (deposit due, paid, credit) and who is STAFFING it. Views are
// URL-backed (?view=) so a saved link, the browser back button and opening a
// job all keep the operator's place. Pure for testing (npm run booking-views:verify).

export interface ViewBooking {
  status: string | null;
  service_date: string | null;
  cleaner_id: string | null;
  num_cleaners_assigned?: number | null;
  payment_received_at?: string | null;
  uses_credit?: boolean | null;
  deposit_cents?: number | null;
  final_charge_cents?: number | null;
  is_reclean?: boolean | null;
}

export type BookingViewId = "all" | "today" | "awaiting_deposit" | "needs_staffing" | "cleaner_done";

export const BOOKING_VIEWS: { id: BookingViewId; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every booking matching the filters" },
  { id: "today", label: "Today", hint: "Visits scheduled today (Eastern)" },
  { id: "awaiting_deposit", label: "Awaiting deposit", hint: "Created, first payment not received" },
  { id: "needs_staffing", label: "Needs staffing", hint: "Paid and confirmed, no cleaner assigned" },
  { id: "cleaner_done", label: "Cleaner done · review", hint: "Cleaner finished; review and close out" },
];

export function parseBookingView(raw: string | null | undefined): BookingViewId {
  return BOOKING_VIEWS.some((v) => v.id === raw) ? (raw as BookingViewId) : "all";
}

const isStaffed = (b: ViewBooking) => Boolean(b.cleaner_id) || (b.num_cleaners_assigned ?? 0) > 0;

export function matchesView(b: ViewBooking, view: BookingViewId, todayIso: string): boolean {
  switch (view) {
    case "all":
      return true;
    case "today":
      return b.service_date === todayIso && b.status !== "cancelled";
    case "awaiting_deposit":
      return b.status === "pending_payment" && !b.payment_received_at && b.uses_credit !== true;
    case "needs_staffing":
      return b.status === "confirmed" && !isStaffed(b);
    case "cleaner_done":
      return b.status === "pending_review";
  }
}

export type JobState = "Scheduled" | "Awaiting payment" | "Missing details" | "Cleaner done" | "Completed" | "Cancelled" | "Unknown";
export type PaymentState = "Deposit due" | "Paid" | "Membership credit" | "No charge" | "Not taken" | "—";
export type StaffingState = "Assigned" | "Unstaffed" | "Not yet" | "—";

export function jobState(b: ViewBooking): JobState {
  switch (b.status) {
    case "pending_payment":
      return "Awaiting payment";
    case "pending_details":
      return "Missing details";
    case "confirmed":
    case "assigned":
      return "Scheduled";
    case "pending_review":
      return "Cleaner done";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function paymentState(b: ViewBooking): PaymentState {
  if (b.is_reclean) return "No charge";
  if (b.uses_credit) return "Membership credit";
  if (b.payment_received_at) return "Paid";
  if (b.status === "pending_payment") return "Deposit due";
  if (b.status === "cancelled") return "Not taken";
  return "—";
}

export function staffingState(b: ViewBooking): StaffingState {
  if (b.status === "cancelled") return "—";
  if (isStaffed(b)) return "Assigned";
  // Pending bookings are staffed once paid; not a gap yet.
  if (b.status === "pending_payment" || b.status === "pending_details") return "Not yet";
  if (b.status === "completed" || b.status === "pending_review") return "—";
  return "Unstaffed";
}
