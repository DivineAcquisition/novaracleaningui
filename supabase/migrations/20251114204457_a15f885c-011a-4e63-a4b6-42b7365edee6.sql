-- Add phone verification fields to cleaners table
ALTER TABLE cleaners 
ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS phone_verification_code text,
ADD COLUMN IF NOT EXISTS phone_verification_sent_at timestamp with time zone;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cleaners_phone_verified ON cleaners(phone_verified);
CREATE INDEX IF NOT EXISTS idx_cleaners_user_id ON cleaners(user_id);