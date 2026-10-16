-- Booking portal compliance records.
-- Acceptance rows are insert-only. Wording bodies are insert-only.
-- Cookie choices are a separate table and are not dispute evidence.

CREATE TABLE IF NOT EXISTS public.compliance_wording_versions (
  id text PRIMARY KEY,
  kind text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed')),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE TABLE IF NOT EXISTS public.compliance_acceptances (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  action text NOT NULL DEFAULT 'accepted' CHECK (action IN ('accepted', 'withdrawn')),
  wording_version_id text NOT NULL,
  wording_version integer NOT NULL,
  wording_status text NOT NULL,
  wording_shown text NOT NULL,
  accepted_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  device_time_zone text,
  ip text,
  user_agent text,
  person_name text,
  email text,
  phone text,
  booking_id text,
  agreement_id text,
  charge_id text,
  relationship text,
  property_label text,
  amount_basis text,
  surface text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_acceptances_booking_idx
  ON public.compliance_acceptances (booking_id);
CREATE INDEX IF NOT EXISTS compliance_acceptances_email_idx
  ON public.compliance_acceptances (lower(email));

CREATE TABLE IF NOT EXISTS public.compliance_cookie_choices (
  id uuid PRIMARY KEY,
  essential boolean NOT NULL DEFAULT true,
  analytics boolean NOT NULL DEFAULT false,
  advertising boolean NOT NULL DEFAULT false,
  gpc boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  banner_version text NOT NULL,
  chosen_at timestamptz NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.compliance_data_requests (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  kind text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  due_on date NOT NULL,
  retained_because text,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.compliance_settings (
  id text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.compliance_sms_suppressions (
  phone_digits text PRIMARY KEY,
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  source text,
  lifted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.compliance_access_views (
  id uuid PRIMARY KEY,
  booking_id text,
  viewer_role text NOT NULL,
  viewer_id text,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  purpose text
);

CREATE TABLE IF NOT EXISTS public.compliance_signed_copies (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  booking_id text
);

CREATE OR REPLACE FUNCTION public.compliance_acceptances_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'acceptance records cannot be edited';
END;
$$;

DROP TRIGGER IF EXISTS compliance_acceptances_no_update ON public.compliance_acceptances;
CREATE TRIGGER compliance_acceptances_no_update
  BEFORE UPDATE OR DELETE ON public.compliance_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.compliance_acceptances_immutable();

CREATE OR REPLACE FUNCTION public.compliance_wording_body_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.body IS DISTINCT FROM NEW.body OR OLD.kind IS DISTINCT FROM NEW.kind OR OLD.version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'wording body cannot be edited; publish a new version';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compliance_wording_body_no_edit ON public.compliance_wording_versions;
CREATE TRIGGER compliance_wording_body_no_edit
  BEFORE UPDATE ON public.compliance_wording_versions
  FOR EACH ROW EXECUTE FUNCTION public.compliance_wording_body_immutable();

ALTER TABLE public.compliance_wording_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_cookie_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_sms_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_access_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_signed_copies ENABLE ROW LEVEL SECURITY;

-- Service role writes from the Next API. Admins read through that API.
-- No anon policies: these rows are not public.

REVOKE ALL ON FUNCTION public.compliance_acceptances_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compliance_wording_body_immutable() FROM PUBLIC, anon, authenticated;
