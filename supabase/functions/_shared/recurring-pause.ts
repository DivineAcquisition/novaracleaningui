// ─── Recurring schedule pause — customer-facing reason copy ────────────────
//
// Keep in lock-step with src/lib/recurring-pause.ts.

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
