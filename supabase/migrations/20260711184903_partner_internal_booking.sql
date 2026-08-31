-- ─── Internal booking flow: Commercial · STR/Airbnb · Office ─────────────────
--
-- One internal booking flow for the three partner types, mirroring the
-- residential internal booking. The booking is the single source of truth for
-- the job: access + scope + deadline are first-class (and gated), pay is
-- locked at booking, and the contractor portal is populated from it.
--
-- 1. bookings: hard_deadline / access_method / partner_details (typed extras).
-- 2. partner_recurring_schedules: the commercial/STR analogue of the
--    residential customer_recurring_schedules — cadence per account+site or
--    host+property; a daily generator creates the next booking.
-- 3. Cron: partner-jobs-generate (daily 09:00 UTC).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS hard_deadline text,
  ADD COLUMN IF NOT EXISTS access_method text,
  ADD COLUMN IF NOT EXISTS partner_details jsonb;

-- ─── Recurring schedules for partner work ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_recurring_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_type text NOT NULL CHECK (booking_type IN ('commercial','office','str_turnover')),
  -- Commercial / office linkage
  business_account_id uuid REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  business_site_id uuid REFERENCES public.business_sites(id) ON DELETE SET NULL,
  -- STR linkage (Supabase operational tables)
  host_id uuid,
  property_id uuid,
  cadence text NOT NULL CHECK (cadence IN ('weekly','biweekly','monthly')),
  days_of_week integer[],           -- 0=Sun … 6=Sat (weekly/biweekly)
  day_of_month integer,             -- monthly
  preferred_window text,            -- e.g. "After 6 PM", "10:00 AM - 2:00 PM"
  hard_deadline text,               -- recurring hard stop, e.g. "Must finish by 6 AM"
  price_cents integer NOT NULL DEFAULT 0,
  cleaner_pay_pct integer NOT NULL DEFAULT 35,
  service_type text NOT NULL DEFAULT 'commercial',
  access_method text,
  access_notes text,
  scope_notes text,
  special_instructions text,
  preferred_cleaner_ids uuid[],
  next_service_date date,
  last_generated_date date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_recurring_next_idx
  ON public.partner_recurring_schedules (active, next_service_date);
ALTER TABLE public.partner_recurring_schedules ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_recurring_schedules' AND policyname='prs_admin_all') THEN
    CREATE POLICY prs_admin_all ON public.partner_recurring_schedules FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_recurring_schedules' AND policyname='prs_service_role') THEN
    CREATE POLICY prs_service_role ON public.partner_recurring_schedules FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;

-- ─── Cron: daily generator ───────────────────────────────────────────────────
DO $do$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_service_role text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'partner-jobs-generate';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('partner-jobs-generate'); END IF;
  PERFORM cron.schedule(
    'partner-jobs-generate',
    '0 9 * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/partner-jobs-generate',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      v_service_role
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping partner-jobs-generate scheduling: %', SQLERRM;
END $do$;
