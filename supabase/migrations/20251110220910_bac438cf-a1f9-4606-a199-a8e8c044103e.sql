-- Create cleaners table
CREATE TABLE public.cleaners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Personal Info
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  
  -- Stripe Connect
  stripe_account_id TEXT UNIQUE,
  onboarding_complete BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,
  
  -- Status & Availability
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, inactive, suspended
  available_for_bookings BOOLEAN DEFAULT true,
  max_weekly_bookings INTEGER DEFAULT 10,
  
  -- Service Areas (for auto-assignment)
  service_zip_codes TEXT[] DEFAULT '{}',
  
  -- Performance Tracking
  total_bookings INTEGER DEFAULT 0,
  completed_bookings INTEGER DEFAULT 0,
  total_earnings_cents BIGINT DEFAULT 0,
  
  -- Onboarding
  invited_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ
);

-- Trigger for updated_at
CREATE TRIGGER update_cleaners_updated_at 
  BEFORE UPDATE ON public.cleaners 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Index for efficient queries
CREATE INDEX idx_cleaners_status ON cleaners(status);
CREATE INDEX idx_cleaners_stripe_account ON cleaners(stripe_account_id);
CREATE INDEX idx_cleaners_available ON cleaners(available_for_bookings) WHERE status = 'active';
CREATE INDEX idx_cleaners_zip_codes ON cleaners USING GIN(service_zip_codes);

-- Create payouts table
CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- References
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  
  -- Financial Details
  total_booking_amount_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  cleaner_payout_cents INTEGER NOT NULL,
  
  -- Stripe Details
  stripe_transfer_id TEXT UNIQUE,
  stripe_account_id TEXT NOT NULL,
  
  -- Status Tracking
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  processed_at TIMESTAMPTZ,
  failed_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Metadata
  notes TEXT
);

-- Indexes for payouts
CREATE INDEX idx_payouts_booking ON payouts(booking_id);
CREATE INDEX idx_payouts_cleaner ON payouts(cleaner_id);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_payouts_transfer ON payouts(stripe_transfer_id);

-- Update bookings table
ALTER TABLE public.bookings 
  ADD COLUMN cleaner_id UUID REFERENCES cleaners(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN platform_fee_cents INTEGER,
  ADD COLUMN cleaner_payout_cents INTEGER,
  ADD COLUMN payout_status TEXT DEFAULT 'pending';

-- Indexes for bookings
CREATE INDEX idx_bookings_cleaner ON bookings(cleaner_id);
CREATE INDEX idx_bookings_payout_status ON bookings(payout_status);
CREATE INDEX idx_bookings_assigned_at ON bookings(assigned_at);

-- RLS Policies for cleaners table
ALTER TABLE cleaners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage cleaners"
  ON cleaners FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Cleaners can view own profile"
  ON cleaners FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Cleaners can update own profile"
  ON cleaners FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for payouts table
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage payouts"
  ON payouts FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Cleaners can view own payouts"
  ON payouts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cleaners 
      WHERE cleaners.id = payouts.cleaner_id 
      AND cleaners.user_id = auth.uid()
    )
  );