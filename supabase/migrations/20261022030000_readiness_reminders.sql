-- Hourly sweep for "Not yet" onboarding reminders at the hours in intake settings.
-- The route refuses the call unless x-cron-secret matches CRON_SECRET.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'readiness-reminders') THEN
    PERFORM cron.unschedule('readiness-reminders');
  END IF;
  PERFORM cron.schedule(
    'readiness-reminders',
    '25 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://app.novaracleaning.com/api/cron/readiness-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce((SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET'), '')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — readiness-reminders not scheduled.';
END $$;
