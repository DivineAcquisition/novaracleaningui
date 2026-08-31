-- Required by create-payment-intent (public booking Stripe checkout).
-- These columns were defined in local migrations that never landed on this project:
--   20260728200000_schedule_buffer_projections.sql (condition_level)
--   20260729120000_backup_coverage_no_show.sql (hard_deadline_at)
-- Without them, booking inserts fail and Checkout shows "Load failed".

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS condition_level text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_condition_level_check'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_condition_level_check
      CHECK (condition_level IS NULL OR condition_level IN ('light','normal','heavy','severe'));
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.condition_level IS
  'Assessed property condition (light|normal|heavy|severe). Used by focused cleans and duration projections.';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS hard_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS running_late_eta_at timestamptz;

COMMENT ON COLUMN public.bookings.hard_deadline_at IS
  'Immovable finish deadline (STR guest check-in, same-day sourcing cutoff, event start).';
COMMENT ON COLUMN public.bookings.running_late_eta_at IS
  'ETA the assigned cleaner gave when running late.';
