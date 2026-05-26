-- Pre-authorized completion hold flow.
--
-- Booking captures the 50% deposit immediately (unchanged) and SAVES
-- the card. A new pg_cron job ('prepare-completion-hold') then places
-- a manual-capture (auth-only) PaymentIntent on the saved card for the
-- remaining balance ~5 days before service. The hold lives up to 7
-- days under Visa/MC rules, so capturing on completion day is well
-- inside the auth window. If the auth fails 3 times across 3 days the
-- booking is auto-cancelled, the deposit is refunded, and the customer
-- gets a final SMS + email.
--
-- The columns added to public.bookings track the entire hold lifecycle
-- so admin tooling can audit / replay.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS completion_hold_pi_id              text,
  ADD COLUMN IF NOT EXISTS completion_hold_amount_cents       integer,
  -- pending_retry | authorized | failed | captured | voided | expired
  ADD COLUMN IF NOT EXISTS completion_hold_status             text,
  ADD COLUMN IF NOT EXISTS completion_hold_attempts           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_hold_last_attempt_at    timestamptz,
  ADD COLUMN IF NOT EXISTS completion_hold_next_attempt_at    timestamptz,
  ADD COLUMN IF NOT EXISTS completion_hold_authorized_at      timestamptz,
  ADD COLUMN IF NOT EXISTS completion_hold_auth_expires_at    timestamptz,
  ADD COLUMN IF NOT EXISTS completion_hold_last_error         text,
  ADD COLUMN IF NOT EXISTS completion_hold_last_error_code    text,
  ADD COLUMN IF NOT EXISTS completion_hold_captured_at        timestamptz,
  ADD COLUMN IF NOT EXISTS completion_hold_captured_amount    integer,
  ADD COLUMN IF NOT EXISTS auto_cancelled_reason              text;

-- Partial index — speeds up the cron's candidate query without bloating
-- the table for the 99% of rows that aren't currently in the hold window.
CREATE INDEX IF NOT EXISTS bookings_pending_completion_hold_idx
  ON public.bookings (service_date, completion_hold_status, completion_hold_next_attempt_at)
  WHERE status = 'confirmed'
    AND COALESCE(uses_credit, false) = false
    AND completion_hold_status IS DISTINCT FROM 'authorized'
    AND completion_hold_status IS DISTINCT FROM 'captured';

-- Audit log: every place / capture / void / failure decision the
-- prepare-completion-hold worker makes lands here so ops can replay
-- exactly what Stripe did and when.
CREATE TABLE IF NOT EXISTS public.completion_hold_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL,
  attempt      integer NOT NULL,
  -- 'authorized' | 'auth_failed' | 'captured' | 'voided' | 'cancelled_booking' | 'skipped'
  outcome           text NOT NULL,
  payment_intent_id text,
  amount_cents      integer,
  stripe_error_code text,
  stripe_error_message text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS completion_hold_log_booking_idx
  ON public.completion_hold_log (booking_id, created_at DESC);
