-- Post-completion cleaner rating SMS — 2 hours after mark complete.
-- Runs every 15 minutes and posts to send-rating-reminders.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_service_role text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-rating-reminders';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('send-rating-reminders');
  END IF;

  PERFORM cron.schedule(
    'send-rating-reminders',
    '*/15 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/send-rating-reminders',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      v_service_role
    )
  );
END $$;

NOTIFY pgrst, 'reload schema';
