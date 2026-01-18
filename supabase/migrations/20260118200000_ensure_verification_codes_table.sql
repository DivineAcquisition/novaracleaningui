-- Ensure cleaner_verification_codes table exists with proper structure
CREATE TABLE IF NOT EXISTS cleaner_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_cleaner_verification_email ON cleaner_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_cleaner_verification_code ON cleaner_verification_codes(code);
CREATE INDEX IF NOT EXISTS idx_cleaner_verification_used ON cleaner_verification_codes(used);

-- Enable RLS
ALTER TABLE cleaner_verification_codes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Anyone can insert verification codes" ON cleaner_verification_codes;
DROP POLICY IF EXISTS "Anyone can read verification codes for validation" ON cleaner_verification_codes;
DROP POLICY IF EXISTS "System can update verification codes" ON cleaner_verification_codes;
DROP POLICY IF EXISTS "Service role full access to verification codes" ON cleaner_verification_codes;

-- Create a single permissive policy for service role (Edge Functions use service role)
CREATE POLICY "Service role full access to verification codes"
  ON cleaner_verification_codes
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Also allow anon to insert (for the Edge Function)
CREATE POLICY "Anyone can insert verification codes"
  ON cleaner_verification_codes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read verification codes"
  ON cleaner_verification_codes FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update verification codes"
  ON cleaner_verification_codes FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete verification codes"
  ON cleaner_verification_codes FOR DELETE
  USING (true);
