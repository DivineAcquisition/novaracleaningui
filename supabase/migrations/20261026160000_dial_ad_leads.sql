-- Dial new Facebook and LSA leads with the outbound AI assistant.
-- The function itself only places calls from 8:00 AM to 8:00 PM Eastern.
-- This schedule covers that window in both Eastern standard and daylight time.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dial-ad-leads') THEN
    PERFORM cron.unschedule('dial-ad-leads');
  END IF;
  PERFORM cron.schedule(
    'dial-ad-leads',
    '*/2 * * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_URL') || '/functions/v1/dial-ad-leads',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce((SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY'), ''),
          'x-cron-secret', coalesce((SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET'), '')
        ),
        body := jsonb_build_object('source', 'pg_cron')
      )
      WHERE (EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/New_York')))::int BETWEEN 8 AND 19;
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — dial-ad-leads not scheduled.';
END $$;
