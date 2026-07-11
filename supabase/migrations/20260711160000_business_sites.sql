-- ─── business_sites: locations under a commercial/office account ─────────────
-- Commercial = one account (business) with one or more sites (locations).
-- Mirrors the Airtable Sites table (tblIAnpKS2RKtYPZk); Supabase is the
-- operational store, Airtable sync happens on save via the admin API.

CREATE TABLE IF NOT EXISTS public.business_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  address text,
  city text,
  state text,
  zip_code text,
  facility_type text,
  sqft integer,
  restrooms integer,
  floors integer,
  scope_notes text,
  access_method text,
  access_instructions text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_sites_account_idx ON public.business_sites (business_account_id);
ALTER TABLE public.business_sites ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='business_sites' AND policyname='business_sites_admin_all') THEN
    CREATE POLICY business_sites_admin_all ON public.business_sites FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='business_sites' AND policyname='business_sites_service_role') THEN
    CREATE POLICY business_sites_service_role ON public.business_sites FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;
