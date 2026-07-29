-- ─── Dynamic crew-size payout rates ────────────────────────────────────────
--
-- Two cleaners do not halve a job's time — realistically they take ~60% of solo
-- time, so total labour hours RISE while a fixed pay pool splits two ways. At a
-- flat rate a crew member earns 15–17% less per hour than a solo cleaner for the
-- same work. Raising the pool rate for crew jobs closes that to 5–7%.
--
-- So the rate now depends on HOW MANY cleaners worked the job:
--
--            solo (1)   crew (2+)
--   Foundation   35%        40%
--   Proven       40%        45%
--   Elite        45%        50%
--
-- Modelled as (crew-size bracket → tier → rate) rather than two columns, so a
-- distinct 3+ bracket can be added later by INSERTing rows — no code change.
--
-- ── The percentage is a POOL, not per person ──────────────────────────────
-- The crew rate is the total share of job value paid to the WHOLE crew, then
-- divided among them. 2 Proven cleaners on a $205 job = 45% total = $92.25,
-- i.e. $46.12 each — NOT 45% each.
--
-- ── Mixed-tier crews ─────────────────────────────────────────────────────
-- Each cleaner earns THEIR OWN tier's crew-size rate ÷ crew size. This is a
-- deliberate change from the previous "highest tier on the job wins for
-- everyone" rule: an all-Foundation crew now costs 40%, an all-Elite crew 50%,
-- and mixed crews land in between. Company cost varying with crew composition
-- is intended — more experienced crews cost more because they are worth more.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ─── Configuration ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_pay_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Inclusive crew-size bracket. max_crew_size NULL = open-ended ("and above").
  min_crew_size integer NOT NULL,
  max_crew_size integer,
  pay_tier text NOT NULL,
  rate_percent numeric(5,2) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,

  CONSTRAINT cleaner_pay_rates_min_chk CHECK (min_crew_size >= 1),
  CONSTRAINT cleaner_pay_rates_max_chk
    CHECK (max_crew_size IS NULL OR max_crew_size >= min_crew_size),
  -- A rate above 100% would pay out more than the job earned. A rate of 0 is
  -- allowed (it is a legitimate, if unkind, configuration).
  CONSTRAINT cleaner_pay_rates_rate_chk CHECK (rate_percent >= 0 AND rate_percent <= 100),
  CONSTRAINT cleaner_pay_rates_tier_chk CHECK (pay_tier = lower(pay_tier) AND length(pay_tier) > 0)
);

-- Overlapping brackets for one tier would make the rate ambiguous, and an
-- ambiguous pay rate is a dispute waiting to happen. The database refuses them
-- outright rather than letting resolution order decide silently.
ALTER TABLE public.cleaner_pay_rates
  DROP CONSTRAINT IF EXISTS cleaner_pay_rates_no_overlap;
ALTER TABLE public.cleaner_pay_rates
  ADD CONSTRAINT cleaner_pay_rates_no_overlap
  EXCLUDE USING gist (
    pay_tier WITH =,
    int4range(min_crew_size, COALESCE(max_crew_size, 2147483646), '[]') WITH &&
  );

COMMENT ON TABLE public.cleaner_pay_rates IS
  'Crew-size bracket -> tier -> pay rate. The rate is the share of final job value paid to the ENTIRE crew, then divided among them. Add a new bracket (e.g. 3+) by inserting rows; no code change required.';
COMMENT ON COLUMN public.cleaner_pay_rates.max_crew_size IS
  'Inclusive upper bound of the bracket. NULL means open-ended ("and above").';

-- Seed the table above. ON CONFLICT DO NOTHING so re-running is safe.
INSERT INTO public.cleaner_pay_rates (min_crew_size, max_crew_size, pay_tier, rate_percent, note)
VALUES
  (1, 1,    'foundation', 35, 'Solo'),
  (1, 1,    'proven',     40, 'Solo'),
  (1, 1,    'elite',      45, 'Solo'),
  (2, NULL, 'foundation', 40, 'Crew of 2+'),
  (2, NULL, 'proven',     45, 'Crew of 2+'),
  (2, NULL, 'elite',      50, 'Crew of 2+')
ON CONFLICT DO NOTHING;

ALTER TABLE public.cleaner_pay_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleaner_pay_rates_read ON public.cleaner_pay_rates;
CREATE POLICY cleaner_pay_rates_read ON public.cleaner_pay_rates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cleaner_pay_rates_admin_write ON public.cleaner_pay_rates;
CREATE POLICY cleaner_pay_rates_admin_write ON public.cleaner_pay_rates
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS cleaner_pay_rates_service ON public.cleaner_pay_rates;
CREATE POLICY cleaner_pay_rates_service ON public.cleaner_pay_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Rate resolution ───────────────────────────────────────────────────────
/**
 * The rate for one cleaner, given their tier and the size of the crew that
 * performed the job.
 *
 * Total (never returns NULL): an unconfigured combination falls back to the
 * solo bracket for that tier, then to the lowest configured rate. A missing row
 * must degrade to under-paying-by-config, never to a NULL that silently becomes
 * zero pay somewhere downstream.
 */
CREATE OR REPLACE FUNCTION public.cleaner_pay_rate_percent(
  p_pay_tier text,
  p_crew_size integer
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tier AS (SELECT lower(coalesce(p_pay_tier, 'foundation')) AS t),
       size AS (SELECT GREATEST(1, coalesce(p_crew_size, 1)) AS n)
  SELECT coalesce(
    -- exact bracket for this crew size
    (SELECT r.rate_percent FROM public.cleaner_pay_rates r, tier, size
      WHERE r.pay_tier = tier.t
        AND size.n >= r.min_crew_size
        AND (r.max_crew_size IS NULL OR size.n <= r.max_crew_size)
      ORDER BY r.min_crew_size DESC LIMIT 1),
    -- fall back to the solo bracket for the tier
    (SELECT r.rate_percent FROM public.cleaner_pay_rates r, tier
      WHERE r.pay_tier = tier.t AND r.min_crew_size <= 1
        AND (r.max_crew_size IS NULL OR r.max_crew_size >= 1)
      ORDER BY r.min_crew_size DESC LIMIT 1),
    -- last resort: the most conservative rate we have configured
    (SELECT min(r.rate_percent) FROM public.cleaner_pay_rates r),
    0
  );
$$;

COMMENT ON FUNCTION public.cleaner_pay_rate_percent(text, integer) IS
  'Pay rate for one cleaner given their tier and the size of the crew that PERFORMED the job. This rate is a share of the whole-crew pool, not a per-person entitlement.';

/**
 * The highest rate configured for a crew size — the ceiling total crew pay may
 * never exceed. Used by the hard validation below.
 */
CREATE OR REPLACE FUNCTION public.max_cleaner_pay_rate_percent(p_crew_size integer)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(max(r.rate_percent), 0)
  FROM public.cleaner_pay_rates r
  WHERE GREATEST(1, coalesce(p_crew_size, 1)) >= r.min_crew_size
    AND (r.max_crew_size IS NULL
         OR GREATEST(1, coalesce(p_crew_size, 1)) <= r.max_crew_size);
$$;

/**
 * One cleaner's share, in whole cents:
 *
 *   (their crew-size rate ÷ crew size) × final job value
 *
 * Floored, so rounding can only ever under-pay by sub-cent amounts and the sum
 * of shares can never drift above the configured pool.
 */
CREATE OR REPLACE FUNCTION public.cleaner_share_cents(
  p_job_value_cents bigint,
  p_pay_tier text,
  p_crew_size integer
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(0, floor(
    (GREATEST(0, coalesce(p_job_value_cents, 0))
      * public.cleaner_pay_rate_percent(p_pay_tier, p_crew_size)
      / 100.0)
    / GREATEST(1, coalesce(p_crew_size, 1))
  )::bigint);
$$;

COMMENT ON FUNCTION public.cleaner_share_cents(bigint, text, integer) IS
  'One cleaner''s pay in cents: (their crew-size rate / crew size) * job value. Summing this across the performing crew yields the pool actually owed, which is why an all-Foundation crew costs less than an all-Elite one.';

/**
 * The invariant, enforced rather than assumed.
 *
 * Total crew pay may never exceed the highest rate configured for that crew
 * size applied to the job value. By construction it cannot — every share is
 * (own rate / n) and the top rate is the max — but "by construction" is exactly
 * the kind of reasoning that stops being true after a refactor, and the failure
 * mode here is paying out more than the job earned.
 */
CREATE OR REPLACE FUNCTION public.crew_pay_within_pool(
  p_job_value_cents bigint,
  p_crew_size integer,
  p_total_pay_cents bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(p_total_pay_cents, 0) <= ceil(
    GREATEST(0, coalesce(p_job_value_cents, 0))
    * public.max_cleaner_pay_rate_percent(p_crew_size) / 100.0
  )::bigint;
$$;

COMMENT ON FUNCTION public.crew_pay_within_pool(bigint, integer, bigint) IS
  'Hard guard: total pay across the performing crew must never exceed the highest configured rate for that crew size. Any implementation that trips this is broken.';

-- ─── Snapshots so a figure can always be reconstructed ─────────────────────
-- pay_percentage_snapshot already records the rate applied. Crew size is the
-- other half of the calculation, and without it a cleaner cannot check their
-- own historical pay.
ALTER TABLE public.job_assignments
  ADD COLUMN IF NOT EXISTS crew_size_snapshot integer,
  ADD COLUMN IF NOT EXISTS pay_locked_at timestamptz;

COMMENT ON COLUMN public.job_assignments.crew_size_snapshot IS
  'Size of the crew that PERFORMED the job, as used to compute this assignment''s pay. With pay_percentage_snapshot this makes the figure reproducible.';
COMMENT ON COLUMN public.job_assignments.pay_locked_at IS
  'Set when the job completes and the performing crew is final. Later crew edits require an explicit admin action and are logged to cleaner_pay_recalcs.';

-- ─── Audit trail for post-lock recalculations ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_pay_recalcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  reason text NOT NULL,
  performed_by uuid,
  crew_size_before integer,
  crew_size_after integer,
  rate_before numeric(5,2),
  rate_after numeric(5,2),
  pay_before_cents bigint,
  pay_after_cents bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_pay_recalcs_reason_chk CHECK (length(btrim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS cleaner_pay_recalcs_job_idx
  ON public.cleaner_pay_recalcs (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cleaner_pay_recalcs_cleaner_idx
  ON public.cleaner_pay_recalcs (cleaner_id, created_at DESC);

COMMENT ON TABLE public.cleaner_pay_recalcs IS
  'Every recalculation of locked cleaner pay: who did it, why, and what changed. Pay locks at completion; anything after that has to leave a trail.';

ALTER TABLE public.cleaner_pay_recalcs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleaner_pay_recalcs_admin ON public.cleaner_pay_recalcs;
CREATE POLICY cleaner_pay_recalcs_admin ON public.cleaner_pay_recalcs
  FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS cleaner_pay_recalcs_service ON public.cleaner_pay_recalcs
;
CREATE POLICY cleaner_pay_recalcs_service ON public.cleaner_pay_recalcs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.cleaner_pay_rates TO authenticated, service_role;
GRANT SELECT ON public.cleaner_pay_recalcs TO authenticated, service_role;
REVOKE ALL ON public.cleaner_pay_rates FROM anon;
REVOKE ALL ON public.cleaner_pay_recalcs FROM anon;

NOTIFY pgrst, 'reload schema';
