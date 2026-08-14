-- Switch the ad spend log from weekly to monthly.
-- Cron: 1st of each month 11:00 UTC ≈ 7:00 AM America/New_York in summer.
-- Unused weekly tokens are expired so the earlier catch-up links stop working.

UPDATE public.app_settings
SET
  value = COALESCE(value, '{}'::jsonb) || jsonb_build_object(
    'cadence', 'monthly',
    'operations_start', '2026-05-01'
  ),
  description = 'Monthly ad spend log: 1st of the month ~7am ET covering the prior calendar month. Recipients get a tokenized form; submit writes pl_ad_spend → Google Sheet + Airtable.'
WHERE key = 'ad_spend_form_settings';

UPDATE public.ad_spend_form_tokens
SET
  status = 'expired',
  expires_at = now()
WHERE status = 'pending'
  AND (period_end - period_start) = 6;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN ('ad-spend-form-weekly', 'ad-spend-form-monthly');

    PERFORM cron.schedule(
      'ad-spend-form-monthly',
      '0 11 1 * *',
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
  RAISE NOTICE 'Skipping ad-spend-form-monthly cron schedule: %', SQLERRM;
END $$;
