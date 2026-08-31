-- One-time: reinstate Kristian Toney from rejected → onboarding.
-- Safe to re-run: only touches rows still in rejected/withdrawn for that name.

UPDATE public.cleaner_applicants
SET
  stage = 'onboarding',
  rejection_reason = null,
  hold_pending = null,
  hold_follow_up_at = null,
  hold_reminder_sent_at = null,
  stage_changed_at = now(),
  stage_changed_by = 'system:reinstate-kristian-toney',
  updated_at = now()
WHERE stage IN ('rejected', 'withdrawn')
  AND (
    lower(coalesce(full_name, '')) = 'kristian toney'
    OR (
      lower(coalesce(first_name, '')) = 'kristian'
      AND lower(coalesce(last_name, '')) = 'toney'
    )
  );

-- If a linked cleaner row is inactive/pending, open it back for onboarding.
UPDATE public.cleaners c
SET
  status = 'pending',
  approved = false,
  available_for_bookings = false,
  deactivated_at = null,
  deactivation_reason = null,
  updated_at = now()
FROM public.cleaner_applicants a
WHERE a.cleaner_id = c.id
  AND (
    lower(coalesce(a.full_name, '')) = 'kristian toney'
    OR (
      lower(coalesce(a.first_name, '')) = 'kristian'
      AND lower(coalesce(a.last_name, '')) = 'toney'
    )
  )
  AND lower(coalesce(c.status, '')) IN ('inactive', 'pending');

INSERT INTO public.events (event_type, source, summary, data)
SELECT
  'applicant.reinstated',
  'migration',
  'Kristian Toney reinstated to onboarding (data migration)',
  jsonb_build_object(
    'applicant_id', a.id,
    'to', 'onboarding',
    'via', '20260727_reinstate_kristian_toney'
  )
FROM public.cleaner_applicants a
WHERE a.stage = 'onboarding'
  AND a.stage_changed_by = 'system:reinstate-kristian-toney'
  AND (
    lower(coalesce(a.full_name, '')) = 'kristian toney'
    OR (
      lower(coalesce(a.first_name, '')) = 'kristian'
      AND lower(coalesce(a.last_name, '')) = 'toney'
    )
  );
