-- Booking confirmation now requires BOTH:
--   1. Payment cleared
--   2. Home-detail questionnaire (address / city / state / bedrooms /
--      bathrooms / dwelling_type) answered on /book/details
--
-- This migration adds the timestamps that finalize-booking + stripe-
-- webhook use to track each gate independently. Status text gains a new
-- 'pending_details' value (payment cleared but home details missing).
-- We don't enforce the status via a CHECK constraint to stay backwards
-- compatible with the existing free-form status column.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS details_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS details_reminder_count   integer NOT NULL DEFAULT 0;

-- Make admin / queue lookups for "paid but waiting on details" cheap.
CREATE INDEX IF NOT EXISTS bookings_pending_details_idx
  ON public.bookings (status, payment_received_at)
  WHERE status = 'pending_details';
