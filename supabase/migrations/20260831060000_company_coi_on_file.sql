-- Novara's own certificate of insurance — the document we send a commercial
-- client on signature (Section 8.1), distinct from commercial_coi_documents
-- (certificates belonging to an account).
--
-- Official 20260824210000 was never applied on hosted. CREATE / ADD COLUMN
-- IF NOT EXISTS so that file can still run later. company_coi_deliveries
-- .agreement_id is a bare uuid: commercial_agreements does not exist on
-- hosted yet, and the official file's FK would fail here.

ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS requires_coi_on_file boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS company_coi_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_coi_document_id uuid;

COMMENT ON COLUMN public.business_accounts.company_coi_sent_at IS
  'When OUR certificate was last delivered to this client. Distinct from coi_sent_at, which belongs to the account-side COI lifecycle.';

CREATE TABLE IF NOT EXISTS public.company_coi_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  document_path text,
  document_name text,
  document_size_bytes bigint,

  effective_date date,
  expiration_date date,
  carrier text,
  policy_number text,
  coverage_notes text,
  business_account_id uuid
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,

  lifecycle text NOT NULL DEFAULT 'current'
    CHECK (lifecycle IN ('current', 'superseded', 'needs_review', 'rejected')),
  review_note text,

  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT company_coi_documents_dates_chk
    CHECK (effective_date IS NULL OR expiration_date IS NULL
           OR expiration_date >= effective_date),
  CONSTRAINT company_coi_documents_current_needs_expiry_chk
    CHECK (lifecycle <> 'current' OR expiration_date IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_coi_documents_one_general_current
  ON public.company_coi_documents ((business_account_id IS NULL))
  WHERE lifecycle = 'current' AND business_account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS company_coi_documents_one_account_current
  ON public.company_coi_documents (business_account_id)
  WHERE lifecycle = 'current' AND business_account_id IS NOT NULL;

COMMENT ON TABLE public.company_coi_documents IS
  'NovaraCleaning''s OWN certificate of insurance — the document we send to a commercial client on signature. Distinct from commercial_coi_documents, which holds certificates belonging to the accounts themselves.';

ALTER TABLE public.company_coi_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_coi_documents_admin ON public.company_coi_documents;
CREATE POLICY company_coi_documents_admin ON public.company_coi_documents
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS company_coi_documents_service ON public.company_coi_documents;
CREATE POLICY company_coi_documents_service ON public.company_coi_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.company_coi_documents TO authenticated;
GRANT ALL ON public.company_coi_documents TO service_role;
REVOKE ALL ON public.company_coi_documents FROM anon;

INSERT INTO storage.buckets (id, name, public)
VALUES ('company-coi', 'company-coi', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read company coi" ON storage.objects;
CREATE POLICY "admins read company coi" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'company-coi' AND public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admins write company coi" ON storage.objects;
CREATE POLICY "admins write company coi" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-coi' AND public.is_admin_or_va(auth.uid()));

CREATE TABLE IF NOT EXISTS public.company_coi_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  company_coi_document_id uuid
    REFERENCES public.company_coi_documents(id) ON DELETE SET NULL,
  -- Bare uuid on purpose: commercial_agreements is not on hosted yet.
  agreement_id uuid,

  sent_to text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by_name text,
  trigger_source text NOT NULL DEFAULT 'agreement_signature'
    CHECK (trigger_source IN ('agreement_signature', 'manual', 'renewal')),

  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed', 'skipped')),
  failure_reason text,
  certificate_expires_at date,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_coi_deliveries_account_idx
  ON public.company_coi_deliveries (business_account_id, sent_at DESC);

COMMENT ON TABLE public.company_coi_deliveries IS
  'Every time our certificate of insurance was delivered to a client, which certificate it was, and what triggered it.';

ALTER TABLE public.company_coi_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_coi_deliveries_admin ON public.company_coi_deliveries;
CREATE POLICY company_coi_deliveries_admin ON public.company_coi_deliveries
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS company_coi_deliveries_service ON public.company_coi_deliveries;
CREATE POLICY company_coi_deliveries_service ON public.company_coi_deliveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.company_coi_deliveries TO authenticated;
GRANT ALL ON public.company_coi_deliveries TO service_role;
REVOKE ALL ON public.company_coi_deliveries FROM anon;

-- The certificate issued 08/31/2026. document_path uses the public: prefix
-- so sendCompanyCoi reads the bundled PDF until an admin uploads a
-- replacement into the company-coi bucket.
INSERT INTO public.company_coi_documents (
  id, document_path, document_name, document_size_bytes,
  effective_date, expiration_date, carrier, policy_number, coverage_notes,
  lifecycle, uploaded_by_name
)
SELECT
  'd64f3143-a05d-4f9e-8c44-3c9051bd4e77',
  'public:commercial/novara-certificate-of-insurance.pdf',
  'NovaraCleaning Certificate of Insurance.pdf',
  96407,
  '2026-07-21',
  '2027-07-21',
  'Spinnaker Insurance Company',
  'CSG-00519113-00',
  'Commercial general liability: $2,000,000 each occurrence; $4,000,000 general aggregate; $4,000,000 products-completed operations; $50,000 damage to rented premises; $5,000 medical expense. Insurer NAIC 24376.',
  'current',
  'System'
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_coi_documents
  WHERE lifecycle = 'current' AND business_account_id IS NULL
);
