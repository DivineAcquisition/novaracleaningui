-- Unpaid deposit reminders (30m → 2h → next day + 2h) then auto-cancel.
-- pending_deposit_started_at anchors the window so a reinstated booking
-- gets a fresh cycle instead of being cancelled again immediately.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pending_deposit_started_at timestamptz;

COMMENT ON COLUMN public.bookings.pending_deposit_started_at IS
  'Anchor for unpaid-deposit reminder + auto-cancel. Null means created_at. Reset when an admin/VA reinstates.';

CREATE INDEX IF NOT EXISTS bookings_pending_deposit_idx
  ON public.bookings (status, created_at)
  WHERE status = 'pending_payment';

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
    v_anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I';
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'pending-deposit-reminders';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('pending-deposit-reminders');
  END IF;

  PERFORM cron.schedule(
    'pending-deposit-reminders',
    '*/15 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/pending-deposit-reminders',
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
