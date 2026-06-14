-- VA Quotes table for the internal booking workspace
-- VAs can save a quote mid-call and convert it to a booking later.

CREATE TABLE IF NOT EXISTS public.va_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- VA who saved it
  csr_name TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,

  -- Customer
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,

  -- Service
  home_size_id TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'standard',
  add_ons TEXT[] DEFAULT '{}',
  frequency TEXT DEFAULT 'one-time',

  -- Schedule preference (optional — not yet confirmed)
  service_date DATE,
  time_slot TEXT,

  -- Pricing snapshot (cents)
  base_price_cents INTEGER,
  total_estimate_cents INTEGER,

  -- Notes
  notes TEXT,
  team_notes TEXT,
  access_notes TEXT,

  -- Property details
  bedrooms INTEGER,
  bathrooms NUMERIC(4,1),
  dwelling_type TEXT,
  pets TEXT,
  flooring_type TEXT,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | converted | expired
  converted_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_va_quotes_email ON public.va_quotes(email);
CREATE INDEX IF NOT EXISTS idx_va_quotes_status ON public.va_quotes(status);
CREATE INDEX IF NOT EXISTS idx_va_quotes_created_at ON public.va_quotes(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_va_quotes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER va_quotes_updated_at
  BEFORE UPDATE ON public.va_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_va_quotes_updated_at();

-- RLS: admin service-role bypass only (these are internal records)
ALTER TABLE public.va_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.va_quotes
  FOR ALL TO service_role USING (true);
