-- Track when we send the post-completion "rate your cleaner" SMS so the
-- cron sweep is idempotent and we don't spam customers.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rating_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.bookings.rating_reminder_sent_at IS
  'When the 2-hour post-completion cleaner rating SMS was sent (null = not yet).';

CREATE INDEX IF NOT EXISTS idx_bookings_rating_reminder_pending
  ON public.bookings (completed_at)
  WHERE status = 'completed'
    AND rating_submitted IS NOT TRUE
    AND rating_reminder_sent_at IS NULL
    AND phone IS NOT NULL
    AND cleaner_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
