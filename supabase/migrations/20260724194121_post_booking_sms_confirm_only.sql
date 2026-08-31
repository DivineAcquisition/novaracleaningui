-- ─── Post-booking welcome SMS: fire on confirm only ─────────────────────
--
-- bookings_auto_send_post_booking_sms fired on the transition into
-- `confirmed` OR `completed`. A recurring occurrence is a brand-new
-- bookings row (fresh post_confirm_ghl_sms_sent = false), so when the crew
-- finished the job the completed transition dispatched the first-time
-- welcome/referral text to a months-long member (NVC-0022, Laure).
--
-- The welcome text belongs to the start of a booking, never the end, so
-- both the trigger's WHEN clause and the function's own guard now accept
-- `confirmed` only. send-post-booking-sms additionally refuses returning
-- customers and any booking whose service already happened.

CREATE OR REPLACE FUNCTION public.auto_send_post_booking_sms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  supabase_url TEXT;
  anon_key     TEXT;
BEGIN
  -- Only fire when the booking has just been confirmed and we haven't
  -- already sent the SMS for this row. Completion is deliberately excluded:
  -- a welcome text after the clean is finished is always wrong.
  IF NEW.post_confirm_ghl_sms_sent IS TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  -- For UPDATE, only fire on the transition INTO confirmed.
  -- (For INSERT-direct path, OLD is the same row with stale defaults.)
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.post_confirm_ghl_sms_sent IS NOT DISTINCT FROM NEW.post_confirm_ghl_sms_sent THEN
    RETURN NEW;
  END IF;

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
      url := supabase_url || '/functions/v1/send-post-booking-sms',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := jsonb_build_object('bookingId', NEW.id::text, 'trigger', 'pg_trigger_post_confirm'),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_send_post_booking_sms pg_net dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS bookings_auto_send_post_booking_sms ON public.bookings;
CREATE TRIGGER bookings_auto_send_post_booking_sms
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION public.auto_send_post_booking_sms();
