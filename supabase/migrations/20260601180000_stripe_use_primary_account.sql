-- Stripe account alignment (May 2026)
--
-- Production customer charges (deposits, saved cards) live on the
-- NovaraCleaning live account acct_1SX5ZV2YP5iHN3Rz (sk_live_51SX5ZV…).
--
-- app_secrets had been overriding STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY
-- with keys for a different Stripe account (sk_live_51S6bj2…), which caused:
--   • off-session balance charges failing ("No such customer")
--   • remaining-balance invoices on the wrong account
--
-- Ops: keep STRIPE_* out of app_secrets unless intentionally overriding.
-- Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in Supabase Edge Function
-- secrets to the acct_1SX5ZV… live keys (rotate if expired).

COMMENT ON TABLE public.app_secrets IS
  'Optional DB overrides for edge secrets. STRIPE_* keys must match acct_1SX5ZV when customers have cards on file.';
