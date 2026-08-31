-- One-Time Service Agreement capture: stores each customer's signed
-- agreement (checkbox acceptances + signature + generated PDF) so it can be
-- emailed to the customer, downloaded from the admin portal, and produced
-- as chargeback / dispute evidence.

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

CREATE INDEX IF NOT EXISTS idx_service_agreements_booking ON public.service_agreements(booking_id);
CREATE INDEX IF NOT EXISTS idx_service_agreements_email ON public.service_agreements(customer_email);

ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read agreements" ON public.service_agreements;
CREATE POLICY "admins read agreements" ON public.service_agreements
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

-- Private bucket for the generated, signed agreement PDFs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-agreements', 'service-agreements', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read agreement files" ON storage.objects;
CREATE POLICY "admins read agreement files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'service-agreements' AND public.is_admin_or_va(auth.uid()));
