-- Deactivate all existing ZIP codes
UPDATE service_coverage_zones SET is_active = false WHERE is_active = true;

-- Insert Bethesda ZIP codes
INSERT INTO service_coverage_zones (zip_code, city, state, tier, tier_label, is_active, pricing_multiplier)
VALUES 
  ('20810', 'Bethesda', 'MD', 'tier_1', 'Bethesda Core', true, 1.0),
  ('20811', 'Bethesda', 'MD', 'tier_1', 'Bethesda Core', true, 1.0),
  ('20813', 'Bethesda', 'MD', 'tier_2', 'Bethesda Extended', true, 1.05),
  ('20814', 'Bethesda', 'MD', 'tier_1', 'Bethesda Core', true, 1.0),
  ('20815', 'Chevy Chase', 'MD', 'tier_1', 'Chevy Chase', true, 1.0),
  ('20816', 'Bethesda', 'MD', 'tier_1', 'Bethesda Core', true, 1.0),
  ('20817', 'Bethesda', 'MD', 'tier_1', 'Bethesda Core', true, 1.0),
  ('20824', 'Bethesda', 'MD', 'tier_2', 'Bethesda Extended', true, 1.05),
  ('20827', 'Bethesda', 'MD', 'tier_2', 'Bethesda Extended', true, 1.05),
  ('20889', 'Bethesda', 'MD', 'tier_2', 'Bethesda Extended', true, 1.05),
  ('20892', 'Bethesda', 'MD', 'tier_2', 'Bethesda Extended', true, 1.05),
  ('20894', 'Bethesda', 'MD', 'tier_2', 'Bethesda Extended', true, 1.05)
ON CONFLICT (zip_code) DO UPDATE SET 
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  tier = EXCLUDED.tier,
  tier_label = EXCLUDED.tier_label,
  is_active = true,
  pricing_multiplier = EXCLUDED.pricing_multiplier,
  updated_at = NOW();

-- Create waitlist table
CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  zip_code TEXT NOT NULL,
  city TEXT,
  state TEXT,
  source TEXT DEFAULT 'website',
  notified_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON public.waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_zip_code ON public.waitlist(zip_code);

-- Enable RLS
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Allow public inserts (for the edge function with service role)
CREATE POLICY "Allow service role full access to waitlist" ON public.waitlist
  FOR ALL USING (true) WITH CHECK (true);

-- Create abandoned_carts table
CREATE TABLE IF NOT EXISTS public.abandoned_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  zip_code TEXT,
  home_size TEXT,
  service_type TEXT,
  last_step TEXT,
  booking_data JSONB,
  reminder_sent_at TIMESTAMPTZ,
  reminder_count INTEGER DEFAULT 0,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_email ON public.abandoned_carts(email);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_reminder ON public.abandoned_carts(reminder_count, converted_at, created_at);

-- Enable RLS
ALTER TABLE public.abandoned_carts ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Allow service role full access to abandoned_carts" ON public.abandoned_carts
  FOR ALL USING (true) WITH CHECK (true);