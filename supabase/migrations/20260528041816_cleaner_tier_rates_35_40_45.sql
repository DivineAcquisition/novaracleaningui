-- ─── Tier rate adjustment: 40/45/50 → 35/40/45 ──────────────────────
--
-- Drops the prior CHECK constraint, rewrites the tier→pct trigger, then
-- re-stamps every existing cleaner so pay_percentage matches the new
-- table. New tier mapping:
--   foundation → 35
--   proven     → 40
--   elite      → 45
--
-- Future bookings + open job_assignments are recomputed using the new
-- Foundation default (35%). Past completed bookings/payouts are NOT
-- touched per the rev-share spec.

ALTER TABLE public.cleaners
  DROP CONSTRAINT IF EXISTS cleaners_pay_percentage_chk;

UPDATE public.cleaners
SET pay_percentage = CASE
  WHEN lower(coalesce(pay_tier, 'foundation')) = 'elite' THEN 45
  WHEN lower(coalesce(pay_tier, 'foundation')) = 'proven' THEN 40
  ELSE 35
END;

ALTER TABLE public.cleaners
  ADD CONSTRAINT cleaners_pay_percentage_chk
  CHECK (pay_percentage IN (35, 40, 45));

ALTER TABLE public.cleaners
  ALTER COLUMN pay_percentage SET DEFAULT 35;

COMMENT ON COLUMN public.cleaners.pay_percentage IS
  'Cleaner revenue share %: 35 (Foundation), 40 (Proven), 45 (Elite). Replaces the legacy pay_rate_hr / platform_fee_pct hourly model.';

-- Sync trigger writes the new percentages whenever pay_tier changes.
CREATE OR REPLACE FUNCTION public.cleaners_sync_pay_percentage()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.pay_tier IS DISTINCT FROM OLD.pay_tier THEN
    NEW.pay_percentage := CASE
      WHEN lower(coalesce(NEW.pay_tier, 'foundation')) = 'elite' THEN 45
      WHEN lower(coalesce(NEW.pay_tier, 'foundation')) = 'proven' THEN 40
      ELSE 35
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Helper RPCs default to the new Foundation 35%.
CREATE OR REPLACE FUNCTION public.compute_cleaner_payout_cents(
  _revenue_cents bigint, _pay_percentage smallint, _cleaner_count int
) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(
    0,
    (COALESCE(_revenue_cents, 0) * COALESCE(_pay_percentage, 35)) / 100
  ) / GREATEST(COALESCE(_cleaner_count, 1), 1);
$$;

CREATE OR REPLACE FUNCTION public.max_pay_percentage_for_cleaners(_cleaner_ids uuid[])
RETURNS smallint LANGUAGE sql STABLE AS $$
  SELECT COALESCE(MAX(pay_percentage), 35)::smallint
  FROM public.cleaners
  WHERE id = ANY(_cleaner_ids);
$$;

-- Future bookings: recompute cleaner_payout_cents at the new Foundation
-- default (35%) when no cleaner is assigned, or the assigned cleaner's
-- actual pay_percentage when one is.
WITH future_bookings AS (
  SELECT b.id, b.cleaner_id,
         coalesce(c.pay_percentage, 35) AS pay_pct,
         coalesce(b.final_charge_cents, b.total_estimate_cents, 0) AS revenue_cents
  FROM public.bookings b
  LEFT JOIN public.cleaners c ON c.id = b.cleaner_id
  WHERE b.status NOT IN ('completed','cancelled','refunded')
    AND b.service_date IS NOT NULL
    AND b.service_date >= CURRENT_DATE
)
UPDATE public.bookings b
SET cleaner_payout_cents = floor(fb.revenue_cents * fb.pay_pct / 100),
    platform_fee_cents = greatest(0, fb.revenue_cents - floor(fb.revenue_cents * fb.pay_pct / 100))
FROM future_bookings fb
WHERE b.id = fb.id;

-- Future job_assignments: recompute estimated_pay_cents using new
-- max-tier-on-team % and snapshot the value.
WITH future_assignments AS (
  SELECT ja.id, ja.cleaner_id, ja.job_id,
         (SELECT max(coalesce(cl2.pay_percentage, 35))
          FROM public.job_assignments ja2
          JOIN public.cleaners cl2 ON cl2.id = ja2.cleaner_id
          WHERE ja2.job_id = ja.job_id
            AND ja2.status NOT IN ('declined','withdrawn','cancelled')
         ) AS team_max_pct,
         (SELECT count(*) FROM public.job_assignments ja2
          WHERE ja2.job_id = ja.job_id
            AND ja2.status NOT IN ('declined','withdrawn','cancelled')
         ) AS team_count,
         coalesce(b.final_charge_cents, b.total_estimate_cents, 0) AS revenue_cents,
         b.service_date
  FROM public.job_assignments ja
  LEFT JOIN public.bookings b ON b.job_id = ja.job_id
  WHERE ja.status NOT IN ('declined','withdrawn','cancelled','completed')
    AND b.service_date IS NOT NULL
    AND b.service_date >= CURRENT_DATE
)
UPDATE public.job_assignments ja
SET estimated_pay_cents = floor(fa.revenue_cents * coalesce(fa.team_max_pct, 35) / 100 / greatest(fa.team_count, 1)),
    pay_percentage_snapshot = coalesce(fa.team_max_pct, 35)
FROM future_assignments fa
WHERE ja.id = fa.id;
