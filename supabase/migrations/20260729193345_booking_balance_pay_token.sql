-- ─── Tokenized final-balance page ───────────────────────────────────────────
--
-- The deposit pay page (bookings.pay_page_token → /pay/<token>) collects money
-- BEFORE the clean. This is its counterpart for AFTER: the customer opens a
-- link and sees what was actually done — the add-ons performed, any scope
-- adjustment, what the deposit already covered — and pays the remaining
-- balance from that same page.
--
-- Same trust model as every other one-tap customer link here (pay page, photo
-- gallery, manage-recurring): the unguessable token IS the credential, it is
-- scoped to a single booking, and revoking it is `set balance_pay_token = null`.
--
-- Deliberately a SEPARATE column from pay_page_token. They can both be live on
-- one booking (deposit collected up front, balance collected after), they are
-- issued at different moments by different people, and killing one must not
-- kill the other.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS balance_pay_token text,
  ADD COLUMN IF NOT EXISTS balance_pay_token_created_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_balance_pay_token_uniq
  ON public.bookings (balance_pay_token)
  WHERE balance_pay_token IS NOT NULL;

COMMENT ON COLUMN public.bookings.balance_pay_token IS
  'Single-booking credential for the public final-balance page (/pay-balance/<token>). Shows the completed-work breakdown and collects the remaining balance. NULL = no outstanding balance link.';

NOTIFY pgrst, 'reload schema';
