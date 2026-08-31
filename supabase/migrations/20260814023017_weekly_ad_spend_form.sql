-- Weekly tokenized ad-spend log.
--
-- Founder/ops fills one Mon–Sun form per paid channel (Facebook, LSA, Google,
-- Instagram, optional Other). Submit upserts public.pl_ad_spend (system of
-- record). pl-sheet-sync mirrors the Ad Spend tab; Airtable "Ad Spend Logs"
-- upserts on Period Start + Platform. The Monday weekly report then has real
-- spend instead of "unavailable".

CREATE UNIQUE INDEX IF NOT EXISTS pl_ad_spend_date_platform_uniq
  ON public.pl_ad_spend (date, platform);

CREATE TABLE IF NOT EXISTS public.ad_spend_form_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'expired')),
  submitted_at timestamptz,
  submitted_by_email text,
  sent_at timestamptz,
  sent_to text[],
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_start, period_end)
);

CREATE INDEX IF NOT EXISTS ad_spend_form_tokens_period_idx
  ON public.ad_spend_form_tokens (period_start DESC);

ALTER TABLE public.ad_spend_form_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_spend_form_tokens_admin_all ON public.ad_spend_form_tokens;
CREATE POLICY ad_spend_form_tokens_admin_all ON public.ad_spend_form_tokens
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS ad_spend_form_tokens_service_role ON public.ad_spend_form_tokens;
CREATE POLICY ad_spend_form_tokens_service_role ON public.ad_spend_form_tokens
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_ad_spend_form_tokens_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_ad_spend_form_tokens ON public.ad_spend_form_tokens;
CREATE TRIGGER trg_touch_ad_spend_form_tokens
  BEFORE UPDATE ON public.ad_spend_form_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_ad_spend_form_tokens_updated_at();

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'ad_spend_form_settings',
  jsonb_build_object(
    'enabled', true,
    'timezone', 'America/New_York',
    'recipients', jsonb_build_array('contact@novaracleaning.com', 'dispatch@novaracleaning.com'),
    'platforms', jsonb_build_array('Facebook', 'LSA', 'Google', 'Instagram'),
    'operations_start', '2026-05-18'
  ),
  'Weekly ad spend log: Monday 7am ET covering the prior Mon–Sun. Recipients get a tokenized form; submit writes pl_ad_spend → Google Sheet + Airtable.'
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    value = COALESCE(public.app_settings.value, '{}'::jsonb) || EXCLUDED.value;

INSERT INTO public.app_secrets (key, value, description)
VALUES
  (
    'AD_SPEND_PUBLIC_BASE_URL',
    'https://try.novaracleaning.com',
    'Public origin for the weekly ad spend form (/ad-spend/<token>).'
  ),
  (
    'AD_SPEND_FORM_SEND_URL',
    'https://admin.novaracleaning.com/api/ad-spend/send',
    'Next.js route that emails the weekly ad spend form.'
  ),
  (
    'AIRTABLE_AD_SPEND_TABLE',
    'Ad Spend Logs',
    'Airtable table in Client & Revenue Ops. Merge fields: Period Start + Platform.'
  )
ON CONFLICT (key) DO NOTHING;

-- Include the first-booking week on the P&L sheet (was 2026-06-01).
UPDATE public.app_secrets
SET value = '2026-05-18'
WHERE key = 'PL_SYNC_SINCE'
  AND (value IS NULL OR btrim(value) = '' OR value > '2026-05-18');

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES
  ('ad_spend.form.sent', 'DISCORD_WEBHOOK_URL', ARRAY['DISCORD_ROLE_OPERATIONS'], true),
  ('ad_spend.form.backfill_sent', 'DISCORD_WEBHOOK_URL', ARRAY['DISCORD_ROLE_OPERATIONS'], true),
  ('ad_spend.form.submitted', 'DISCORD_WEBHOOK_URL', ARRAY['DISCORD_ROLE_OPERATIONS'], true)
ON CONFLICT (event_type) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('ad-spend-form-weekly') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'ad-spend-form-weekly'
    );
    -- Monday 11:00 UTC ≈ 7:00 AM America/New_York in summer, before the
    -- 8am ET weekly report so last week's spend can land in the PDF.
    PERFORM cron.schedule(
      'ad-spend-form-weekly',
      '0 11 * * 1',
      $CRON$
        SELECT net.http_post(
          url := COALESCE(
            (SELECT value FROM public.app_secrets WHERE key = 'AD_SPEND_FORM_SEND_URL'),
            'https://admin.novaracleaning.com/api/ad-spend/send'
          ),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET')
          ),
          body := jsonb_build_object('action', 'send', 'source', 'pg_cron'),
          timeout_milliseconds := 120000
        );
      $CRON$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping ad-spend-form-weekly cron schedule: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
