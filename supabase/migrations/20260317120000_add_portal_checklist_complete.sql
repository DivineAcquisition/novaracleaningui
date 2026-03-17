-- ============================================================
-- Add portal_checklist_complete to cleaners table
-- Tracks completion of the OnboardingPortal 5-step checklist.
-- The main onboarding_complete flag is controlled by Onboarding.tsx.
-- ============================================================

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS portal_checklist_complete BOOLEAN DEFAULT false;
