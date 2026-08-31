-- ─── Day-before appointment reminder: hourly retry window ───────────────────
--
-- send-appointment-reminders used to run ONCE a day (16:00 UTC). If the SMS
-- provider hiccuped on that single attempt, the booking never got its
-- day-before reminder (no retry) — observed on a 2026-07-10 booking whose
-- appointment_reminder_sent_at stayed null. The sweep is idempotent (stamps
-- appointment_reminder_sent_at atomically), so run it hourly from 14:00–23:00
-- UTC (10am–7pm ET): first success stamps the row, later runs no-op, and any
-- failed send retries the next hour.

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

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-appointment-reminders';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('send-appointment-reminders');
  END IF;

  PERFORM cron.schedule(
    'send-appointment-reminders',
    '0 14-23 * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/send-appointment-reminders',
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
  RAISE NOTICE 'Skipping send-appointment-reminders reschedule: %', SQLERRM;
END $$;
