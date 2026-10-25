-- Indeed application links run every 2 hours during business operations,
-- 9:00 AM through 7:30 PM Eastern. The last run in that window is 7:00 PM.
-- pg_cron has no timezone argument, so the job wakes on the UTC hours that
-- match those local hours in both standard time and daylight time, and the
-- command only calls the route when the Eastern hour is 9, 11, 1, 3, 5, or 7.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'indeed-application-links') THEN
    PERFORM cron.unschedule('indeed-application-links');
  END IF;
  PERFORM cron.schedule(
    'indeed-application-links',
    '0 0,13,14,15,16,17,18,19,20,21,22,23 * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://app.novaracleaning.com/api/cron/indeed-application-links',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce((SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET'), '')
        ),
        body := '{}'::jsonb
      )
      WHERE (EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/New_York')))::int IN (9, 11, 13, 15, 17, 19);
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — indeed-application-links not scheduled.';
END $$;
