-- ─── Custom pay page token ──────────────────────────────────────────────────
--
-- Internal (VA/admin-created) bookings now send customers to our own
-- try.novaracleaning.com/pay/<token> page instead of a raw Stripe Checkout
-- link. The page enforces the legal step (One-Time Service Agreement, ToS,
-- Disclaimer + signature) BEFORE the deposit payment form unlocks, then
-- charges the deposit and saves the card off-session so the existing
-- prepare-completion-hold pre-auth flow works unchanged.
--
-- The token is the credential (same pattern as photo_upload_token /
-- photo_view_token): unguessable, revocable by nulling the column.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pay_page_token text;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_pay_page_token_uniq
  ON public.bookings (pay_page_token)
  WHERE pay_page_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
