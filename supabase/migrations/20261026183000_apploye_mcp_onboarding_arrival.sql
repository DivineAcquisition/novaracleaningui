-- Apploye MCP: link cleaners and VAs when they finish onboarding, and
-- record the Apploye clock against a check-in. The key itself is stored in
-- app_secrets (APPLOYE_MCP_API_KEY) and is not part of this migration.
--
-- Clock times only. Screenshots, app usage, and URL reports are not stored.

INSERT INTO public.app_secrets (key, value, description)
VALUES
  (
    'APPLOYE_MCP_API_KEY',
    '',
    'Apploye MCP key, sent as x-apploye-api-key. Links onboarded cleaners and VAs and reads clock-in/out plus tracked hours. Screenshots, app usage, and URL reports are never requested.'
  ),
  (
    'APPLOYE_MCP_URL',
    '',
    'Optional Apploye MCP URL. Defaults to https://mcp.apploye.com/mcp when blank.'
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS apploye_link_status text,
  ADD COLUMN IF NOT EXISTS apploye_link_checked_at timestamptz;

ALTER TABLE public.va_onboarding
  ADD COLUMN IF NOT EXISTS apploye_link_status text,
  ADD COLUMN IF NOT EXISTS apploye_link_checked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.cleaner_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arrival_key text NOT NULL UNIQUE,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  job_assignment_id uuid REFERENCES public.job_assignments(id) ON DELETE SET NULL,
  checked_in_at timestamptz NOT NULL,
  checked_out_at timestamptz,
  apploye_member_id text,
  apploye_status text NOT NULL,
  apploye_clock_in_at timestamptz,
  apploye_clock_out_at timestamptz,
  apploye_tracked_seconds integer,
  apploye_live boolean NOT NULL DEFAULT false,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_arrivals_status_check CHECK (
    apploye_status IN ('unavailable', 'unlinked', 'tracking', 'not_tracking', 'clocked_out')
  )
);

CREATE INDEX IF NOT EXISTS cleaner_arrivals_cleaner_idx
  ON public.cleaner_arrivals (cleaner_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS cleaner_arrivals_job_idx
  ON public.cleaner_arrivals (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cleaner_arrivals_booking_idx
  ON public.cleaner_arrivals (booking_id) WHERE booking_id IS NOT NULL;

ALTER TABLE public.cleaner_arrivals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleaner_arrivals_admin_read ON public.cleaner_arrivals;
CREATE POLICY cleaner_arrivals_admin_read
  ON public.cleaner_arrivals
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

REVOKE ALL ON public.cleaner_arrivals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cleaner_arrivals TO authenticated;

COMMENT ON TABLE public.cleaner_arrivals IS
  'Check-in joined to the Apploye clock for that visit. Duration only — no screenshots or activity data.';

-- Queue an Apploye edge call after commit. Failures never roll back the
-- onboarding row or the check-in that caused them.
CREATE OR REPLACE FUNCTION public.enqueue_apploye_http(target text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  url text;
  secret text;
  anon_key text;
BEGIN
  IF target NOT IN ('apploye-invite-cleaner', 'apploye-record-arrival') THEN
    RETURN;
  END IF;
  SELECT value INTO url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  SELECT value INTO secret FROM public.app_secrets WHERE key = 'CRON_SECRET';
  SELECT value INTO anon_key FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY';
  IF coalesce(btrim(url), '') = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(url, '/') || '/functions/v1/' || target,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(anon_key, ''),
      'x-cron-secret', coalesce(secret, '')
    ),
    body := coalesce(payload, '{}'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_apploye_http(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_apploye_http(text, jsonb) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_apploye_onboarding_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  became_complete boolean := false;
  became_active boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'cleaners' THEN
    IF NEW.apploye_member_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF coalesce(btrim(NEW.email), '') = '' THEN
      RETURN NEW;
    END IF;
    IF lower(coalesce(NEW.status, '')) IN ('terminated', 'inactive', 'resigned') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NOT (coalesce(NEW.onboarding_complete, false) OR lower(coalesce(NEW.status, '')) = 'active') THEN
        RETURN NEW;
      END IF;
    ELSE
      became_complete := coalesce(NEW.onboarding_complete, false)
        AND NOT coalesce(OLD.onboarding_complete, false);
      became_active := lower(coalesce(NEW.status, '')) = 'active'
        AND lower(coalesce(OLD.status, '')) IS DISTINCT FROM 'active';
      IF NOT became_complete AND NOT became_active THEN
        RETURN NEW;
      END IF;
    END IF;
    PERFORM public.enqueue_apploye_http('apploye-invite-cleaner', jsonb_build_object('cleanerId', NEW.id));
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'va_onboarding' THEN
    IF NEW.apploye_member_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('submitted', 'approved') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
    PERFORM public.enqueue_apploye_http('apploye-invite-cleaner', jsonb_build_object('vaId', NEW.id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_apploye_onboarding_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_apploye_onboarding_link() FROM anon, authenticated;

DROP TRIGGER IF EXISTS apploye_link_cleaner ON public.cleaners;
CREATE TRIGGER apploye_link_cleaner
  AFTER INSERT OR UPDATE OF onboarding_complete, status, email, apploye_member_id
  ON public.cleaners
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_apploye_onboarding_link();

DROP TRIGGER IF EXISTS apploye_link_va ON public.va_onboarding;
CREATE TRIGGER apploye_link_va
  AFTER INSERT OR UPDATE OF status, apploye_member_id
  ON public.va_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_apploye_onboarding_link();

CREATE OR REPLACE FUNCTION public.enqueue_apploye_arrival()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  in_progress boolean;
BEGIN
  IF TG_TABLE_NAME = 'job_assignments' THEN
    in_progress := lower(replace(coalesce(NEW.status, ''), '_', ' ')) = 'in progress';
    IF NOT in_progress OR NEW.cleaner_id IS NULL OR NEW.job_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND lower(replace(coalesce(OLD.status, ''), '_', ' ')) = 'in progress' THEN
      RETURN NEW;
    END IF;
    PERFORM public.enqueue_apploye_http(
      'apploye-record-arrival',
      jsonb_build_object('jobId', NEW.job_id, 'cleanerId', NEW.cleaner_id, 'assignmentId', NEW.id)
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'bookings' THEN
    IF NEW.check_in_time IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL)
       AND NEW.cleaner_id IS NOT NULL THEN
      PERFORM public.enqueue_apploye_http(
        'apploye-record-arrival',
        jsonb_build_object('bookingId', NEW.id, 'cleanerId', NEW.cleaner_id)
      );
    ELSIF NEW.check_out_time IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.check_out_time IS NULL) THEN
      PERFORM public.enqueue_apploye_http(
        'apploye-record-arrival',
        jsonb_build_object('checkout', true, 'bookingId', NEW.id)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.check_out_time IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.check_out_time IS NULL) THEN
      PERFORM public.enqueue_apploye_http(
        'apploye-record-arrival',
        jsonb_build_object('checkout', true, 'jobId', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_apploye_arrival() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_apploye_arrival() FROM anon, authenticated;

DROP TRIGGER IF EXISTS apploye_arrival_on_assignment ON public.job_assignments;
CREATE TRIGGER apploye_arrival_on_assignment
  AFTER INSERT OR UPDATE OF status
  ON public.job_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_apploye_arrival();

DROP TRIGGER IF EXISTS apploye_arrival_on_booking ON public.bookings;
CREATE TRIGGER apploye_arrival_on_booking
  AFTER INSERT OR UPDATE OF check_in_time, check_out_time
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_apploye_arrival();

DROP TRIGGER IF EXISTS apploye_checkout_on_job ON public.jobs;
CREATE TRIGGER apploye_checkout_on_job
  AFTER INSERT OR UPDATE OF check_out_time
  ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_apploye_arrival();

NOTIFY pgrst, 'reload schema';
