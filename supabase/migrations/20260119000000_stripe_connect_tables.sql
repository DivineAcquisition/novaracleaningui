-- Migration: Stripe Connect Tables
-- Ensures cleaners and payouts tables have all required columns for Stripe Connect

-- Ensure cleaners table has all required columns
DO $$
BEGIN
  -- Add stripe_account_id if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cleaners' AND column_name = 'stripe_account_id'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN stripe_account_id TEXT;
    COMMENT ON COLUMN cleaners.stripe_account_id IS 'Stripe Connect Express account ID';
  END IF;

  -- Add charges_enabled if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cleaners' AND column_name = 'charges_enabled'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN charges_enabled BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN cleaners.charges_enabled IS 'Whether the Stripe account can accept charges';
  END IF;

  -- Add payouts_enabled if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cleaners' AND column_name = 'payouts_enabled'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN payouts_enabled BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN cleaners.payouts_enabled IS 'Whether the Stripe account can receive payouts';
  END IF;

  -- Add onboarding_complete if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cleaners' AND column_name = 'onboarding_complete'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN onboarding_complete BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN cleaners.onboarding_complete IS 'Whether Stripe onboarding is complete (details_submitted)';
  END IF;

  -- Add total_earnings_cents if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cleaners' AND column_name = 'total_earnings_cents'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN total_earnings_cents INTEGER DEFAULT 0;
    COMMENT ON COLUMN cleaners.total_earnings_cents IS 'Total earnings in cents';
  END IF;

  -- Add last_payout_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cleaners' AND column_name = 'last_payout_at'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN last_payout_at TIMESTAMPTZ;
    COMMENT ON COLUMN cleaners.last_payout_at IS 'Timestamp of last successful payout';
  END IF;

  -- Add activated_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cleaners' AND column_name = 'activated_at'
  ) THEN
    ALTER TABLE cleaners ADD COLUMN activated_at TIMESTAMPTZ;
    COMMENT ON COLUMN cleaners.activated_at IS 'When the cleaner completed onboarding';
  END IF;
END $$;

-- Create index on stripe_account_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_cleaners_stripe_account_id 
ON cleaners(stripe_account_id) 
WHERE stripe_account_id IS NOT NULL;

-- Create index on payouts_enabled for filtering active cleaners
CREATE INDEX IF NOT EXISTS idx_cleaners_payouts_enabled 
ON cleaners(payouts_enabled) 
WHERE payouts_enabled = TRUE;

-- Create payouts table if not exists
CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  stripe_transfer_id TEXT,
  stripe_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  description TEXT,
  failed_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  
  CONSTRAINT unique_booking_cleaner_payout UNIQUE (booking_id, cleaner_id)
);

-- Create indexes on payouts table
CREATE INDEX IF NOT EXISTS idx_payouts_cleaner_id ON payouts(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_payouts_booking_id ON payouts(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON payouts(created_at);
CREATE INDEX IF NOT EXISTS idx_payouts_stripe_transfer_id ON payouts(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;

-- Index for retry job
CREATE INDEX IF NOT EXISTS idx_payouts_failed_for_retry 
ON payouts(status, retry_count, created_at) 
WHERE status = 'failed' AND retry_count < 3;

-- Enable RLS on payouts
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Policies for payouts table
DROP POLICY IF EXISTS "Service role can manage all payouts" ON payouts;
CREATE POLICY "Service role can manage all payouts" ON payouts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow cleaners to view their own payouts
DROP POLICY IF EXISTS "Cleaners can view own payouts" ON payouts;
CREATE POLICY "Cleaners can view own payouts" ON payouts
  FOR SELECT
  USING (
    cleaner_id IN (
      SELECT id FROM cleaners 
      WHERE user_id = auth.uid()
    )
  );

-- Add helpful comments
COMMENT ON TABLE payouts IS 'Records of all payouts to cleaners via Stripe Connect';
COMMENT ON COLUMN payouts.amount IS 'Payout amount in cents (USD)';
COMMENT ON COLUMN payouts.stripe_transfer_id IS 'Stripe Transfer ID (tr_xxx)';
COMMENT ON COLUMN payouts.status IS 'Payout status: pending, processing, completed, failed';
