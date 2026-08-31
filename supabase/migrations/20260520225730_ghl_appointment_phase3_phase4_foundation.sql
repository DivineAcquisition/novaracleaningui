-- ─── PHASE 3 + 4 foundation, additive only ─────────────────────────────────
-- Adds: GHL appointment fields on bookings; Phase-3 cleaner metadata;
-- cleaner_schedule_exceptions; cleaner_flags; job_status_history;
-- events table for the activity feed; geocode cache; events_feed_v1 view.
-- No existing column / type / trigger / constraint is removed or altered.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS ghl_appointment_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_appointment_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_appointment_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghl_appointment_sync_error TEXT;
CREATE INDEX IF NOT EXISTS bookings_ghl_appointment_idx ON public.bookings(ghl_appointment_id) WHERE ghl_appointment_id IS NOT NULL;

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS home_address TEXT,
  ADD COLUMN IF NOT EXISTS home_city TEXT,
  ADD COLUMN IF NOT EXISTS home_state TEXT,
  ADD COLUMN IF NOT EXISTS pay_tier TEXT DEFAULT 'foundation',
  ADD COLUMN IF NOT EXISTS platform_fee_pct NUMERIC DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS net_rate_hr NUMERIC,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS background_check_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS background_check_date DATE,
  ADD COLUMN IF NOT EXISTS background_check_expires_at DATE,
  ADD COLUMN IF NOT EXISTS insurance_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS insurance_carrier TEXT,
  ADD COLUMN IF NOT EXISTS insurance_policy_number TEXT,
  ADD COLUMN IF NOT EXISTS insurance_expires_at DATE,
  ADD COLUMN IF NOT EXISTS max_jobs_per_day INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS weekly_schedule JSONB,
  ADD COLUMN IF NOT EXISTS customer_complaint_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS termination_reason TEXT,
  ADD COLUMN IF NOT EXISTS ghl_user_id TEXT,
  ADD COLUMN IF NOT EXISTS notes_internal TEXT;

CREATE INDEX IF NOT EXISTS cleaners_pay_tier_idx ON public.cleaners(pay_tier);
CREATE INDEX IF NOT EXISTS cleaners_bg_check_expires_idx ON public.cleaners(background_check_expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS cleaners_insurance_expires_idx ON public.cleaners(insurance_expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.cleaner_schedule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('day_off','sick','vacation','custom')),
  reason TEXT,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  UNIQUE (cleaner_id, exception_date)
);
CREATE INDEX IF NOT EXISTS cleaner_schedule_exceptions_date_idx ON public.cleaner_schedule_exceptions(exception_date);
CREATE INDEX IF NOT EXISTS cleaner_schedule_exceptions_cleaner_idx ON public.cleaner_schedule_exceptions(cleaner_id, exception_date);

CREATE TABLE IF NOT EXISTS public.cleaner_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  details TEXT,
  flagged_by UUID,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cleaner_flags_cleaner_idx ON public.cleaner_flags(cleaner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cleaner_flags_open_idx ON public.cleaner_flags(cleaner_id, resolved) WHERE resolved = FALSE;

CREATE TABLE IF NOT EXISTS public.job_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS job_status_history_job_idx ON public.job_status_history(job_id, changed_at);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_by TEXT CHECK (no_show_by IN ('customer','cleaner')),
  ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  zone TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  cleaner_id UUID REFERENCES public.cleaners(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  ghl_contact_id TEXT,
  source TEXT,
  summary TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_occurred_idx ON public.events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_lead_idx ON public.events(lead_id, occurred_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_customer_idx ON public.events(customer_id, occurred_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_booking_idx ON public.events(booking_id, occurred_at DESC) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_cleaner_idx ON public.events(cleaner_id, occurred_at DESC) WHERE cleaner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_type_idx ON public.events(event_type);
CREATE INDEX IF NOT EXISTS events_zone_idx ON public.events(zone) WHERE zone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  address_key TEXT PRIMARY KEY,
  lat NUMERIC,
  lng NUMERIC,
  formatted_address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  county TEXT,
  raw JSONB,
  geocoded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_days INTEGER NOT NULL DEFAULT 365
);
CREATE INDEX IF NOT EXISTS geocode_cache_zip_idx ON public.geocode_cache(zip) WHERE zip IS NOT NULL;

CREATE OR REPLACE VIEW public.events_feed_v1 AS
SELECT
  e.id,
  e.event_type,
  e.occurred_at,
  e.zone,
  e.summary,
  e.lead_id,
  e.customer_id,
  e.booking_id,
  e.cleaner_id,
  e.job_id,
  COALESCE(
    NULLIF(l.first_name || ' ' || COALESCE(l.last_name, ''), ' '),
    NULLIF(c.first_name || ' ' || COALESCE(c.last_name, ''), ' '),
    b.email
  ) AS contact_name,
  COALESCE(l.phone, c.phone, b.phone) AS contact_phone,
  cl.first_name || ' ' || COALESCE(cl.last_name, '') AS cleaner_name,
  e.data
FROM public.events e
LEFT JOIN public.leads l ON l.id = e.lead_id
LEFT JOIN public.customers c ON c.id = e.customer_id
LEFT JOIN public.bookings b ON b.id = e.booking_id
LEFT JOIN public.cleaners cl ON cl.id = e.cleaner_id;

COMMENT ON TABLE public.events IS 'Phase-4 activity feed source. Every booking, SMS, status change, lead update writes one row here for the VA dashboard subscription.';
COMMENT ON COLUMN public.bookings.ghl_appointment_id IS 'GHL Calendars API appointment id. Set on first sync; reused for reschedule + cancel.';
COMMENT ON COLUMN public.cleaners.pay_tier IS 'Phase-3 pay tier: foundation | proven | elite. Foundation defaults: hourly_rate $18, platform_fee_pct 10, net_rate $16.20.';

-- Cron: reconcile GHL appointments every 5 min for confirmed bookings
-- in the next 30 days that are missing the GHL appointment or have a
-- prior sync error.
DO $$
BEGIN
  PERFORM cron.unschedule('reconcile-ghl-appointments-every-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-ghl-appointments-every-5min');
  PERFORM cron.schedule(
    'reconcile-ghl-appointments-every-5min',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/reconcile-ghl-appointments',
        headers := jsonb_build_object('Content-Type','application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cron$
  );
END $$;
