-- ============================================================
-- ONBOARDING PORTAL - Database Setup
-- ============================================================
-- Paste this into Supabase SQL Editor and click Run.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- ============================================================

-- Add onboarding portal tracking columns to cleaners table
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_agreement_signed BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_agreement_signed_at TIMESTAMPTZ;

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_google_chat_joined BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_google_chat_joined_at TIMESTAMPTZ;

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_supplies_checklist_viewed BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_supplies_checklist_viewed_at TIMESTAMPTZ;

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_payouts_setup BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_payouts_setup_at TIMESTAMPTZ;

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_training_accessed BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_training_accessed_at TIMESTAMPTZ;

-- Ensure cleaners can update their own onboarding fields
DO $$
BEGIN
  CREATE POLICY "Cleaners can update own ob fields"
    ON public.cleaners FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- DONE! Onboarding portal columns added to cleaners table.
-- ============================================================
