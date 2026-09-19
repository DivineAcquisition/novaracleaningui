-- Host Partnership Agreement §6.10 personal guarantee evidence.
-- Required when the Host signs as a business entity; unused for individuals.

ALTER TABLE public.host_partnership_agreements
  ADD COLUMN IF NOT EXISTS acknowledged_personal_guarantee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guarantor_name text;

COMMENT ON COLUMN public.host_partnership_agreements.acknowledged_personal_guarantee IS
  'Section 6.10: true when an entity Host acknowledged the personal guarantee at signature. Always false for individual Hosts (the block is not shown).';

COMMENT ON COLUMN public.host_partnership_agreements.guarantor_name IS
  'Section 6.10 guarantor legal name. Null unless the Host signed as a business entity.';
