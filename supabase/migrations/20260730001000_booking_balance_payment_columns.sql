-- ─── Balance payment tracking columns ───────────────────────────────────────
--
-- The final-balance page needs somewhere to record the charge it collects, and
-- `complete-booking` already reads these names when it captures a pre-auth
-- hold — but the columns were never actually added to this project, so any
-- SELECT naming them failed and took the whole query with it.
--
-- Additive and nullable: existing rows simply have no balance charge recorded.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS balance_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS balance_amount_cents integer;

COMMENT ON COLUMN public.bookings.balance_payment_intent_id IS
  'Stripe PaymentIntent for the remaining balance — set by the final-balance page (/pay-balance) or by complete-booking when it captures the pre-auth hold.';
COMMENT ON COLUMN public.bookings.balance_amount_cents IS
  'Amount actually collected for the remaining balance, in cents.';

NOTIFY pgrst, 'reload schema';
