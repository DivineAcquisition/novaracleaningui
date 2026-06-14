-- Membership checkout (booking flow + admin VA) + service-agreement PDF
-- download hardening.
--
-- This migration is fully idempotent and safe to run on every Novara-family
-- project (NovaraCleaning, BayAreaCleaningPros, AlphaLuxClean) that shares
-- this codebase. It guarantees the schema + storage the membership
-- subscription webhook (stripe-webhook → customer.subscription.created) and
-- the admin Service Agreements tab depend on.

-- ─── 1. membership_credits — columns read/written by the webhook ──────────
CREATE TABLE IF NOT EXISTS public.membership_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  customer_id text,
  email text,
  membership_plan text,
  credits_per_month integer NOT NULL DEFAULT 1,
  credits_used integer NOT NULL DEFAULT 0,
  credits_remaining integer NOT NULL DEFAULT 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  subscription_id text,
  credit_available_date timestamptz,
  status text NOT NULL DEFAULT 'active'
);

ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS home_size_id text;
ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS monthly_price_cents integer;
ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS preferred_day_of_week text;
ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS preferred_time_window text;
ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS preferred_start_time text;
ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS preferred_end_time text;
ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.membership_credits ADD COLUMN IF NOT EXISTS subscription_id text;

CREATE INDEX IF NOT EXISTS idx_membership_credits_subscription
  ON public.membership_credits(subscription_id);
CREATE INDEX IF NOT EXISTS idx_membership_credits_email
  ON public.membership_credits(email);

-- ─── 2. customers — membership mirror columns ─────────────────────────────
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS membership_status text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS membership_plan text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS preferred_day_of_week text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS preferred_time_window text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- ─── 3. bookings — membership linkage ─────────────────────────────────────
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS membership_plan text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS uses_credit boolean DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS frequency text DEFAULT 'one-time';
-- Traceability for memberships started from the admin/VA flow.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS subscription_id text;

-- ─── 4. service_agreements + private bucket (PDF download) ─────────────────
CREATE TABLE IF NOT EXISTS public.service_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_email text,
  customer_name text,
  agreement_type text NOT NULL DEFAULT 'one_time_service',
  agreement_version text NOT NULL DEFAULT '2026-06',
  agreed_terms boolean NOT NULL DEFAULT false,
  agreed_disclaimer boolean NOT NULL DEFAULT false,
  agreed_refund boolean NOT NULL DEFAULT false,
  agreed_service_agreement boolean NOT NULL DEFAULT false,
  signed_by text,
  source text NOT NULL DEFAULT 'checkout',
  pdf_path text,
  ip text,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read agreements" ON public.service_agreements;
CREATE POLICY "admins read agreements" ON public.service_agreements
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

-- Private bucket for the generated, signed agreement PDFs. The admin
-- Service Agreements tab generates short-lived signed download URLs against
-- it, so the bucket + a SELECT policy for admins/VAs must exist.
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-agreements', 'service-agreements', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read agreement files" ON storage.objects;
CREATE POLICY "admins read agreement files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'service-agreements' AND public.is_admin_or_va(auth.uid()));
