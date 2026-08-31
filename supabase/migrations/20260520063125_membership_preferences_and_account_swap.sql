-- Membership preference columns + account-swap helpers
--
-- This migration is part of the Stripe account swap to
-- sk_live_51SX5ZV2YP5iHN3Rz… (new NovaraCleaning live account, May 2026).
-- It adds the columns that `customer.subscription.created` /
-- `customer.subscription.updated` write to so the
-- preferred-day-of-week + preferred-time-window selections captured
-- during Membership signup are preserved on the credits row and on the
-- customer record (for GHL sync).
--
-- It also adds membership-status fields to the customers table so the
-- portal / pause / resume edge functions can mirror state into GHL
-- without joining membership_credits every time.

ALTER TABLE public.membership_credits
  ADD COLUMN IF NOT EXISTS home_size_id TEXT,
  ADD COLUMN IF NOT EXISTS monthly_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS preferred_day_of_week TEXT,
  ADD COLUMN IF NOT EXISTS preferred_time_window TEXT,
  ADD COLUMN IF NOT EXISTS preferred_start_time TEXT,
  ADD COLUMN IF NOT EXISTS preferred_end_time TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS membership_credits_email_idx
  ON public.membership_credits (email);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS membership_status TEXT,
  ADD COLUMN IF NOT EXISTS membership_plan TEXT,
  ADD COLUMN IF NOT EXISTS membership_paused_until DATE,
  ADD COLUMN IF NOT EXISTS preferred_day_of_week TEXT,
  ADD COLUMN IF NOT EXISTS preferred_time_window TEXT;
