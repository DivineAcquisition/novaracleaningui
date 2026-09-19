-- ─── Personal Guarantee evidence on the Host Partnership Agreement ─────────
--
-- An entity Host signs a personal guarantee alongside the Agreement; an
-- individual Host does not (there is nothing to guarantee — they are already
-- personally bound). The branch is driven by
-- host_onboarding_submissions.entity_type, which the self-serve Claim flow
-- and the admin flow both write.
--
-- These columns are the evidence trail for that signature. They are NOT NULL
-- DEFAULT false so existing signed agreements stay valid and simply read as
-- "no guarantee captured", which is correct for individual signers.

ALTER TABLE public.host_partnership_agreements
  ADD COLUMN IF NOT EXISTS personal_guarantee_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_guarantee_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guarantor_name text,
  ADD COLUMN IF NOT EXISTS guarantor_signed_at timestamptz;

COMMENT ON COLUMN public.host_partnership_agreements.personal_guarantee_required IS
  'True when the signer selected "business entity" — the guarantee block was presented.';
COMMENT ON COLUMN public.host_partnership_agreements.personal_guarantee_accepted IS
  'True when the guarantor accepted. Server-enforced: an entity agreement cannot be signed without it.';
COMMENT ON COLUMN public.host_partnership_agreements.guarantor_name IS
  'Legal name of the individual guaranteeing the entity Host''s obligations.';

-- An entity agreement must carry an accepted guarantee; an individual one
-- must not claim a guarantee it never presented.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'host_agreements_guarantee_consistent'
  ) THEN
    ALTER TABLE public.host_partnership_agreements
      ADD CONSTRAINT host_agreements_guarantee_consistent
      CHECK (
        (personal_guarantee_required = false AND personal_guarantee_accepted = false)
        OR (personal_guarantee_required = true AND personal_guarantee_accepted = true
            AND guarantor_name IS NOT NULL AND length(btrim(guarantor_name)) > 1)
      )
      NOT VALID;
  END IF;
END $$;
