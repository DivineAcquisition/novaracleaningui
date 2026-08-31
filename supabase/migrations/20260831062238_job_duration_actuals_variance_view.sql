-- The walkthrough pipeline's commercial_site_variance_v1 view reads
-- job_duration_actuals. That table lives in the July 28 delay-cascade
-- migration, which was never applied on the hosted project. Create the table
-- so the real view can exist without 500s. The write path
-- (record_job_duration_actual / booking_projection_v1) is a separate spec.

CREATE TABLE IF NOT EXISTS public.job_duration_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  service_date date,
  service_type text NOT NULL,
  home_size_id text,
  condition_level text,
  projected_hours numeric(6,2) NOT NULL CHECK (projected_hours > 0),
  actual_hours numeric(6,2) NOT NULL CHECK (actual_hours > 0),
  variance_hours numeric(6,2) GENERATED ALWAYS AS (actual_hours - projected_hours) STORED,
  variance_pct numeric(7,2) GENERATED ALWAYS AS
    (ROUND((actual_hours - projected_hours) / projected_hours * 100, 2)) STORED,
  scheduled_start_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  started_late_minutes integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jda_model_idx
  ON public.job_duration_actuals (service_type, home_size_id);
CREATE INDEX IF NOT EXISTS jda_cleaner_idx
  ON public.job_duration_actuals (cleaner_id, service_date DESC);
CREATE INDEX IF NOT EXISTS jda_recorded_idx
  ON public.job_duration_actuals (recorded_at DESC);

ALTER TABLE public.job_duration_actuals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'job_duration_actuals'
      AND policyname = 'job_duration_actuals_admin_read'
  ) THEN
    CREATE POLICY job_duration_actuals_admin_read
      ON public.job_duration_actuals
      FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'job_duration_actuals'
      AND policyname = 'job_duration_actuals_service_role'
  ) THEN
    CREATE POLICY job_duration_actuals_service_role
      ON public.job_duration_actuals
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON public.job_duration_actuals TO authenticated;
GRANT ALL ON public.job_duration_actuals TO service_role;

DROP VIEW IF EXISTS public.commercial_site_variance_v1;
CREATE VIEW public.commercial_site_variance_v1
WITH (security_invoker = true) AS
WITH visits AS (
  SELECT
    b.business_site_id                       AS site_id,
    d.projected_hours,
    d.actual_hours,
    d.variance_pct,
    b.recommended_crew_size,
    b.num_cleaners_assigned
  FROM public.job_duration_actuals d
  JOIN public.bookings b ON b.id = d.booking_id
  WHERE b.business_site_id IS NOT NULL
)
SELECT
  s.id                                       AS site_id,
  s.business_account_id                      AS account_id,
  a.business_name,
  s.nickname                                 AS site_nickname,
  s.firm_price_cents,
  s.walkthrough_id,
  w.conducted_on                             AS priced_from_walkthrough_on,
  count(v.*)::int                            AS samples,
  ROUND(avg(v.projected_hours), 2)           AS avg_projected_hours,
  ROUND(avg(v.actual_hours), 2)              AS avg_actual_hours,
  ROUND(avg(v.variance_pct), 1)              AS avg_variance_pct,
  ROUND(avg(v.num_cleaners_assigned::numeric), 1)   AS avg_crew_used,
  ROUND(avg(v.recommended_crew_size::numeric), 1)   AS avg_crew_recommended,
  (
    count(v.*) >= public.walkthrough_setting_int('variance_min_samples', 4)
    AND (
      abs(avg(v.variance_pct)) >= public.walkthrough_setting_int('variance_pct_threshold', 15)
      OR avg(v.num_cleaners_assigned::numeric) > avg(v.recommended_crew_size::numeric) + 0.5
    )
  )                                          AS rewalkthrough_suggested
FROM public.business_sites s
JOIN public.business_accounts a ON a.id = s.business_account_id
LEFT JOIN visits v ON v.site_id = s.id
LEFT JOIN public.commercial_walkthroughs w ON w.id = s.walkthrough_id
WHERE s.active
GROUP BY s.id, s.business_account_id, a.business_name, s.nickname,
         s.firm_price_cents, s.walkthrough_id, w.conducted_on;

COMMENT ON VIEW public.commercial_site_variance_v1 IS
  'Per-site projected vs actual service hours and crew size, read from job_duration_actuals. rewalkthrough_suggested is the signal that a site''s walkthrough assumptions no longer match how it actually services.';

GRANT SELECT ON public.commercial_site_variance_v1 TO authenticated, service_role;
