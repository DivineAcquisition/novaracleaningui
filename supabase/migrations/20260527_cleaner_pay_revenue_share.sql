-- ─── Cleaner pay model: hourly → revenue share ──────────────────
--
-- Replaces the old hourly-rate compensation model with a flat
-- percentage of customer-paid job revenue. Three tiers:
--   Foundation : 40% of job revenue
--   Proven     : 45% of job revenue
--   Elite      : 50% of job revenue
--
-- Multi-cleaner jobs: tier % applies to job total, cleaners split
-- the pool evenly. Mixed tiers use the HIGHEST tier on the job
-- (rewards lower-tier cleaners working alongside Elites).
--
-- Migration leaves legacy columns (pay_rate_hr, platform_fee_pct,
-- net_rate_hr, cleaner_hourly_rate_cents, job_assignments.pay_rate_hr)
-- intact for historical bookings — they are no longer written to but
-- still available for the audit log and old payouts.

-- 1. New pay_percentage column on cleaners (40 / 45 / 50)
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS pay_percentage SMALLINT;

UPDATE public.cleaners
SET pay_percentage = CASE
  WHEN lower(coalesce(pay_tier, 'foundation')) = 'elite' THEN 50
  WHEN lower(coalesce(pay_tier, 'foundation')) = 'proven' THEN 45
  ELSE 40
END
WHERE pay_percentage IS NULL;

ALTER TABLE public.cleaners
  ALTER COLUMN pay_percentage SET DEFAULT 40,
  ALTER COLUMN pay_percentage SET NOT NULL;

ALTER TABLE public.cleaners
  DROP CONSTRAINT IF EXISTS cleaners_pay_percentage_chk;
ALTER TABLE public.cleaners
  ADD CONSTRAINT cleaners_pay_percentage_chk
  CHECK (pay_percentage IN (40, 45, 50));

COMMENT ON COLUMN public.cleaners.pay_percentage IS
  'Cleaner revenue share %: 40 (Foundation), 45 (Proven), 50 (Elite). Replaces the legacy pay_rate_hr / platform_fee_pct hourly model.';

COMMENT ON COLUMN public.cleaners.pay_rate_hr IS
  'DEPRECATED — kept for historical audit only. Pay is now revenue-share via pay_percentage.';
COMMENT ON COLUMN public.cleaners.platform_fee_pct IS
  'DEPRECATED — superseded by pay_percentage (cleaner share of revenue, not platform fee on hourly).';
COMMENT ON COLUMN public.cleaners.net_rate_hr IS
  'DEPRECATED — net hourly is meaningless under revenue share.';

-- 2. Helper function: compute one cleaner's payout in cents
CREATE OR REPLACE FUNCTION public.compute_cleaner_payout_cents(
  _revenue_cents bigint,
  _pay_percentage smallint,
  _cleaner_count int
) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(
    0,
    (COALESCE(_revenue_cents, 0) * COALESCE(_pay_percentage, 40)) / 100
  ) / GREATEST(COALESCE(_cleaner_count, 1), 1);
$$;

COMMENT ON FUNCTION public.compute_cleaner_payout_cents(bigint, smallint, int) IS
  'Per-cleaner payout: (revenue * pay_percentage / 100) / cleaner_count. Use the highest pay_percentage on the job when tiers differ.';

-- 3. Helper function: pick the highest tier % across a set of cleaners
CREATE OR REPLACE FUNCTION public.max_pay_percentage_for_cleaners(_cleaner_ids uuid[])
RETURNS smallint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(MAX(pay_percentage), 40)::smallint
  FROM public.cleaners
  WHERE id = ANY(_cleaner_ids);
$$;

-- 4. Trigger to keep pay_percentage in sync with pay_tier when the
--    tier is bumped via cleaner-admin-action or admin UI.
CREATE OR REPLACE FUNCTION public.cleaners_sync_pay_percentage()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.pay_tier IS DISTINCT FROM OLD.pay_tier THEN
    NEW.pay_percentage := CASE
      WHEN lower(coalesce(NEW.pay_tier, 'foundation')) = 'elite' THEN 50
      WHEN lower(coalesce(NEW.pay_tier, 'foundation')) = 'proven' THEN 45
      ELSE 40
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaners_sync_pay_percentage_trg ON public.cleaners;
CREATE TRIGGER cleaners_sync_pay_percentage_trg
  BEFORE INSERT OR UPDATE OF pay_tier ON public.cleaners
  FOR EACH ROW EXECUTE FUNCTION public.cleaners_sync_pay_percentage();

-- 5. Snapshot column on job_assignments — captures the % used at
--    dispatch time so a tier bump after dispatch doesn't retroactively
--    change the offered pay.
ALTER TABLE public.job_assignments
  ADD COLUMN IF NOT EXISTS pay_percentage_snapshot SMALLINT;
COMMENT ON COLUMN public.job_assignments.pay_percentage_snapshot IS
  'Cleaner revenue share % captured when this assignment was offered. Used by complete-booking + process-payout so a tier bump after dispatch does not retroactively change the offered pay.';

-- 6. Replace cleaner_payroll_v1 view to expose pay_percentage instead
--    of pay_rate_hr (drop+create needed for column rename).
DROP VIEW IF EXISTS public.cleaner_payroll_v1;

CREATE VIEW public.cleaner_payroll_v1 AS
WITH latest_payout_per_booking AS (
  SELECT DISTINCT ON (p.booking_id)
    p.booking_id, p.id AS payout_id, p.status AS payout_status,
    p.cleaner_payout_cents, p.processed_at, p.failed_reason
  FROM public.payouts p
  ORDER BY p.booking_id, p.created_at DESC
),
booking_rollup AS (
  SELECT
    b.id AS booking_id, b.cleaner_id, b.booking_number,
    b.status AS booking_status, b.service_date, b.completed_at, b.service_type,
    b.cleaner_payout_cents AS booking_payout_cents,
    lp.payout_id,
    COALESCE(lp.payout_status, 'unpaid') AS effective_payout_status,
    COALESCE(lp.cleaner_payout_cents, b.cleaner_payout_cents, 0) AS effective_payout_cents,
    lp.processed_at, lp.failed_reason
  FROM public.bookings b
  LEFT JOIN latest_payout_per_booking lp ON lp.booking_id = b.id
  WHERE b.cleaner_id IS NOT NULL AND b.status IN ('completed','in_progress')
)
SELECT
  c.id AS cleaner_id, c.first_name, c.last_name, c.email, c.phone,
  c.status AS cleaner_status,
  c.pay_tier,
  c.pay_percentage,
  c.stripe_account_id, c.payouts_enabled,
  c.average_rating, c.completed_bookings,
  COUNT(br.booking_id) FILTER (WHERE br.booking_status='completed')   AS jobs_completed,
  COUNT(br.booking_id) FILTER (WHERE br.booking_status='in_progress') AS jobs_in_progress,
  COALESCE(SUM(br.effective_payout_cents) FILTER (WHERE br.effective_payout_status='completed'), 0)::bigint AS paid_cents,
  COALESCE(SUM(br.effective_payout_cents) FILTER (WHERE br.effective_payout_status IN ('processing','pending')), 0)::bigint AS processing_cents,
  COALESCE(SUM(br.effective_payout_cents) FILTER (WHERE br.effective_payout_status='unpaid' AND br.booking_status='completed'), 0)::bigint AS owed_cents,
  COALESCE(SUM(br.effective_payout_cents) FILTER (WHERE br.effective_payout_status='failed'), 0)::bigint AS failed_cents,
  MAX(br.processed_at) AS last_paid_at,
  MIN(br.completed_at) FILTER (WHERE br.effective_payout_status='unpaid' AND br.booking_status='completed') AS oldest_unpaid_completed_at
FROM public.cleaners c
LEFT JOIN booking_rollup br ON br.cleaner_id = c.id
GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.status,
  c.pay_tier, c.pay_percentage, c.stripe_account_id, c.payouts_enabled,
  c.average_rating, c.completed_bookings;

COMMENT ON VIEW public.cleaner_payroll_v1 IS
  'Per-cleaner payroll rollup. Pay model: revenue share via cleaners.pay_percentage (40/45/50). pay_rate_hr replaced by pay_percentage.';

-- 7. Replace pay-related RPCs to use the new model.

CREATE OR REPLACE FUNCTION public.get_cleaner_scorecard(_cleaner_id UUID)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c RECORD; jobs_completed INT; cancel_count INT; total_assigned INT;
  cancel_rate NUMERIC; months_service NUMERIC; open_flags INT;
BEGIN
  SELECT * INTO c FROM public.cleaners WHERE id = _cleaner_id;
  IF c IS NULL THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO jobs_completed FROM public.job_assignments WHERE cleaner_id = _cleaner_id AND status = 'completed';
  SELECT COUNT(*) INTO total_assigned FROM public.job_assignments WHERE cleaner_id = _cleaner_id;
  SELECT COUNT(*) INTO cancel_count FROM public.job_assignments WHERE cleaner_id = _cleaner_id AND status IN ('declined','withdrawn','cancelled');
  cancel_rate := CASE WHEN total_assigned > 0 THEN ROUND((cancel_count::NUMERIC / total_assigned) * 100, 1) ELSE 0 END;
  months_service := CASE
    WHEN c.start_date IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (now() - c.start_date::TIMESTAMPTZ)) / (60*60*24*30), 1)
    WHEN c.activated_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (now() - c.activated_at)) / (60*60*24*30), 1)
    ELSE NULL END;
  SELECT COUNT(*) INTO open_flags FROM public.cleaner_flags WHERE cleaner_id = _cleaner_id AND resolved = FALSE;
  RETURN jsonb_build_object(
    'cleaner_id', c.id,
    'name', trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),
    'status', c.status,
    'pay_tier', coalesce(c.pay_tier, 'foundation'),
    'pay_percentage', coalesce(c.pay_percentage, 40),
    'pay_rate_hr', NULL,
    'platform_fee_pct', NULL,
    'net_rate_hr', NULL,
    'total_jobs_completed', jobs_completed,
    'total_bookings', coalesce(c.total_bookings, 0),
    'average_rating', c.average_rating, 'total_ratings', c.total_ratings,
    'on_time_rate', c.on_time_rate, 'acceptance_rate', c.acceptance_rate,
    'cancellation_rate_pct', cancel_rate, 'no_show_count', coalesce(c.no_show_count, 0),
    'customer_complaint_count', coalesce(c.customer_complaint_count, 0),
    'months_of_service', months_service, 'workload_score', c.workload_score,
    'weighted_score', c.weighted_score, 'jobs_assigned_last_7d', coalesce(c.jobs_assigned_last_7d, 0),
    'open_flags', open_flags,
    'background_check_status', coalesce(c.background_check_status,'pending'),
    'background_check_expires_at', c.background_check_expires_at,
    'insurance_verified', coalesce(c.insurance_verified, false),
    'insurance_expires_at', c.insurance_expires_at,
    'updated_at', c.updated_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_cleaner_earnings(_cleaner_id UUID, _start DATE, _end DATE)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  daily JSONB; total_jobs INT := 0;
  total_gross_cents BIGINT := 0; total_fee_cents BIGINT := 0; total_net_cents BIGINT := 0;
BEGIN
  WITH per_day AS (
    SELECT
      coalesce(b.service_date, ja.assigned_at::DATE) AS day,
      COUNT(*) AS jobs,
      SUM(coalesce(ja.estimated_pay_cents, 0)) AS gross_cents,
      SUM(GREATEST(
        0,
        coalesce(b.final_charge_cents, b.total_estimate_cents, 0) - coalesce(ja.estimated_pay_cents, 0)
      )) AS fee_cents,
      SUM(coalesce(ja.estimated_pay_cents, 0)) AS net_cents
    FROM public.job_assignments ja
    LEFT JOIN public.jobs j ON j.id = ja.job_id
    LEFT JOIN public.bookings b ON b.job_id = ja.job_id
    WHERE ja.cleaner_id = _cleaner_id
      AND coalesce(b.service_date, ja.assigned_at::DATE) BETWEEN _start AND _end
      AND ja.status IN ('completed','assigned','accepted')
    GROUP BY 1 ORDER BY 1
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'day', day, 'jobs', jobs,
      'gross_cents', gross_cents, 'fee_cents', fee_cents, 'net_cents', net_cents
    )), '[]'::jsonb),
    coalesce(SUM(jobs), 0)::INT, coalesce(SUM(gross_cents), 0)::BIGINT,
    coalesce(SUM(fee_cents), 0)::BIGINT, coalesce(SUM(net_cents), 0)::BIGINT
  INTO daily, total_jobs, total_gross_cents, total_fee_cents, total_net_cents FROM per_day;

  RETURN jsonb_build_object(
    'cleaner_id', _cleaner_id, 'period_start', _start, 'period_end', _end,
    'totals', jsonb_build_object(
      'jobs', total_jobs,
      'gross_cents', total_gross_cents,
      'fee_cents', total_fee_cents,
      'net_cents', total_net_cents
    ),
    'daily', daily
  );
END $$;

DROP FUNCTION IF EXISTS public.cleaner_payroll_report(DATE, DATE);
CREATE FUNCTION public.cleaner_payroll_report(_period_start DATE, _period_end DATE)
RETURNS TABLE (
  cleaner_id UUID,
  cleaner_name TEXT,
  pay_tier TEXT,
  pay_percentage SMALLINT,
  jobs INT,
  total_hours NUMERIC,
  gross_cents BIGINT,
  platform_fee_cents BIGINT,
  net_cents BIGINT,
  by_day JSONB
) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH per_job AS (
    SELECT cl.id AS cleaner_id,
      trim(cl.first_name || ' ' || COALESCE(cl.last_name, '')) AS cleaner_name,
      COALESCE(cl.pay_tier, 'foundation') AS pay_tier,
      COALESCE(cl.pay_percentage, 40)::SMALLINT AS pay_percentage,
      b.service_date AS day,
      COALESCE(ja.estimated_pay_cents, 0) AS estimated_pay_cents,
      GREATEST(0,
        COALESCE(b.final_charge_cents, b.total_estimate_cents, 0)
          - COALESCE(ja.estimated_pay_cents, 0)
      ) AS company_share_cents,
      COALESCE(b.estimated_duration_hours, 0)::NUMERIC AS hours
    FROM public.job_assignments ja
    JOIN public.cleaners cl ON cl.id = ja.cleaner_id
    JOIN public.bookings b ON b.job_id = ja.job_id
    WHERE b.service_date BETWEEN _period_start AND _period_end
      AND ja.status IN ('completed','accepted','assigned','en_route','in_progress')
  )
  SELECT p.cleaner_id,
    MAX(p.cleaner_name) AS cleaner_name,
    MAX(p.pay_tier) AS pay_tier,
    MAX(p.pay_percentage)::SMALLINT AS pay_percentage,
    COUNT(*)::INT AS jobs,
    SUM(p.hours)::NUMERIC AS total_hours,
    SUM(p.estimated_pay_cents)::BIGINT AS gross_cents,
    SUM(p.company_share_cents)::BIGINT AS platform_fee_cents,
    SUM(p.estimated_pay_cents)::BIGINT AS net_cents,
    jsonb_agg(jsonb_build_object(
      'day', p.day, 'hours', p.hours, 'gross_cents', p.estimated_pay_cents
    ) ORDER BY p.day) AS by_day
  FROM per_job p
  GROUP BY p.cleaner_id
  ORDER BY gross_cents DESC NULLS LAST;
$$;

-- 8. Update resolve_or_link_cleaner_for_user to return pay_tier + pay_percentage.
DROP FUNCTION IF EXISTS public.resolve_or_link_cleaner_for_user(text);

CREATE OR REPLACE FUNCTION public.resolve_or_link_cleaner_for_user(p_email text)
RETURNS TABLE (
  id uuid, user_id uuid, first_name text, last_name text, email text, phone text,
  home_zip text, onboarding_complete boolean, approved boolean, status text,
  stripe_account_id text, payouts_enabled boolean, phone_verified boolean,
  pay_tier text, pay_percentage smallint,
  was_linked boolean, was_auto_promoted boolean
)
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.cleaners%ROWTYPE;
  v_was_linked boolean := false;
  v_was_promoted boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT * INTO v_row FROM public.cleaners c WHERE c.user_id = v_uid LIMIT 1;

  IF v_row.id IS NULL AND v_email <> '' THEN
    SELECT * INTO v_row
    FROM public.cleaners c
    WHERE lower(c.email) = v_email AND c.user_id IS NULL
    LIMIT 1;

    IF v_row.id IS NOT NULL THEN
      UPDATE public.cleaners
      SET user_id = v_uid,
          activated_at = coalesce(activated_at, now()),
          updated_at = now()
      WHERE public.cleaners.id = v_row.id
      RETURNING * INTO v_row;
      v_was_linked := true;
    END IF;
  END IF;

  IF v_row.id IS NULL THEN RETURN; END IF;

  IF NOT coalesce(v_row.onboarding_complete, false)
     AND v_row.first_name IS NOT NULL AND v_row.first_name <> ''
     AND v_row.last_name  IS NOT NULL AND v_row.last_name  <> ''
     AND v_row.phone      IS NOT NULL AND v_row.phone      <> ''
     AND v_row.home_zip   IS NOT NULL AND v_row.home_zip   <> '' THEN
    UPDATE public.cleaners
    SET onboarding_complete = true,
        activated_at = coalesce(activated_at, now()),
        updated_at = now()
    WHERE public.cleaners.id = v_row.id
    RETURNING * INTO v_row;
    v_was_promoted := true;
  END IF;

  RETURN QUERY
    SELECT v_row.id, v_row.user_id, v_row.first_name, v_row.last_name,
           v_row.email, v_row.phone, v_row.home_zip,
           v_row.onboarding_complete, v_row.approved, v_row.status,
           v_row.stripe_account_id, v_row.payouts_enabled, v_row.phone_verified,
           coalesce(v_row.pay_tier, 'foundation') AS pay_tier,
           coalesce(v_row.pay_percentage, 40)::smallint AS pay_percentage,
           v_was_linked, v_was_promoted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_or_link_cleaner_for_user(text) TO authenticated;
COMMENT ON FUNCTION public.resolve_or_link_cleaner_for_user(text) IS
  'Resolve auth.user to cleaners row, auto-link by email, auto-promote onboarding_complete. Returns pay_tier + pay_percentage under the revenue-share model.';
