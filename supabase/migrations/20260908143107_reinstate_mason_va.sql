-- One-time: reinstate Mason after offboarding. Safe to re-run.
-- Matches on email, not generated IDs.
-- Already applied on hosted as supabase_migrations 20260908143107.

UPDATE auth.users
SET banned_until = NULL
WHERE lower(email) IN ('mason@novaracleaning.com', 'mason.042123@gmail.com');

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'va'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'mason@novaracleaning.com'
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.va_onboarding v
SET
  status = 'approved',
  approved_at = COALESCE(v.approved_at, now()),
  approved_by = COALESCE(v.approved_by, 'ef8497bd-3bbe-4844-99d6-031c5a55de3e'),
  portal_user_id = COALESCE(
    (SELECT id FROM auth.users WHERE lower(email) = 'mason@novaracleaning.com' LIMIT 1),
    v.portal_user_id
  ),
  provisioned_at = COALESCE(v.provisioned_at, now()),
  performance_status = 'active',
  offboarded_at = NULL,
  offboarded_by = NULL,
  rejected_reason = NULL,
  updated_at = now()
WHERE lower(v.email) = 'mason.042123@gmail.com'
  AND v.agreement_signed_at IS NOT NULL
  AND v.status IN ('submitted', 'approved');

INSERT INTO public.events (event_type, source, summary, data)
SELECT
  'va.reinstated',
  'agent-on-malik-request',
  'VA reinstated — Mason (mason.042123@gmail.com / mason@novaracleaning.com). Workspace VA role restored, work login unbanned, performance status active.',
  jsonb_build_object(
    'email', v.email,
    'workEmail', 'mason@novaracleaning.com',
    'vaOnboardingId', v.id,
    'portalUserId', v.portal_user_id,
    'performanceStatus', v.performance_status,
    'status', v.status,
    'reinstatedBy', 'agent-on-malik-request'
  )
FROM public.va_onboarding v
WHERE lower(v.email) = 'mason.042123@gmail.com'
  AND v.status = 'approved'
  AND v.performance_status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.event_type = 'va.reinstated'
      AND e.data->>'vaOnboardingId' = v.id::text
      AND e.created_at > now() - interval '1 day'
  );
