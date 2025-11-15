-- Update referrals table to support per-booking referral codes
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id),
  ADD COLUMN IF NOT EXISTS referrer_email text,
  ADD COLUMN IF NOT EXISTS referred_email text,
  ADD COLUMN IF NOT EXISTS referred_booking_id uuid REFERENCES bookings(id),
  ADD COLUMN IF NOT EXISTS used_at timestamp with time zone;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
CREATE INDEX IF NOT EXISTS idx_referrals_booking_id ON referrals(booking_id);

-- Update RLS policies for referrals
DROP POLICY IF EXISTS "Anyone can view referrals for validation" ON referrals;
CREATE POLICY "Anyone can view referrals for validation"
  ON referrals FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "System can create referrals" ON referrals;
CREATE POLICY "System can create referrals"
  ON referrals FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "System can update referrals" ON referrals;
CREATE POLICY "System can update referrals"
  ON referrals FOR UPDATE
  USING (true);

-- Add table for storing cleaner verification codes
CREATE TABLE IF NOT EXISTS cleaner_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaner_verification_email ON cleaner_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_cleaner_verification_code ON cleaner_verification_codes(code);

-- RLS for verification codes
ALTER TABLE cleaner_verification_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert verification codes"
  ON cleaner_verification_codes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read verification codes for validation"
  ON cleaner_verification_codes FOR SELECT
  USING (true);

CREATE POLICY "System can update verification codes"
  ON cleaner_verification_codes FOR UPDATE
  USING (true);