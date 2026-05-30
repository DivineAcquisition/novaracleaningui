-- ─── Apploye integration ────────────────────────────────────────────────
-- Adds cleaners.apploye_member_id link + secrets placeholders so the
-- admin can drop their API key in via SQL or the Cursor Cloud-Agent
-- secrets UI without another migration.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS apploye_member_id    text,
  ADD COLUMN IF NOT EXISTS apploye_invited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS apploye_last_ping_at timestamptz,
  ADD COLUMN IF NOT EXISTS apploye_last_lat     numeric(10,7),
  ADD COLUMN IF NOT EXISTS apploye_last_lng     numeric(10,7);

CREATE INDEX IF NOT EXISTS cleaners_apploye_member_idx
  ON public.cleaners (apploye_member_id)
  WHERE apploye_member_id IS NOT NULL;

-- Seed empty rows in app_secrets so it's obvious to ops which keys are
-- expected. UPSERT keeps existing values untouched.
INSERT INTO public.app_secrets (key, value, description)
VALUES
  ('APPLOYE_API_KEY', '', 'Apploye personal API token (Bearer). Issued from Apploye Settings → API.'),
  ('APPLOYE_WORKSPACE_ID', '', 'Numeric workspace id from Apploye. Required by every API call.'),
  ('APPLOYE_API_BASE', '', 'Optional override of the Apploye API base URL. Defaults to https://www.apploye.com/api/v1 if blank.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
