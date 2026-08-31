-- ─── Customer credits ledger + post-booking GHL SMS plumbing ────────────
-- Adds:
--   * public.customer_credits     dollar-value spendable credit ledger
--                                  (sources: referral, admin_grant,
--                                  promo, refund_credit, perk)
--   * bookings.referral_code      canonical attribution column (replaces
--                                  the nonexistent metadata path)
--   * bookings.post_confirm_ghl_sms_sent[_at]  idempotency flag for the
--                                  new post-booking GHL SMS
--   * bookings.applied_credit_cents  wallet credit reserved at checkout
--   * RPC get_customer_credit_balance(_customer_id)
--   * RPC grant_customer_credit(...)       called by admin-grant-credit
--   * RPC apply_customer_credit_to_booking(...)  atomic spend at checkout
--
-- Plus DB triggers that make the whole flow deploy-independent:
--   * bookings_auto_send_post_booking_sms     status → confirmed →
--     pg_net invokes send-post-booking-sms
--   * bookings_auto_apply_wallet_credit       status → confirmed AND
--     applied_credit_cents > 0 → apply_customer_credit_to_booking
--   * bookings_auto_grant_referral_reward     status → completed AND
--     referral_code IS NOT NULL → grant_customer_credit on referrer

CREATE TABLE IF NOT EXISTS public.customer_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  email TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents != 0),
  source TEXT NOT NULL CHECK (source IN ('referral','admin_grant','promo','refund_credit','perk','adjustment')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','applied','expired','revoked')),
  reason TEXT,
  referral_id UUID REFERENCES public.referrals(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  granted_by UUID,
  applied_at TIMESTAMPTZ,
  applied_to_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_credits_customer_status_idx ON public.customer_credits (customer_id, status);
CREATE INDEX IF NOT EXISTS customer_credits_email_status_idx ON public.customer_credits (email, status);
CREATE INDEX IF NOT EXISTS customer_credits_source_idx ON public.customer_credits (source, created_at DESC);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS post_confirm_ghl_sms_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS post_confirm_ghl_sms_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_credit_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS bookings_referral_code_idx ON public.bookings (referral_code);

-- The full DDL for the 3 RPCs (get_customer_credit_balance,
-- grant_customer_credit, apply_customer_credit_to_booking) and the 3
-- AFTER UPDATE triggers (auto_send_post_booking_sms,
-- auto_apply_wallet_credit_on_confirm, auto_grant_referral_reward_on_complete)
-- was applied via the Supabase MCP apply_migration calls on 2026-05-21:
--   - customer_credits_ledger_and_post_booking_sms
--   - auto_send_post_booking_sms_trigger
--   - auto_credit_deduction_and_referral_reward_triggers
-- Inspect with:
--   SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE proname IN (
--     'get_customer_credit_balance','grant_customer_credit',
--     'apply_customer_credit_to_booking','auto_send_post_booking_sms',
--     'auto_apply_wallet_credit_on_confirm','auto_grant_referral_reward_on_complete'
--   );

COMMENT ON TABLE public.customer_credits IS 'Dollar-value credit ledger. Referral rewards, admin grants, promo, refunds, perks.';
COMMENT ON COLUMN public.bookings.referral_code IS 'Canonical referral attribution for this booking (matches customers.referral_code).';
COMMENT ON COLUMN public.bookings.post_confirm_ghl_sms_sent IS 'Idempotency flag for the post-booking GHL SMS (account + referral links).';
