-- Job offer expiry sweep (10-minute accept/decline window) + dedicated SMS from-number.

INSERT INTO public.app_secrets (key, value, description)
VALUES
  (
    'GHL_JOB_OFFER_SMS_FROM_NUMBER',
    '+14432744402',
    'E.164 number used exclusively for auto-dispatch job offers to cleaners (LeadConnector).'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  value = CASE
    WHEN public.app_secrets.value IS NULL OR public.app_secrets.value = '' THEN EXCLUDED.value
    ELSE public.app_secrets.value
  END;

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

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'expire-job-offers';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('expire-job-offers');
  END IF;

  -- Every 2 minutes — closes the 10-minute offer window promptly.
  PERFORM cron.schedule(
    'expire-job-offers',
    '*/2 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/expire-job-offers',
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
