-- ─── 7-day photo retention sweep ────────────────────────────────────────────
-- Daily cron → purge-old-turnover-photos edge function, which deletes turnover
-- & cleaner job photos older than 7 days from Storage and blanks the dangling
-- URL arrays. Enforces the "photos auto-delete after 7 days" promise shown to
-- hosts in the portal.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_supabase_url text;
  v_service_role text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-old-turnover-photos') THEN
    PERFORM cron.unschedule('purge-old-turnover-photos');
  END IF;

  -- Daily at 09:10 UTC.
  PERFORM cron.schedule(
    'purge-old-turnover-photos',
    '10 9 * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/purge-old-turnover-photos',
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
