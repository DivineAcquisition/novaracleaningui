-- Property-manager proposal requests attach the portfolio account the same
-- way STR requests attach a host. Send then opens the PM onboarding flow.

ALTER TABLE public.proposal_requests
  ADD COLUMN IF NOT EXISTS pm_account_id uuid REFERENCES public.property_manager_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS proposal_requests_pm_account_idx
  ON public.proposal_requests (pm_account_id)
  WHERE pm_account_id IS NOT NULL;

COMMENT ON COLUMN public.proposal_requests.pm_account_id IS
  'Property-manager portfolio created or reused when the request kind is property_manager.';

NOTIFY pgrst, 'reload schema';
