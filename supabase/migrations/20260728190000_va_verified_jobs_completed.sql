-- ─── Verified column for the new "Jobs completed" metric ─────────────────────
--
-- The v2 form added "Jobs completed" to the metrics block and to the
-- Client & Revenue Ops collector, but the verified-metrics table never gained
-- the column to store it — so the whole sync failed on the first write.
--
-- Attribution deliberately doesn't apply here: a job is finished by the
-- cleaner, not by whoever booked it, so this is the company-wide count for the
-- day, which is exactly what the VA is reporting when they answer the field.

ALTER TABLE public.va_verified_metrics
  ADD COLUMN IF NOT EXISTS jobs_completed integer;

COMMENT ON COLUMN public.va_verified_metrics.jobs_completed IS
  'Bookings marked completed on this date, company-wide. NULL means unverified, never a real zero.';

NOTIFY pgrst, 'reload schema';
