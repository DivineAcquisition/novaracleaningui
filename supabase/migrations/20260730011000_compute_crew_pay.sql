-- ─── compute_crew_pay: the one place crew pay is calculated ─────────────────
--
-- Pay was previously computed in ~10 places (dispatch-job, complete-booking,
-- scope-adjustment, addon approval, payroll-operations, the portal, plus three
-- duplicated TS/Deno constant tables). Every one of them had to independently
-- know the rate rule. Adding crew-size brackets to ten copies is how a cleaner
-- ends up seeing one number in the portal and being paid another.
--
-- So there is now a single authoritative function. Callers hand it the job value
-- and the crew that PERFORMED the job; it returns each cleaner's tier, the rate
-- that applies at that crew size, and their share. Callers never do the
-- arithmetic themselves.
--
-- It also refuses to return a result that breaks the pool invariant, so a bad
-- configuration surfaces as a loud error at the point of calculation rather than
-- as an overpayment discovered later.

CREATE OR REPLACE FUNCTION public.compute_crew_pay(
  p_job_value_cents bigint,
  p_cleaner_ids uuid[]
)
RETURNS TABLE (
  cleaner_id uuid,
  pay_tier text,
  crew_size integer,
  rate_percent numeric,
  share_cents bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_crew_size integer;
  v_total bigint;
  v_ceiling numeric;
BEGIN
  -- Distinct, non-null: the same cleaner listed twice would shrink everyone's
  -- share and inflate the crew size.
  SELECT count(*) INTO v_crew_size
  FROM (SELECT DISTINCT unnest(coalesce(p_cleaner_ids, '{}'::uuid[])) AS id) s
  WHERE s.id IS NOT NULL;

  IF v_crew_size = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH crew AS (
    SELECT DISTINCT c.id,
           lower(coalesce(c.pay_tier, 'foundation')) AS tier
    FROM public.cleaners c
    WHERE c.id = ANY (p_cleaner_ids)
  )
  SELECT crew.id,
         crew.tier,
         v_crew_size,
         public.cleaner_pay_rate_percent(crew.tier, v_crew_size),
         public.cleaner_share_cents(p_job_value_cents, crew.tier, v_crew_size)
  FROM crew;

  -- Hard guard. By construction each share is (own rate / n) and the ceiling is
  -- the top configured rate, so this cannot trip — which is exactly why it is
  -- worth asserting: the day it does trip, something upstream is broken and the
  -- consequence is paying out more than the job earned.
  SELECT coalesce(sum(public.cleaner_share_cents(p_job_value_cents, t.tier, v_crew_size)), 0)
    INTO v_total
  FROM (
    SELECT DISTINCT lower(coalesce(c.pay_tier, 'foundation')) AS tier, c.id
    FROM public.cleaners c WHERE c.id = ANY (p_cleaner_ids)
  ) t;

  IF NOT public.crew_pay_within_pool(p_job_value_cents, v_crew_size, v_total) THEN
    v_ceiling := public.max_cleaner_pay_rate_percent(v_crew_size);
    RAISE EXCEPTION
      'crew pay % cents exceeds the configured pool ceiling (%%% of % cents) for a crew of %',
      v_total, v_ceiling, p_job_value_cents, v_crew_size
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.compute_crew_pay(bigint, uuid[]) IS
  'THE authoritative crew pay calculation. Give it the final job value and the cleaners who PERFORMED the job; it returns each cleaner''s tier, the rate for that crew size, and their share. Never duplicate this arithmetic in application code.';

GRANT EXECUTE ON FUNCTION public.compute_crew_pay(bigint, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleaner_pay_rate_percent(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleaner_share_cents(bigint, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.max_cleaner_pay_rate_percent(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crew_pay_within_pool(bigint, integer, bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
