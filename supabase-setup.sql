-- ============================================================
-- NOVARA CLEANING - DATABASE VERIFICATION & REPAIR SCRIPT
-- ============================================================
-- This script is SAFE to run multiple times. It uses
-- IF NOT EXISTS / IF EXISTS checks throughout.
-- It will NOT drop or destroy any existing data.
-- ============================================================

-- ===========================================
-- 1. ENSURE update_updated_at_column EXISTS
-- ===========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ===========================================
-- 2. BOOKINGS TABLE - Ensure all columns exist
-- ===========================================
-- Core columns that might be missing
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_option TEXT DEFAULT 'deposit';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS full_payment_discount INTEGER DEFAULT 0;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_number INTEGER DEFAULT 1;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS estimated_duration_hours NUMERIC;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cleaner_hourly_rate_cents INTEGER DEFAULT 2000;

-- Post-payment property detail columns
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS bedrooms INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS bathrooms NUMERIC;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS dwelling_type TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS flooring_type TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pets TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS access_notes TEXT;

-- Confirmation email tracking
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS confirmation_email_sent BOOLEAN DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;

-- Cleaner assignment & payout columns
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cleaner_payout_cents INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payout_status TEXT DEFAULT 'pending';

-- Rating columns
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS review_text TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ;

-- Team/dispatch notes
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS team_notes TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS dispatch_notes TEXT;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bookings_email ON public.bookings(email);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_service_date ON public.bookings(service_date);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_intent ON public.bookings(payment_intent_id);


-- ===========================================
-- 3. SERVICE COVERAGE ZONES TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.service_coverage_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zip_code TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  tier TEXT DEFAULT 'tier_1',
  tier_label TEXT,
  is_active BOOLEAN DEFAULT true,
  pricing_multiplier NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint if missing (ignore error if already exists)
DO $$
BEGIN
  ALTER TABLE public.service_coverage_zones ADD CONSTRAINT service_coverage_zones_zip_code_key UNIQUE (zip_code);
EXCEPTION WHEN duplicate_table THEN
  -- constraint already exists, do nothing
  NULL;
WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_coverage_zip ON public.service_coverage_zones(zip_code);
CREATE INDEX IF NOT EXISTS idx_service_coverage_active ON public.service_coverage_zones(is_active) WHERE is_active = true;

ALTER TABLE public.service_coverage_zones ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read coverage zones (needed for ZIP code check on landing page)
DO $$
BEGIN
  CREATE POLICY "Anyone can view service coverage" ON public.service_coverage_zones FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 4. AVAILABILITY SLOTS TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 5,
  current_bookings INTEGER NOT NULL DEFAULT 0,
  is_available BOOLEAN GENERATED ALWAYS AS (current_bookings < max_capacity) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_date_time ON public.availability_slots(service_date, start_time);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Anyone can view availability" ON public.availability_slots FOR SELECT TO PUBLIC USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Service role can manage availability" ON public.availability_slots FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 5. RESERVE / RELEASE TIME SLOT FUNCTIONS
-- ===========================================
CREATE OR REPLACE FUNCTION public.reserve_time_slot(
  _date DATE,
  _start_time TIME,
  _end_time TIME
)
RETURNS BOOLEAN AS $$
DECLARE
  slot_available BOOLEAN;
BEGIN
  SELECT current_bookings < max_capacity INTO slot_available
  FROM availability_slots
  WHERE service_date = _date
    AND start_time = _start_time
    AND end_time = _end_time
  FOR UPDATE;

  IF NOT FOUND OR NOT slot_available THEN
    RETURN FALSE;
  END IF;

  UPDATE availability_slots
  SET current_bookings = current_bookings + 1,
      updated_at = NOW()
  WHERE service_date = _date
    AND start_time = _start_time
    AND end_time = _end_time;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.release_time_slot(
  _date DATE,
  _start_time TIME
)
RETURNS VOID AS $$
BEGIN
  UPDATE availability_slots
  SET current_bookings = GREATEST(current_bookings - 1, 0),
      updated_at = NOW()
  WHERE service_date = _date
    AND start_time = _start_time;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ===========================================
-- 6. PROMO CODES TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'percent',
  value NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN DEFAULT true,
  description TEXT,
  applies_to TEXT DEFAULT 'all',
  expires_at TIMESTAMPTZ,
  max_total_uses INTEGER,
  total_uses INTEGER DEFAULT 0,
  max_uses_per_customer INTEGER,
  min_profit_margin_percent INTEGER DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS applies_to TEXT DEFAULT 'all';
ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS max_uses_per_customer INTEGER;
ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS total_uses INTEGER DEFAULT 0;
ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS max_total_uses INTEGER;
ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS min_profit_margin_percent INTEGER DEFAULT 20;

CREATE INDEX IF NOT EXISTS idx_promo_codes_code_active ON public.promo_codes(code, active);

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Anyone can view active promo codes" ON public.promo_codes FOR SELECT USING (active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 7. REFERRALS TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  referrer_email TEXT,
  referee_email TEXT,
  referred_email TEXT,
  credit_cents INTEGER DEFAULT 2000,
  status TEXT DEFAULT 'pending',
  booking_id UUID,
  referred_booking_id UUID,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS booking_id UUID;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referrer_email TEXT;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referred_email TEXT;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referred_booking_id UUID;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals(code);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Anyone can view referrals" ON public.referrals FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Anyone can insert referrals" ON public.referrals FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Anyone can update referrals" ON public.referrals FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 8. EMAIL RETRY QUEUE TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS public.email_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID,
  email_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  email_data JSONB,
  retry_count INTEGER DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_retry_queue_status ON public.email_retry_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_retry_queue_next_retry ON public.email_retry_queue(next_retry_at) WHERE status = 'pending';

ALTER TABLE public.email_retry_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Service role access to email queue" ON public.email_retry_queue FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 9. WAITLIST TABLE
-- ===========================================
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

CREATE INDEX IF NOT EXISTS idx_waitlist_email ON public.waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_zip_code ON public.waitlist(zip_code);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Service role access to waitlist" ON public.waitlist FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 10. ABANDONED CARTS TABLE
-- ===========================================
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

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_email ON public.abandoned_carts(email);

ALTER TABLE public.abandoned_carts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Service role access to abandoned carts" ON public.abandoned_carts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 11. CUSTOMERS TABLE (for referral codes)
-- ===========================================
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  referral_code TEXT UNIQUE,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_referral_code ON public.customers(referral_code);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Public read access to customers" ON public.customers FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Public insert to customers" ON public.customers FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Public update to customers" ON public.customers FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- 12. ENSURE BOOKINGS RLS ALLOWS UPDATES
--     (critical for post-payment property details)
-- ===========================================
DO $$
BEGIN
  CREATE POLICY "Allow public read access to bookings" ON public.bookings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Allow public insert to bookings" ON public.bookings FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Allow public update to bookings" ON public.bookings FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ===========================================
-- DONE! All tables and functions verified.
-- ===========================================
