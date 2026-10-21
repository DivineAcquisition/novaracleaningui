// First-job eligibility, mirrored in src/lib/cleaner-supplies.ts
// (isCleanerReadyForFirstJob) and public.cleaner_ready_for_first_job().
//
// A contractor who has already completed a job is past the gate. Everyone
// else must finish agreement → phone → supplies → job-day → dress code →
// W-9 → training videos before dispatch will offer them work. Stripe payout
// setup is the step before training. It is not itself part of this gate.
// The W-9 is.

export interface FirstJobReadyRow {
  completed_bookings?: number | null;
  ob_agreement_signed?: boolean | null;
  phone_verified?: boolean | null;
  supply_checklist_submitted_at?: string | null;
  ob_supplies_checklist_viewed?: boolean | null;
  ob_dress_code_ack?: boolean | null;
  ob_job_day_guides_ack?: boolean | null;
  ob_training_complete?: boolean | null;
  w9_status?: string | null;
  /** False blocks assignment. Missing means the older onboarding path. */
  kit_confirmed?: boolean | null;
  background_cleared?: boolean | null;
}

export function isCleanerReadyForFirstJob(c: FirstJobReadyRow): boolean {
  if (Number(c.completed_bookings || 0) > 0) return true;
  if (c.kit_confirmed === false || c.background_cleared === false) return false;
  return Boolean(
    c.ob_agreement_signed &&
      c.phone_verified &&
      (c.supply_checklist_submitted_at || c.ob_supplies_checklist_viewed) &&
      (c.ob_dress_code_ack || c.ob_job_day_guides_ack) &&
      c.ob_job_day_guides_ack &&
      c.w9_status === "complete" &&
      c.ob_training_complete,
  );
}

export function filterReadyForFirstJob<T extends FirstJobReadyRow>(rows: T[]): T[] {
  return rows.filter((c) => isCleanerReadyForFirstJob(c));
}

/** Columns the first-job gate reads. Append to a cleaners select. */
export const FIRST_JOB_READY_COLUMNS =
  "completed_bookings, ob_agreement_signed, phone_verified, supply_checklist_submitted_at, ob_supplies_checklist_viewed, ob_dress_code_ack, ob_job_day_guides_ack, ob_training_complete, w9_status, kit_confirmed, background_cleared";
