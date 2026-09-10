-- Pulse status view must use the caller's RLS (admin/VA), not the view owner's.
-- Same pattern as cleaner_agreement_status_v1.

CREATE OR REPLACE VIEW public.cleaner_pulse_status_v1
WITH (security_invoker = true) AS
SELECT
  e.id AS entry_id,
  e.cycle_id,
  cy.started_at AS cycle_started_at,
  cy.interval_days,
  e.cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.email,
  c.phone,
  c.status AS cleaner_status,
  e.outcome,
  e.sent_at,
  e.emailed,
  e.sms_sent,
  e.followup_sent_at,
  e.opened_at,
  e.submitted_at,
  e.answers,
  e.draft,
  e.claimed_job_ids,
  e.claimed_assignment_ids,
  e.claimed_booking_ids,
  COALESCE(array_length(e.claimed_job_ids, 1), 0) AS claimed_job_count,
  e.availability_updated,
  e.admin_reviewed_at,
  e.admin_note,
  e.token_expires_at,
  e.token IS NOT NULL
    AND (e.token_expires_at IS NULL OR e.token_expires_at > now()) AS link_outstanding
FROM public.pulse_check_entries e
JOIN public.pulse_check_cycles cy ON cy.id = e.cycle_id
JOIN public.cleaners c ON c.id = e.cleaner_id;

COMMENT ON VIEW public.cleaner_pulse_status_v1 IS
  'Per-cycle pulse-check standing: response, answers, and whether they claimed a job. Permanent history on the contractor record. security_invoker, so the caller''s own access to pulse_check_entries and cleaners applies.';

GRANT SELECT ON public.cleaner_pulse_status_v1 TO authenticated, service_role;
