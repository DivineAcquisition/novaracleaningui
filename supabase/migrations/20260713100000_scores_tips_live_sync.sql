-- ─── Novara Score + Rating + Overall, tips pass-through, portal live sync ────
--
-- 1. Live sync: pay ledgers join the realtime publication so the contractor
--    portal reflects payouts/extras the moment they change.
-- 2. Scoring: three separate signals on cleaners — novara_score (reliability),
--    quality_score (QC + customer rating), overall_score (derived) — computed
--    by compute-cleaner-scores (cron every 6h + event-driven), weights in
--    app_settings, logged admin overrides in cleaner_score_overrides.
-- 3. Constraints: cleaner-stated limits (jsonb) feed the risk layer as
--    mismatch flags — never auto-restriction.
-- 4. Tips: cleaner_tips ledger — 100% pass-through, split equally across the
--    job's actual crew unless customer-directed, walled off from scores and
--    tier/job-value math.

-- ─── 1. Realtime: pay ledgers ────────────────────────────────────────────────
DO $do$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.manual_payouts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_extra_pay;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $do$;

-- ─── 2. Score columns + constraints ──────────────────────────────────────────
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS novara_score numeric,      -- reliability 0–100
  ADD COLUMN IF NOT EXISTS quality_score numeric,     -- quality 0–100
  ADD COLUMN IF NOT EXISTS overall_score numeric,     -- derived 0–100
  ADD COLUMN IF NOT EXISTS scores_computed_at timestamptz,
  ADD COLUMN IF NOT EXISTS constraints jsonb;         -- { no_work_after, no_work_before, notes }

-- ─── 3. Logged admin overrides ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_score_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('novara_score','quality_score','overall_score')),
  old_value numeric,
  new_value numeric,               -- NULL = override cleared (back to computed)
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cso_cleaner_idx ON public.cleaner_score_overrides (cleaner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cso_active_idx ON public.cleaner_score_overrides (cleaner_id, field) WHERE active;
ALTER TABLE public.cleaner_score_overrides ENABLE ROW LEVEL SECURITY;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cleaner_score_overrides' AND policyname='cso_admin_all') THEN
    CREATE POLICY cso_admin_all ON public.cleaner_score_overrides FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cleaner_score_overrides' AND policyname='cso_service_role') THEN
    CREATE POLICY cso_service_role ON public.cleaner_score_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;

-- ─── 4. Composite weights (admin-configurable) ───────────────────────────────
INSERT INTO public.app_settings (key, value, description) VALUES
  ('scoring_weights',
   '{"acceptance":40,"workload":30,"volume":30,"reliability":60,"quality":40}'::jsonb,
   'Novara Score composite weights (acceptance/workload/volume must sum ~100) and Overall split (reliability/quality must sum ~100).')
ON CONFLICT (key) DO NOTHING;

-- ─── 5. Tips ledger (walled off from scores + pay math) ──────────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  -- 'split' = equal share of a crew tip · 'directed' = customer named this cleaner
  allocation text NOT NULL DEFAULT 'split' CHECK (allocation IN ('split','directed')),
  crew_size integer NOT NULL DEFAULT 1,
  total_tip_cents integer NOT NULL,          -- the customer's full tip (before split)
  stripe_session_id text,                    -- idempotency key for the charge
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','paid_out')),
  paid_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cleaner_tips_session_cleaner_uniq
  ON public.cleaner_tips (stripe_session_id, cleaner_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cleaner_tips_cleaner_idx ON public.cleaner_tips (cleaner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cleaner_tips_booking_idx ON public.cleaner_tips (booking_id);
ALTER TABLE public.cleaner_tips ENABLE ROW LEVEL SECURITY;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cleaner_tips' AND policyname='tips_admin_read') THEN
    CREATE POLICY tips_admin_read ON public.cleaner_tips FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cleaner_tips' AND policyname='tips_service_role') THEN
    CREATE POLICY tips_service_role ON public.cleaner_tips FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;

-- Tips visible in the contractor portal live too.
DO $do$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cleaner_tips;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $do$;

-- ─── 6. Cron: compute scores every 6 hours ───────────────────────────────────
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

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'compute-cleaner-scores';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('compute-cleaner-scores'); END IF;
  PERFORM cron.schedule(
    'compute-cleaner-scores',
    '15 */6 * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/compute-cleaner-scores',
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
  RAISE NOTICE 'Skipping compute-cleaner-scores scheduling: %', SQLERRM;
END $do$;
