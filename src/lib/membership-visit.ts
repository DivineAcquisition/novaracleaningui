// Recurring / Glow membership visits must never receive the one-time
// Service Agreement. That document is for a single job; members get the
// Recurring Service & Membership Agreement once at purchase/initiate.

export type MembershipVisitFields = {
  is_recurring?: boolean | null;
  booking_channel?: string | null;
  recurring_schedule_id?: string | null;
  membership_plan?: string | null;
};

export function isMembershipVisit(b: MembershipVisitFields): boolean {
  if (b.recurring_schedule_id) return true;
  if ((b.booking_channel || "").trim().toLowerCase() === "recurring") return true;
  const plan = (b.membership_plan || "").trim().toLowerCase();
  return Boolean(plan) && plan !== "none";
}

export function membershipPlanLabel(plan?: string | null): string | undefined {
  const p = (plan || "").trim().toLowerCase();
  if (p === "weekly") return "Glow Weekly";
  if (p === "biweekly") return "Glow Bi-Weekly";
  if (p === "monthly") return "Glow Monthly";
  if (!p || p === "none") return undefined;
  return plan || undefined;
}
