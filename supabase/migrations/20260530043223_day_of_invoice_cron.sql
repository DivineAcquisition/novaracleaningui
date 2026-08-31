-- ─── Day-of remaining-balance invoice cron ──────────────────────────────
-- Every morning at 7:30 AM ET / 11:30 UTC the cron sweep posts to the
-- `send-remaining-day-of` edge function, which finds confirmed deposit-
-- paid bookings happening today and triggers the remaining-balance
-- invoice via send-remaining-balance-invoice. This implements the new
-- "second invoice on the day of service" cadence the operator asked for.
--
-- This migration is idempotent — re-running it just refreshes the
-- schedule entry.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_service_role text;
BEGIN
  -- Pull the host + key from app_secrets (set by the env-setup agent).
  -- Fall back to the well-known supabase.co URL if the override is
  -- missing so the cron can still call out.
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';

  -- Drop any previous schedule so we don't accumulate dupes.
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'send-remaining-day-of';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('send-remaining-day-of');
  END IF;

  -- 11:30 UTC daily = 7:30 AM ET (EDT) / 6:30 AM ET (EST). Operator can
  -- adjust later if a different cutover time is preferred.
  PERFORM cron.schedule(
    'send-remaining-day-of',
    '30 11 * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/send-remaining-day-of',
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
