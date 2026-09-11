-- Manual / one-off pulse checks must not reset the 14-day idle schedule.
-- counts_toward_interval=false is an admin send to one contractor.

ALTER TABLE public.pulse_check_cycles
  ADD COLUMN IF NOT EXISTS counts_toward_interval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'cron',
  ADD COLUMN IF NOT EXISTS started_by uuid;

COMMENT ON COLUMN public.pulse_check_cycles.counts_toward_interval IS
  'When false, this row is a one-off admin send and must not move the recurring idle-cycle clock.';
COMMENT ON COLUMN public.pulse_check_cycles.source IS
  'cron | admin (full idle cycle) | admin-one (single contractor).';

CREATE INDEX IF NOT EXISTS pulse_check_cycles_interval_started_idx
  ON public.pulse_check_cycles (started_at DESC)
  WHERE counts_toward_interval;

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
    AND (e.token_expires_at IS NULL OR e.token_expires_at > now()) AS link_outstanding,
  cy.counts_toward_interval,
  cy.source AS cycle_source
FROM public.pulse_check_entries e
JOIN public.pulse_check_cycles cy ON cy.id = e.cycle_id
JOIN public.cleaners c ON c.id = e.cleaner_id;

COMMENT ON VIEW public.cleaner_pulse_status_v1 IS
  'Per-cycle pulse-check standing: response, answers, and whether they claimed a job. Permanent history on the contractor record. security_invoker, so the caller''s own access to pulse_check_entries and cleaners applies.';

GRANT SELECT ON public.cleaner_pulse_status_v1 TO authenticated, service_role;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.pulse_manual_sent', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
