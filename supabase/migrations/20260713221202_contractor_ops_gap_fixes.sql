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

-- ─── Crew-change notifications (notify-crew-change edge function) ───────────
--
-- Trigger-level wiring so EVERY ops path is covered — edge functions, the
-- dispatch board, manual SQL — not just the flows someone remembered to
-- patch:
--   1. job_assignments accepted-family → Withdrawn  ⇒ text the displaced
--      cleaner (reassignment used to be silent; they'd drive to the house).
--   2. bookings → cancelled                          ⇒ text the support crew
--      (refund-path cancels sent nothing; support crew NEVER got cancel SMS).
--   3. bookings.rescheduled_at changes               ⇒ text the support crew
--      (only the lead used to get the reschedule SMS).
--   4. events booking.manually_assigned (replace)    ⇒ withdraw stale
--      Confirmed/In-Progress rows for cleaners not in the new crew (they
--      used to stay "Confirmed" forever), which then fires #1 for them.

CREATE OR REPLACE FUNCTION public.notify_crew_change_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  supabase_url TEXT;
  anon_key     TEXT;
  payload      JSONB := NULL;
BEGIN
  IF TG_TABLE_NAME = 'job_assignments' THEN
    IF TG_OP = 'UPDATE'
       AND NEW.status = 'Withdrawn'
       AND OLD.status IN ('Confirmed', 'Accepted', 'In Progress', 'Assigned') THEN
      payload := jsonb_build_object('kind', 'withdrawn', 'assignmentId', NEW.id::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'bookings' THEN
    IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      payload := jsonb_build_object('kind', 'cancelled', 'bookingId', NEW.id::text);
    ELSIF TG_OP = 'UPDATE'
       AND NEW.rescheduled_at IS NOT NULL
       AND NEW.rescheduled_at IS DISTINCT FROM OLD.rescheduled_at THEN
      payload := jsonb_build_object('kind', 'rescheduled', 'bookingId', NEW.id::text);
    END IF;
  ELSIF TG_TABLE_NAME = 'events' THEN
    IF TG_OP = 'INSERT'
       AND NEW.event_type = 'booking.manually_assigned'
       AND coalesce(NEW.data->>'mode', '') = 'replace'
       AND NEW.job_id IS NOT NULL THEN
      payload := jsonb_build_object(
        'kind', 'reassign_cleanup',
        'jobId', NEW.job_id::text,
        'keepCleanerIds', coalesce(NEW.data->'cleanerIds', '[]'::jsonb)
      );
    END IF;
  END IF;

  IF payload IS NULL THEN RETURN NEW; END IF;

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
      url := supabase_url || '/functions/v1/notify-crew-change',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := payload,
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify_crew_change_dispatch pg_net failed: %', SQLERRM;
  END;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_crew_change_assignment_withdrawn ON public.job_assignments;
CREATE TRIGGER trg_crew_change_assignment_withdrawn
  AFTER UPDATE OF status ON public.job_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_crew_change_dispatch();

DROP TRIGGER IF EXISTS trg_crew_change_booking ON public.bookings;
CREATE TRIGGER trg_crew_change_booking
  AFTER UPDATE OF status, rescheduled_at ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_crew_change_dispatch();

DROP TRIGGER IF EXISTS trg_crew_change_reassign_cleanup ON public.events;
CREATE TRIGGER trg_crew_change_reassign_cleanup
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_crew_change_dispatch();
