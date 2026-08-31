-- ─── Membership sign-then-pay hosted page ────────────────────────────────
-- Mirrors the one-time booking pay page (/pay/<token>): the customer opens a
-- tokenized hosted page, reviews + e-signs the Membership / Recurring Service
-- Agreement, and ONLY then is the Stripe subscription payment link revealed.
--
-- These columns hang the pay page + its gate off the recurring schedule:
--   • pay_token           — the credential in the /membership-pay/<token> URL
--   • pay_url             — the held Stripe subscription Checkout URL, revealed
--                           only after the agreement is signed
--   • agreement_signed_at — set by membership-pay-page once the customer signs;
--                           the gate that unlocks pay_url

alter table public.customer_recurring_schedules
  add column if not exists pay_token text,
  add column if not exists pay_url text,
  add column if not exists agreement_signed_at timestamptz;

create unique index if not exists crs_pay_token_idx
  on public.customer_recurring_schedules (pay_token)
  where pay_token is not null;
