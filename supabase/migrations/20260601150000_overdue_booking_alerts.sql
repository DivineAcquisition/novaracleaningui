-- Track overdue "not marked complete" staff/cleaner alerts (idempotent).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS overdue_completion_alert_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.bookings.overdue_completion_alert_sent_at IS
  'When we sent the past-service-date incomplete alert to staff + cleaner SMS.';

CREATE INDEX IF NOT EXISTS idx_bookings_overdue_completion_pending
  ON public.bookings (service_date)
  WHERE overdue_completion_alert_sent_at IS NULL
    AND cleaner_id IS NOT NULL
    AND status IS DISTINCT FROM 'completed'
    AND status IS DISTINCT FROM 'cancelled';

NOTIFY pgrst, 'reload schema';
