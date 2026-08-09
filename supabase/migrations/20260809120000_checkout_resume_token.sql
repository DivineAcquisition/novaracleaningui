-- Tokenized public-checkout resume links for abandoned pending_payment bookings.
-- Used by send-booking-reminder SMS/email so the customer can continue where
-- they left off on any device (not just the original browser session).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checkout_resume_token text;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_checkout_resume_token_uniq
  ON public.bookings (checkout_resume_token)
  WHERE checkout_resume_token IS NOT NULL;

COMMENT ON COLUMN public.bookings.checkout_resume_token IS
  'Unguessable token for /book/checkout?resume_token=… resume links. Minted at create-payment-intent for public funnel pending_payment rows.';

NOTIFY pgrst, 'reload schema';
