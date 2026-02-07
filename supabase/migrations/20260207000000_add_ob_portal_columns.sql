-- ============================================================
-- Add Onboarding Portal tracking columns to cleaners table
-- These track completion of each onboarding step
-- ============================================================

-- Agreement
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_agreement_signed BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_agreement_signed_at TIMESTAMPTZ;

-- Google Chat
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_google_chat_joined BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_google_chat_joined_at TIMESTAMPTZ;

-- Supplies Checklist
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_supplies_checklist_viewed BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_supplies_checklist_viewed_at TIMESTAMPTZ;

-- Payouts Setup
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_payouts_setup BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_payouts_setup_at TIMESTAMPTZ;

-- Training Portal
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_training_accessed BOOLEAN DEFAULT false;
ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS ob_training_accessed_at TIMESTAMPTZ;

-- Ensure cleaners can update their own onboarding portal fields
-- (The existing "Cleaners can update own profile" policy should cover this,
-- but let's make sure update is allowed)
DO $$
BEGIN
  CREATE POLICY "Cleaners can update own ob fields"
    ON public.cleaners FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
