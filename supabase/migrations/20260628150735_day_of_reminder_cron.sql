-- Day-of (~30 min before arrival) reminder sweep.
-- Runs every 15 minutes and posts to send-day-of-reminders, which texts both
-- the customer and the assigned contractor when the booking's arrival window
-- is ~30 minutes out (idempotent via bookings.day_of_reminder_sent_at).

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

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-day-of-reminders';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('send-day-of-reminders');
  END IF;

  PERFORM cron.schedule(
    'send-day-of-reminders',
    '*/15 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/send-day-of-reminders',
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
