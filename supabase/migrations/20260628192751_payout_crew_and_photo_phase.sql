-- ─── Multi-cleaner custom payouts + phased photo links ─────────────────────
--
-- 1) manual_payouts.cleaner_breakdown: per-cleaner pay for a job's whole crew.
--    The row stays one-per-booking (so revenue/profit aggregate once) while the
--    JSON carries [{ cleanerId, cleanerName, amountCents }] for the roster +
--    per-cleaner notifications. amount_cents holds the TOTAL paid to the crew.
--
-- 2) bookings.before_photo_link_sent_at / after_photo_link_sent_at: idempotency
--    stamps so the "submit BEFORE photos" link (sent before the job) and the
--    "submit AFTER photos" link (sent after completion) each fire once.

ALTER TABLE public.manual_payouts
  ADD COLUMN IF NOT EXISTS cleaner_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS before_photo_link_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS after_photo_link_sent_at  timestamptz;

NOTIFY pgrst, 'reload schema';
