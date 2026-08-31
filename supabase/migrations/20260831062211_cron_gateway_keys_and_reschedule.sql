-- pg_cron for walkthrough/COI/proposal sweeps was scheduled with empty Bearer
-- headers when SUPABASE_ANON_KEY / SUPABASE_URL were not in app_secrets.
-- Store the project URL, copy the same legacy anon JWT already used by
-- pending-deposit-reminders if present, then reschedule the three jobs to
-- look the keys up at runtime.

INSERT INTO public.app_secrets (key, value, description)
VALUES (
  'SUPABASE_URL',
  'https://sxdraeptzuamsgjcvfeg.supabase.co',
  'Project API URL used by pg_cron to invoke Edge Functions'
)
ON CONFLICT (key) DO UPDATE
SET value = CASE
      WHEN btrim(COALESCE(public.app_secrets.value, '')) = '' THEN EXCLUDED.value
      ELSE public.app_secrets.value
    END,
    description = COALESCE(NULLIF(public.app_secrets.description, ''), EXCLUDED.description),
    updated_at = now();

INSERT INTO public.app_secrets (key, value, description)
SELECT
  'SUPABASE_ANON_KEY',
  substring(j.command FROM $$coalesce\('([^']+)'::text$$),
  'Legacy anon JWT for pg_cron Authorization headers (gateway only)'
FROM cron.job j
WHERE j.jobname = 'pending-deposit-reminders'
  AND substring(j.command FROM $$coalesce\('([^']+)'::text$$) IS NOT NULL
ON CONFLICT (key) DO UPDATE
SET value = CASE
      WHEN btrim(COALESCE(public.app_secrets.value, '')) = '' THEN EXCLUDED.value
      ELSE public.app_secrets.value
    END,
    updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'walkthrough-pipeline-sweep') THEN
    PERFORM cron.unschedule('walkthrough-pipeline-sweep');
  END IF;
  PERFORM cron.schedule(
    'walkthrough-pipeline-sweep',
    '20 * * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_URL') || '/functions/v1/walkthrough-pipeline-sweep',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce((SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY'), '')
        ),
        body := jsonb_build_object('source', 'pg_cron')
      );
    $cron$
  );

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coi-expiry-monitor') THEN
    PERFORM cron.unschedule('coi-expiry-monitor');
  END IF;
  PERFORM cron.schedule(
    'coi-expiry-monitor',
    '0 13 * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_URL') || '/functions/v1/coi-expiry-monitor',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce((SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY'), '')
        ),
        body := jsonb_build_object('source', 'pg_cron')
      );
    $cron$
  );

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'commercial-proposal-sweep') THEN
    PERFORM cron.unschedule('commercial-proposal-sweep');
  END IF;
  PERFORM cron.schedule(
    'commercial-proposal-sweep',
    '40 * * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_URL') || '/functions/v1/commercial-proposal-sweep',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce((SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY'), '')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — commercial sweep jobs not rescheduled.';
END $$;
