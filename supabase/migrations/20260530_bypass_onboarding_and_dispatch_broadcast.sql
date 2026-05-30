-- ─── Bypass onboarding + dispatch broadcast support ────────────────────
--
-- Adds the columns the new admin "bypass onboarding" flow + the
-- dispatch broadcast fallback need. Strictly additive: nothing here
-- drops or renames existing data.

-- 1. cleaner_verification_codes — add cleaner_id link + consumed_at
--    (the existing table only has the email path; the new bypass flow
--    is keyed by cleaner_id so we can serve the code via /admin even
--    before the cleaner has an auth account).
ALTER TABLE public.cleaner_verification_codes
  ADD COLUMN IF NOT EXISTS cleaner_id   uuid REFERENCES public.cleaners(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS consumed     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consumed_at  timestamptz;

-- Backfill: any "used" row counts as consumed.
UPDATE public.cleaner_verification_codes SET consumed = true WHERE used = true AND consumed = false;

CREATE INDEX IF NOT EXISTS cleaner_verification_codes_cleaner_id_idx
  ON public.cleaner_verification_codes (cleaner_id, created_at DESC);

-- 2. job_assignments — allow new lifecycle statuses without breaking
--    legacy CHECK constraints (none today, but document the new states).
--    'Broadcast'       = sent to every active cleaner via the fallback
--    'Broadcast_Lost'  = retired siblings after another cleaner claimed
--    'Needs Reassignment' (existed) = cleaner deactivated, find another
--
-- We deliberately do NOT add a CHECK constraint here — dispatch + the
-- admin map both filter on enumerated values defensively.

-- 3. jobs.status — same idea; 'Broadcast' is now a legal value.
--    Leaving the column as text means no DDL change required.

NOTIFY pgrst, 'reload schema';
