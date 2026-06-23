-- ─── GHL id persistence for the Partner Turnover Portal + custom quotes ───
--
-- The Turnover Request Portal (partner.novaracleaning.com) and the custom
-- commercial quote form were shipped WITHOUT any GoHighLevel sync — hosts,
-- turnover jobs, and commercial quote leads never landed in the CRM, so no
-- contact/opportunity data was mapped and no GHL-driven comms fired.
--
-- These columns let the edge functions persist the resolved GHL contact +
-- opportunity ids so repeat events PATCH the same records instead of
-- creating duplicates in the pipeline.

ALTER TABLE public.hosts
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;

ALTER TABLE public.turnover_requests
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT;

CREATE INDEX IF NOT EXISTS turnover_requests_ghl_opportunity_idx
  ON public.turnover_requests (ghl_opportunity_id)
  WHERE ghl_opportunity_id IS NOT NULL;

-- custom_quotes predates this change; guard the table existing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'custom_quotes'
  ) THEN
    ALTER TABLE public.custom_quotes
      ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT,
      ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT;
  END IF;
END $$;
