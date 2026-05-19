-- Defense-in-depth: auto-promote bookings to 'confirmed' the instant
-- both gates pass, regardless of whether the client successfully
-- invoked the finalize-booking Edge Function.
--
-- Why a DB trigger when finalize-booking exists?
--   • The client invokes finalize-booking fire-and-forget after the
--     home-detail UPDATE. Browsers occasionally drop the POST (cold
--     start, navigation race, network blip).
--   • Without this trigger, those bookings get stuck at
--     'pending_details' until the 5-min cron sweeps them up, which
--     is too long for a customer staring at the confirmation page.
--
-- What this trigger does:
--   • Fires BEFORE UPDATE on bookings.
--   • If the new row has BOTH (a) payment_received_at OR uses_credit
--     AND (b) every required home-detail field filled, AND (c) the
--     current status is 'pending_details' or 'pending_payment',
--     flip NEW.status to 'confirmed' and stamp confirmed_at.
--   • Then enqueue a fire-and-forget HTTP call to the finalize-
--     booking Edge Function via pg_net so the downstream side effects
--     (confirmation email, Telnyx SMS, auto-dispatch, Google Calendar)
--     still run. finalize-booking is idempotent — it'll see status
--     already = 'confirmed' and short-circuit on duplicate calls.
--
-- This is intentionally a "soft" guard: the status promotion is
-- synchronous (NEW.status = 'confirmed' before commit), the side-
-- effect dispatch is async (pg_net schedules a background HTTP POST
-- after commit). The customer sees their confirmation page flip from
-- "Finalizing" to "Confirmed" within milliseconds; the email lands
-- a few seconds later.

CREATE OR REPLACE FUNCTION public.auto_finalize_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  has_payment    boolean;
  has_details    boolean;
  supabase_url   text;
  anon_key       text;
BEGIN
  -- Only react to status / detail / payment_received_at changes — keeps
  -- the trigger cheap on incidental column updates.
  IF (NEW.status IS NOT DISTINCT FROM OLD.status)
     AND (NEW.payment_received_at IS NOT DISTINCT FROM OLD.payment_received_at)
     AND (NEW.address IS NOT DISTINCT FROM OLD.address)
     AND (NEW.city IS NOT DISTINCT FROM OLD.city)
     AND (NEW.state IS NOT DISTINCT FROM OLD.state)
     AND (NEW.bedrooms IS NOT DISTINCT FROM OLD.bedrooms)
     AND (NEW.bathrooms IS NOT DISTINCT FROM OLD.bathrooms)
     AND (NEW.dwelling_type IS NOT DISTINCT FROM OLD.dwelling_type) THEN
    RETURN NEW;
  END IF;

  -- Already finalized / cancelled? Hands off.
  IF NEW.status NOT IN ('pending_payment', 'pending_details', 'booked') THEN
    RETURN NEW;
  END IF;

  has_payment := COALESCE(NEW.uses_credit, false)
                 OR NEW.payment_received_at IS NOT NULL;
  has_details := NEW.address IS NOT NULL AND NEW.address <> ''
                 AND NEW.city  IS NOT NULL AND NEW.city  <> ''
                 AND NEW.state IS NOT NULL AND NEW.state <> ''
                 AND NEW.bedrooms IS NOT NULL
                 AND NEW.bathrooms IS NOT NULL
                 AND NEW.dwelling_type IS NOT NULL AND NEW.dwelling_type <> '';

  IF NOT has_payment OR NOT has_details THEN
    -- One gate still open. If payment arrived but details are missing,
    -- nudge the status so the dashboards / cron pick this up. We do
    -- NOT call finalize-booking here.
    IF has_payment AND NOT has_details AND NEW.status = 'pending_payment' THEN
      NEW.status := 'pending_details';
    END IF;
    RETURN NEW;
  END IF;

  -- Both gates pass — promote NEW.status to 'confirmed' synchronously
  -- so the row reads as confirmed the moment this UPDATE commits.
  NEW.status := 'confirmed';
  IF NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := now();
  END IF;

  -- Best-effort async dispatch of finalize-booking for the side
  -- effects. We use pg_net's http_post which queues the call and
  -- returns immediately — so this never blocks the customer's UPDATE.
  -- Wrap in BEGIN/EXCEPTION so the trigger is bulletproof: if pg_net
  -- isn't installed or the secret is missing, we still let the
  -- confirmed status commit.
  BEGIN
    supabase_url := current_setting('app.settings.supabase_url', true);
    anon_key     := current_setting('app.settings.supabase_anon_key', true);

    -- Fall back to hardcoded project URL + anon key when the GUCs
    -- aren't configured (we don't rely on session-level settings in
    -- this Supabase project).
    IF supabase_url IS NULL OR supabase_url = '' THEN
      supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
    END IF;
    IF anon_key IS NULL OR anon_key = '' THEN
      anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I';
    END IF;

    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/finalize-booking',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := jsonb_build_object(
        'bookingId', NEW.id::text,
        'trigger',  'pg_trigger_auto_finalize'
      ),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never fail the UPDATE on a side-effect dispatch error.
    RAISE NOTICE 'auto_finalize_booking pg_net dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_auto_finalize_trigger ON public.bookings;
CREATE TRIGGER bookings_auto_finalize_trigger
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_finalize_booking();
