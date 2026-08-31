-- ─── Contractor GHL sync prep + phone-OTP table cleanup ─────────────────
--
-- Adds:
--   * cleaner_verification_codes.phone     canonical phone-OTP column
--                                          (legacy rows stored phone in
--                                          the misnamed `email` column)
--   * cleaners.ghl_synced_at + ghl_sync_error  sync-state tracking
--   * app_secrets stubs for the contractor GHL pipeline (empty by
--     default — sync-cleaner-to-ghl no-ops opportunity portion when
--     unset). User fills in via SQL after running ghl-discover.
--
-- Companion DB trigger applied via auto_sync_cleaner_to_ghl_trigger
-- migration: cleaners_auto_sync_to_ghl fires sync-cleaner-to-ghl on
-- every sync-worthy column change via pg_net.

ALTER TABLE public.cleaner_verification_codes
  ADD COLUMN IF NOT EXISTS phone TEXT;

UPDATE public.cleaner_verification_codes
  SET phone = email
  WHERE phone IS NULL
    AND email ~ '^(\+?\d{10,15})$';

CREATE INDEX IF NOT EXISTS cleaner_verification_codes_phone_idx
  ON public.cleaner_verification_codes (phone, created_at DESC);

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS ghl_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghl_sync_error TEXT;

INSERT INTO public.app_secrets (key, value, description) VALUES
  ('GHL_CONTRACTOR_PIPELINE_ID',                '', 'GoHighLevel pipeline ID for contractors. When empty, contact upsert + tags still fire but no opportunity is created/updated.'),
  ('GHL_CONTRACTOR_PIPELINE_STAGE_APPLICANT',   '', 'Stage ID for newly signed up contractors.'),
  ('GHL_CONTRACTOR_PIPELINE_STAGE_ONBOARDING',  '', 'Stage ID for contractors progressing through profile + portal.'),
  ('GHL_CONTRACTOR_PIPELINE_STAGE_ACTIVE',      '', 'Stage ID for contractors with payouts enabled + compliance current.'),
  ('GHL_CONTRACTOR_PIPELINE_STAGE_INACTIVE',    '', 'Stage ID for deactivated / terminated contractors.'),
  ('GHL_CONTRACTOR_SMS_NUMBER_ID',              '', 'Optional override: GHL phone number ID for contractor-facing SMS (OTP, post-onboarding). Falls back to GHL_DEFAULT_SMS_NUMBER_ID.')
ON CONFLICT (key) DO NOTHING;

-- Full DDL for auto_sync_cleaner_to_ghl trigger function applied via
-- supabase MCP. See migration history.

COMMENT ON COLUMN public.cleaner_verification_codes.phone IS
  'E.164 phone for phone-OTP rows. Use this instead of the legacy email column for new rows.';
COMMENT ON COLUMN public.cleaners.ghl_synced_at IS
  'Last successful sync-cleaner-to-ghl run (contact upsert + tags + custom fields).';
