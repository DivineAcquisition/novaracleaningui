-- ─── VA admin-portal access ─────────────────────────────────────────────
--
-- Goal: let users with the `va` role operate the admin portal alongside
-- `admin`. Today every admin RLS policy and the portal auth gate check
-- `has_role(uid,'admin')` only, so inserting `va` into user_roles grants
-- nothing.
--
-- This migration:
--   1. Adds `is_admin_or_va(uid)` — true when the user holds admin OR va.
--   2. Adds a permissive "VA staff full access" policy mirroring the
--      existing admin FOR ALL policy on every operational table the admin
--      portal touches. Policies are permissive (OR'd), and admin is part
--      of is_admin_or_va, so this is purely additive — admins are
--      unaffected, VAs gain the same access.
--
-- user_roles is intentionally excluded: granting va write access there
-- would allow self-escalation to admin. Role management is done only
-- through the admin-only `admin-create-team-user` edge function.

CREATE OR REPLACE FUNCTION public.is_admin_or_va(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('admin'::app_role, 'va'::app_role)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_or_va(uuid) TO authenticated, anon, service_role;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'app_config','availability','availability_slots','booking_sessions',
    'chat_insights','cleaner_flags','cleaner_onboarding_pins','cleaner_ratings',
    'cleaner_schedule_exceptions','cleaners','customer_credits','dispatch_alerts',
    'email_retry_queue','events','follow_ups','job_assignments','job_status_history',
    'jobs','lead_activity_log','leads','payouts','pricing_config','promo_codes',
    'reviews','sales_quotes','sales_scripts','service_coverage_zones',
    'sms_consent_logs','sms_logs','sms_retry_queue','training_lesson_progress',
    'training_lessons','training_modules','training_quiz_attempts',
    'training_quiz_questions','training_quizzes','va_assignments','webhook_failures',
    'bookings','customers'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "VA staff full access" ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY "VA staff full access" ON public.%I '
      || 'FOR ALL TO authenticated '
      || 'USING (public.is_admin_or_va(auth.uid())) '
      || 'WITH CHECK (public.is_admin_or_va(auth.uid()))',
      tbl
    );
  END LOOP;
END $$;
