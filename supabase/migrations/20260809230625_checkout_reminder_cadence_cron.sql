-- Abandoned public-checkout reminders (send-booking-reminder).
-- Cadence is enforced inside the function (idempotent via booking_emails_sent):
--   10 minutes → 2 hours (business ops ET) → next day ~12 PM ET → ~2 days
-- Sweep every 15 minutes so the noon ET band is reliably hit.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_anon_key text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;

  SELECT value INTO v_anon_key FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY';
  IF v_anon_key IS NULL OR length(v_anon_key) = 0 THEN
    -- Fallback matches other checked-in cron migrations for this project.
    v_anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I';
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-booking-reminders';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('send-booking-reminders');
  END IF;

  PERFORM cron.schedule(
    'send-booking-reminders',
    '*/15 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/send-booking-reminder',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      v_anon_key
    )
  );
END $$;

NOTIFY pgrst, 'reload schema';
