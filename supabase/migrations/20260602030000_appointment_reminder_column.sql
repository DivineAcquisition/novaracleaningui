-- Pre-service appointment reminder idempotency stamp.
-- send-appointment-reminders texts confirmed bookings the day before
-- service; this column ensures the daily cron never double-texts.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS appointment_reminder_sent_at timestamptz;
