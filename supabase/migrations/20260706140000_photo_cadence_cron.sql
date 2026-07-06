-- ─── Before/after photo cadence sweep (every 5 minutes) ─────────────────────
--
-- Schedules send-photo-cadence, which texts the assigned contractor:
--   • the BEFORE-photos upload link ~10 minutes before the scheduled start, and
--   • the AFTER-photos upload link ~10 minutes before the expected completion.
--
-- Runs every 5 minutes so each link lands ~5-10 minutes ahead of the moment it
-- is needed. Idempotent server-side via bookings.before_photo_link_sent_at /
-- after_photo_link_sent_at, so the tight cron cadence never double-texts.

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

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-photo-cadence';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('send-photo-cadence');
  END IF;

  PERFORM cron.schedule(
    'send-photo-cadence',
    '*/5 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/send-photo-cadence',
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
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping send-photo-cadence cron schedule: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
