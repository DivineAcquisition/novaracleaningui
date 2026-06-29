-- ─── Custom payouts: record real Stripe transfers ──────────────────────────
-- The "Custom Payout" module previously only logged an amount and flipped a
-- status flag — no money moved. "Pay via Stripe" now fires an exact-amount
-- Stripe Connect transfer per cleaner; store the resulting transfer id(s) here
-- so a payout is auditable and re-paying is a no-op.

ALTER TABLE public.manual_payouts
  ADD COLUMN IF NOT EXISTS transfer_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
