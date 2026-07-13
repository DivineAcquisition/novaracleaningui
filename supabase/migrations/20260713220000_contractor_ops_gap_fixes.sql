-- ─── Contractor ↔ operations gap fixes ───────────────────────────────────────
--
-- Completion-approved notification: when the office finalizes a cleaner-
-- submitted job (pending_review → completed), the cleaner previously
-- learned about it only by inference. This trigger fires the
-- notify-completion-approved edge function on that exact transition,
-- which texts every assigned crew member (idempotent via the events log).

CREATE OR REPLACE FUNCTION public.notify_cleaner_completion_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  supabase_url TEXT;
  anon_key     TEXT;
BEGIN
  -- Only the pending_review → completed transition (the "office approved
  -- the cleaner's submission" moment).
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status <> 'completed' OR OLD.status <> 'pending_review' THEN RETURN NEW; END IF;

  BEGIN
    supabase_url := current_setting('app.settings.supabase_url', true);
    anon_key     := current_setting('app.settings.supabase_anon_key', true);
    IF supabase_url IS NULL OR supabase_url = '' THEN
      supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
    END IF;
    IF anon_key IS NULL OR anon_key = '' THEN
      anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I';
    END IF;

    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/notify-completion-approved',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := jsonb_build_object('bookingId', NEW.id::text, 'trigger', 'pg_trigger_completion_approved'),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify_cleaner_completion_approved pg_net dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_cleaner_completion_approved ON public.bookings;
CREATE TRIGGER trg_notify_cleaner_completion_approved
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_cleaner_completion_approved();
