-- Pricing Configuration Tables for NovaraCleaning
-- Version 2.0 - Maryland Service Area

-- ============================================
-- PRICING ZONES
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  modifier DECIMAL(4,2) NOT NULL DEFAULT 1.0,
  areas TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Zone ZIP codes lookup table
CREATE TABLE IF NOT EXISTS public.pricing_zone_zip_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id TEXT NOT NULL REFERENCES public.pricing_zones(id) ON DELETE CASCADE,
  zip_code TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(zip_code)
);

CREATE INDEX idx_pricing_zone_zip_codes_zip ON public.pricing_zone_zip_codes(zip_code);
CREATE INDEX idx_pricing_zone_zip_codes_zone ON public.pricing_zone_zip_codes(zone_id);

-- ============================================
-- SERVICE TYPES
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_service_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.0,
  includes TEXT[] DEFAULT '{}',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ONE-TIME BASE PRICES
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_one_time_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sqft_range TEXT NOT NULL UNIQUE,
  min_sqft INTEGER NOT NULL,
  max_sqft INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  hours DECIMAL(3,1) NOT NULL,
  cleaners TEXT NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pricing_one_time_base_sqft ON public.pricing_one_time_base(min_sqft, max_sqft);

-- ============================================
-- MEMBERSHIP PRICES
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_membership_plans (
  id TEXT PRIMARY KEY,
  frequency TEXT NOT NULL,
  cleans_per_month INTEGER NOT NULL,
  discount_vs_onetime TEXT,
  recommended BOOLEAN DEFAULT false,
  first_clean_fee_cents INTEGER DEFAULT 7500,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pricing_membership_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT NOT NULL REFERENCES public.pricing_membership_plans(id) ON DELETE CASCADE,
  sqft_range TEXT NOT NULL,
  min_sqft INTEGER NOT NULL,
  max_sqft INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  cleaners TEXT NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(plan_id, sqft_range)
);

CREATE INDEX idx_pricing_membership_prices_plan ON public.pricing_membership_prices(plan_id);

-- ============================================
-- ADD-ONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_add_ons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  description TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- CONTRACTOR TIERS
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_contractor_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hourly_rate_cents INTEGER NOT NULL,
  platform_fee DECIMAL(4,2) NOT NULL,
  tenure_months_required INTEGER DEFAULT 0,
  min_jobs_required INTEGER DEFAULT 0,
  min_rating DECIMAL(2,1) DEFAULT 4.8,
  on_time_rate_required DECIMAL(3,2),
  job_access TEXT[] DEFAULT '{}',
  priority_booking BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- CLEANER ASSIGNMENT RULES
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_cleaner_assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL,
  sqft_range TEXT NOT NULL,
  cleaners TEXT NOT NULL,
  prefer_tier TEXT,
  fallback_cleaners INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(service_type, sqft_range)
);

CREATE INDEX idx_cleaner_assignment_rules_service ON public.pricing_cleaner_assignment_rules(service_type);

-- ============================================
-- PRICING CONFIG METADATA
-- ============================================
CREATE TABLE IF NOT EXISTS public.pricing_config_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL,
  last_updated DATE NOT NULL,
  company TEXT NOT NULL,
  service_area TEXT NOT NULL,
  platform_fee DECIMAL(4,2) DEFAULT 0.05,
  custom_quote_threshold_sqft INTEGER DEFAULT 5000,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.pricing_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_zone_zip_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_one_time_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_membership_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_add_ons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_contractor_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_cleaner_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_config_meta ENABLE ROW LEVEL SECURITY;

-- Public read policies for all pricing tables
CREATE POLICY "Public read pricing_zones" ON public.pricing_zones FOR SELECT USING (true);
CREATE POLICY "Public read pricing_zone_zip_codes" ON public.pricing_zone_zip_codes FOR SELECT USING (true);
CREATE POLICY "Public read pricing_service_types" ON public.pricing_service_types FOR SELECT USING (true);
CREATE POLICY "Public read pricing_one_time_base" ON public.pricing_one_time_base FOR SELECT USING (true);
CREATE POLICY "Public read pricing_membership_plans" ON public.pricing_membership_plans FOR SELECT USING (true);
CREATE POLICY "Public read pricing_membership_prices" ON public.pricing_membership_prices FOR SELECT USING (true);
CREATE POLICY "Public read pricing_add_ons" ON public.pricing_add_ons FOR SELECT USING (true);
CREATE POLICY "Public read pricing_contractor_tiers" ON public.pricing_contractor_tiers FOR SELECT USING (true);
CREATE POLICY "Public read pricing_cleaner_assignment_rules" ON public.pricing_cleaner_assignment_rules FOR SELECT USING (true);
CREATE POLICY "Public read pricing_config_meta" ON public.pricing_config_meta FOR SELECT USING (true);

-- ============================================
-- SEED DATA
-- ============================================

-- Pricing Config Metadata
INSERT INTO public.pricing_config_meta (version, last_updated, company, service_area, platform_fee, custom_quote_threshold_sqft)
VALUES ('2.0', '2026-02-01', 'NovaraCleaning', 'Maryland', 0.05, 5000);

-- Pricing Zones
INSERT INTO public.pricing_zones (id, name, modifier, areas) VALUES
  ('A', 'Premium', 1.15, ARRAY['Bethesda', 'Potomac', 'Chevy Chase', 'Rockville', 'Silver Spring']),
  ('B', 'Standard', 1.0, ARRAY['Rest of MoCo', 'PG County', 'Columbia', 'Ellicott City']),
  ('C', 'Outer', 0.90, ARRAY['Frederick', 'Hagerstown', 'Annapolis', 'Baltimore suburbs']);

-- Zone A ZIP codes (Premium)
INSERT INTO public.pricing_zone_zip_codes (zone_id, zip_code) VALUES
  ('A', '20814'), ('A', '20815'), ('A', '20816'), ('A', '20817'),
  ('A', '20854'), ('A', '20859'), ('A', '20850'), ('A', '20851'),
  ('A', '20852'), ('A', '20901'), ('A', '20902'), ('A', '20903'),
  ('A', '20904'), ('A', '20910');

-- Zone C ZIP codes (Outer)
INSERT INTO public.pricing_zone_zip_codes (zone_id, zip_code) VALUES
  ('C', '21701'), ('C', '21702'), ('C', '21703'), ('C', '21740'),
  ('C', '21742'), ('C', '21401'), ('C', '21403'), ('C', '21117'),
  ('C', '21208'), ('C', '21228'), ('C', '21244');

-- Service Types
INSERT INTO public.pricing_service_types (id, name, multiplier, includes, description) VALUES
  ('standard', 'Standard Clean', 1.0, '{}', 'Regular maintenance cleaning'),
  ('deep', 'Deep Clean', 1.5, '{}', 'Thorough deep cleaning'),
  ('move_in_out', 'Move-In/Out Clean', 2.0, ARRAY['fridge', 'oven'], 'Complete move cleaning with fridge and oven included');

-- One-Time Base Prices
INSERT INTO public.pricing_one_time_base (sqft_range, min_sqft, max_sqft, price_cents, hours, cleaners) VALUES
  ('0-999', 0, 999, 15000, 2.0, '1'),
  ('1000-1500', 1000, 1500, 18900, 2.5, '1'),
  ('1501-2000', 1501, 2000, 23900, 3.0, '1'),
  ('2001-2500', 2001, 2500, 27900, 3.5, '1'),
  ('2501-3000', 2501, 3000, 33900, 4.0, '1-2'),
  ('3001-3500', 3001, 3500, 37900, 4.5, '1-2'),
  ('3501-4000', 3501, 4000, 43900, 5.0, '2'),
  ('4001-4500', 4001, 4500, 48900, 5.5, '2'),
  ('4501-5000', 4501, 5000, 53900, 6.0, '2');

-- Membership Plans
INSERT INTO public.pricing_membership_plans (id, frequency, cleans_per_month, discount_vs_onetime, recommended, first_clean_fee_cents) VALUES
  ('monthly', 'monthly', 1, '14-18%', false, 7500),
  ('biweekly', 'bi-weekly', 2, '33-34%', true, 7500),
  ('weekly', 'weekly', 4, '40-42%', false, 7500);

-- Monthly Membership Prices
INSERT INTO public.pricing_membership_prices (plan_id, sqft_range, min_sqft, max_sqft, price_cents, cleaners) VALUES
  ('monthly', '0-999', 0, 999, 12900, '1'),
  ('monthly', '1000-1500', 1000, 1500, 15900, '1'),
  ('monthly', '1501-2000', 1501, 2000, 19900, '1'),
  ('monthly', '2001-2500', 2001, 2500, 22900, '1'),
  ('monthly', '2501-3000', 2501, 3000, 27900, '1-2'),
  ('monthly', '3001-3500', 3001, 3500, 31900, '1-2'),
  ('monthly', '3501-4000', 3501, 4000, 36900, '2'),
  ('monthly', '4001-4500', 4001, 4500, 40900, '2'),
  ('monthly', '4501-5000', 4501, 5000, 45900, '2');

-- Bi-weekly Membership Prices (per month, for 2 cleans)
INSERT INTO public.pricing_membership_prices (plan_id, sqft_range, min_sqft, max_sqft, price_cents, cleaners) VALUES
  ('biweekly', '0-999', 0, 999, 19900, '1'),
  ('biweekly', '1000-1500', 1000, 1500, 24900, '1'),
  ('biweekly', '1501-2000', 1501, 2000, 31900, '1'),
  ('biweekly', '2001-2500', 2001, 2500, 36900, '1'),
  ('biweekly', '2501-3000', 2501, 3000, 44900, '1-2'),
  ('biweekly', '3001-3500', 3001, 3500, 49900, '1-2'),
  ('biweekly', '3501-4000', 3501, 4000, 57900, '2'),
  ('biweekly', '4001-4500', 4001, 4500, 64900, '2'),
  ('biweekly', '4501-5000', 4501, 5000, 71900, '2');

-- Weekly Membership Prices (per month, for 4 cleans)
INSERT INTO public.pricing_membership_prices (plan_id, sqft_range, min_sqft, max_sqft, price_cents, cleaners) VALUES
  ('weekly', '0-999', 0, 999, 34900, '1'),
  ('weekly', '1000-1500', 1000, 1500, 44900, '1'),
  ('weekly', '1501-2000', 1501, 2000, 56900, '1'),
  ('weekly', '2001-2500', 2001, 2500, 65900, '1'),
  ('weekly', '2501-3000', 2501, 3000, 79900, '1-2'),
  ('weekly', '3001-3500', 3001, 3500, 89900, '1-2'),
  ('weekly', '3501-4000', 3501, 4000, 103900, '2'),
  ('weekly', '4001-4500', 4001, 4500, 115900, '2'),
  ('weekly', '4501-5000', 4501, 5000, 127900, '2');

-- Add-ons
INSERT INTO public.pricing_add_ons (id, name, price_cents, description) VALUES
  ('fridge', 'Inside Fridge', 3000, 'Deep cleaning inside refrigerator'),
  ('oven', 'Inside Oven', 3000, 'Deep cleaning inside oven'),
  ('windows', 'Interior Windows', 4000, 'Interior window cleaning');

-- Contractor Tiers
INSERT INTO public.pricing_contractor_tiers (id, name, hourly_rate_cents, platform_fee, tenure_months_required, min_jobs_required, min_rating, on_time_rate_required, job_access, priority_booking) VALUES
  ('foundation', 'Foundation', 1800, 0.10, 0, 0, 4.8, NULL, ARRAY['standard'], false),
  ('proven', 'Proven', 2000, 0.07, 6, 25, 4.8, 0.90, ARRAY['standard', 'deep'], false),
  ('elite', 'Elite', 2200, 0.05, 12, 50, 4.8, 0.95, ARRAY['standard', 'deep', 'move_in_out'], true);

-- Cleaner Assignment Rules - Standard
INSERT INTO public.pricing_cleaner_assignment_rules (service_type, sqft_range, cleaners, prefer_tier, fallback_cleaners) VALUES
  ('standard', '0-999', '1', NULL, NULL),
  ('standard', '1000-1500', '1', NULL, NULL),
  ('standard', '1501-2000', '1', NULL, NULL),
  ('standard', '2001-2500', '1', NULL, NULL),
  ('standard', '2501-3000', '1', 'elite', 2),
  ('standard', '3001-3500', '1', 'elite', 2),
  ('standard', '3501-4000', '2', NULL, NULL),
  ('standard', '4001-4500', '2', NULL, NULL),
  ('standard', '4501-5000', '2', NULL, NULL);

-- Cleaner Assignment Rules - Deep
INSERT INTO public.pricing_cleaner_assignment_rules (service_type, sqft_range, cleaners, prefer_tier, fallback_cleaners) VALUES
  ('deep', '0-999', '1', NULL, NULL),
  ('deep', '1000-1500', '1', NULL, NULL),
  ('deep', '1501-2000', '1', NULL, NULL),
  ('deep', '2001-2500', '1-2', NULL, NULL),
  ('deep', '2501-3000', '2', NULL, NULL),
  ('deep', '3001-3500', '2', NULL, NULL),
  ('deep', '3501-4000', '2', NULL, NULL),
  ('deep', '4001-4500', '2-3', NULL, NULL),
  ('deep', '4501-5000', '2-3', NULL, NULL);

-- Cleaner Assignment Rules - Move-In/Out
INSERT INTO public.pricing_cleaner_assignment_rules (service_type, sqft_range, cleaners, prefer_tier, fallback_cleaners) VALUES
  ('move_in_out', '0-999', '1', NULL, NULL),
  ('move_in_out', '1000-1500', '1-2', NULL, NULL),
  ('move_in_out', '1501-2000', '2', NULL, NULL),
  ('move_in_out', '2001-2500', '2', NULL, NULL),
  ('move_in_out', '2501-3000', '2', NULL, NULL),
  ('move_in_out', '3001-3500', '2-3', NULL, NULL),
  ('move_in_out', '3501-4000', '2-3', NULL, NULL),
  ('move_in_out', '4001-4500', '3', NULL, NULL),
  ('move_in_out', '4501-5000', '3', NULL, NULL);

-- ============================================
-- HELPER FUNCTION: Get zone by ZIP code
-- ============================================
CREATE OR REPLACE FUNCTION public.get_pricing_zone(p_zip_code TEXT)
RETURNS TABLE(zone_id TEXT, zone_name TEXT, modifier DECIMAL) AS $$
BEGIN
  RETURN QUERY
  SELECT pz.id, pz.name, pz.modifier
  FROM public.pricing_zones pz
  JOIN public.pricing_zone_zip_codes pzz ON pz.id = pzz.zone_id
  WHERE pzz.zip_code = p_zip_code;
  
  -- If no match found, return Zone B (Standard) as default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT pz.id, pz.name, pz.modifier
    FROM public.pricing_zones pz
    WHERE pz.id = 'B';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTION: Calculate price for booking
-- ============================================
CREATE OR REPLACE FUNCTION public.calculate_booking_price(
  p_zip_code TEXT,
  p_sqft INTEGER,
  p_service_type TEXT,
  p_frequency TEXT DEFAULT 'one_time',
  p_add_ons TEXT[] DEFAULT '{}'
)
RETURNS TABLE(
  base_price_cents INTEGER,
  zone_modifier DECIMAL,
  service_multiplier DECIMAL,
  add_ons_cents INTEGER,
  total_price_cents INTEGER,
  estimated_hours DECIMAL,
  cleaners TEXT
) AS $$
DECLARE
  v_zone_modifier DECIMAL;
  v_base_price INTEGER;
  v_hours DECIMAL;
  v_cleaners TEXT;
  v_service_multiplier DECIMAL;
  v_add_ons_total INTEGER := 0;
  v_add_on_id TEXT;
  v_add_on_price INTEGER;
BEGIN
  -- Get zone modifier
  SELECT pz.modifier INTO v_zone_modifier
  FROM public.pricing_zones pz
  LEFT JOIN public.pricing_zone_zip_codes pzz ON pz.id = pzz.zone_id
  WHERE pzz.zip_code = p_zip_code OR pz.id = 'B'
  ORDER BY CASE WHEN pzz.zip_code = p_zip_code THEN 0 ELSE 1 END
  LIMIT 1;
  
  v_zone_modifier := COALESCE(v_zone_modifier, 1.0);
  
  -- Get service multiplier
  SELECT pst.multiplier INTO v_service_multiplier
  FROM public.pricing_service_types pst
  WHERE pst.id = p_service_type;
  
  v_service_multiplier := COALESCE(v_service_multiplier, 1.0);
  
  -- Get base price based on frequency
  IF p_frequency = 'one_time' THEN
    SELECT pot.price_cents, pot.hours, pot.cleaners
    INTO v_base_price, v_hours, v_cleaners
    FROM public.pricing_one_time_base pot
    WHERE p_sqft >= pot.min_sqft AND p_sqft <= pot.max_sqft;
  ELSE
    SELECT pmp.price_cents, pot.hours, pmp.cleaners
    INTO v_base_price, v_hours, v_cleaners
    FROM public.pricing_membership_prices pmp
    JOIN public.pricing_one_time_base pot ON pmp.sqft_range = pot.sqft_range
    WHERE pmp.plan_id = p_frequency 
      AND p_sqft >= pmp.min_sqft AND p_sqft <= pmp.max_sqft;
  END IF;
  
  v_base_price := COALESCE(v_base_price, 0);
  v_hours := COALESCE(v_hours, 0);
  v_cleaners := COALESCE(v_cleaners, '1');
  
  -- Calculate add-ons (skip if included in service type)
  FOREACH v_add_on_id IN ARRAY p_add_ons
  LOOP
    -- Check if add-on is included in service type
    IF NOT EXISTS (
      SELECT 1 FROM public.pricing_service_types pst
      WHERE pst.id = p_service_type AND v_add_on_id = ANY(pst.includes)
    ) THEN
      SELECT pa.price_cents INTO v_add_on_price
      FROM public.pricing_add_ons pa
      WHERE pa.id = v_add_on_id AND pa.active = true;
      
      v_add_ons_total := v_add_ons_total + COALESCE(v_add_on_price, 0);
    END IF;
  END LOOP;
  
  -- Return calculated values
  base_price_cents := v_base_price;
  zone_modifier := v_zone_modifier;
  service_multiplier := v_service_multiplier;
  add_ons_cents := v_add_ons_total;
  total_price_cents := ROUND((v_base_price * v_zone_modifier * v_service_multiplier) + v_add_ons_total);
  estimated_hours := v_hours;
  cleaners := v_cleaners;
  
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
