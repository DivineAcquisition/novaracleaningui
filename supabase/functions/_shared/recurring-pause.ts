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

/** Not an admin picker option — stamped when the customer pauses themselves. */
export const CUSTOMER_SELF_PAUSE_REASON_CODE = "customer_self";
export const CUSTOMER_SELF_PAUSE_REASON = "Paused by the customer.";

/** Clear stored pause copy on every resume so a later pause cannot show stale wording. */
export function recurringResumeClearFields(): {
  pause_reason: null;
  pause_reason_code: null;
  paused_at: null;
} {
  return {
    pause_reason: null,
    pause_reason_code: null,
    paused_at: null,
  };
}

/** Overwrite admin pause copy when the customer pauses from the manage link or portal. */
export function customerSelfPauseFields(): {
  pause_reason: string;
  pause_reason_code: string;
  paused_at: string;
} {
  return {
    pause_reason: CUSTOMER_SELF_PAUSE_REASON,
    pause_reason_code: CUSTOMER_SELF_PAUSE_REASON_CODE,
    paused_at: new Date().toISOString(),
  };
}
