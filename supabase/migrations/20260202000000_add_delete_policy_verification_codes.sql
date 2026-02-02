-- Add DELETE policy for cleaner_verification_codes
-- This allows cleaning up old unused verification codes

DROP POLICY IF EXISTS "System can delete verification codes" ON cleaner_verification_codes;

CREATE POLICY "System can delete verification codes"
  ON cleaner_verification_codes FOR DELETE
  USING (true);
