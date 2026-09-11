// ─── Recurring schedule pause — customer-facing reason copy ────────────────
//
// Keep in lock-step with supabase/functions/_shared/recurring-pause.ts.
// Admin picks a reason on /admin/recurring; that wording is what we SMS
// and email the customer.

export const RECURRING_PAUSE_PHONE = "(844) 735-2070";

export const RECURRING_PAUSE_REASON_IDS = [
  "cleaner_unavailable",
  "finding_coverage",
  "quality",
  "customer_request",
  "other",
] as const;

export type RecurringPauseReasonId = (typeof RECURRING_PAUSE_REASON_IDS)[number];

export const DEFAULT_RECURRING_PAUSE_REASON: RecurringPauseReasonId = "cleaner_unavailable";

export const RECURRING_PAUSE_REASON_OPTIONS: Array<{
  id: RecurringPauseReasonId;
  label: string;
}> = [
  { id: "cleaner_unavailable", label: "Cleaner no longer available" },
  { id: "finding_coverage", label: "Finding a replacement cleaner" },
  { id: "quality", label: "Quality follow-up" },
  { id: "customer_request", label: "Customer asked to pause" },
  { id: "other", label: "Other — write the message" },
];

export function isRecurringPauseReasonId(value: string): value is RecurringPauseReasonId {
  return (RECURRING_PAUSE_REASON_IDS as readonly string[]).includes(value);
}

function firstName(name?: string | null): string {
  return String(name || "").trim();
}

/** Customer-facing reason sentence (no Novara: prefix). Shown in SMS + email. */
export function buildRecurringPauseReason(
  id: RecurringPauseReasonId,
  customerFirstName?: string | null,
  custom?: string | null,
): string {
  if (id === "other") return String(custom || "").trim();
  const name = firstName(customerFirstName);
  const you = name || "Your cleaning";
  if (id === "cleaner_unavailable") {
    return name
      ? `${name}, your cleaning is paused until we find a replacement because your previous cleaner is no longer available.`
      : "Your cleaning is paused until we find a replacement because your previous cleaner is no longer available.";
  }
  if (id === "finding_coverage") {
    return name
      ? `${name}, your cleaning is paused while we find a cleaner for your next visit.`
      : "Your cleaning is paused while we find a cleaner for your next visit.";
  }
  if (id === "quality") {
    return name
      ? `${name}, your cleaning is paused while we sort out a quality issue from a recent visit.`
      : "Your cleaning is paused while we sort out a quality issue from a recent visit.";
  }
  // customer_request
  return name
    ? `${name}, your cleaning is paused at your request. Call ${RECURRING_PAUSE_PHONE} or reply when you're ready to resume.`
    : `${you} is paused at your request. Call ${RECURRING_PAUSE_PHONE} or reply when you're ready to resume.`;
}

export function buildRecurringPauseSms(reason: string): string {
  const body = String(reason || "").trim();
  if (!body) return "";
  if (/^novara:/i.test(body)) return body;
  return `Novara: ${body} We'll be in touch. ${RECURRING_PAUSE_PHONE}`;
}

export const RECURRING_PAUSE_EMAIL_SUBJECT = "Your Novara recurring cleaning is paused";
