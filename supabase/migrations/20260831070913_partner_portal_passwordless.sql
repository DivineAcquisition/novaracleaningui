-- Partner Portal: passwordless sessions, mixed-account identity, admin-routed
-- requests, Section 9 cancel-fee columns, and a partner_portal QC channel.
-- Least-visibility: these tables are service-role only. Portal APIs scope by
-- the authenticated identity; partners never read each other.

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'partner_portal_settings',
  jsonb_build_object(
    'session_days', 30,
    'magic_link_minutes', 60,
    'handoff_minutes', 30
  ),
  'Passwordless partner portal: session persistence (default 30 days) and magic-link TTL.'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.partner_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_identities_email_chk CHECK (position('@' in email) > 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_identities_email_uniq
  ON public.partner_identities (lower(email));

CREATE TABLE IF NOT EXISTS public.partner_identity_hosts (
  identity_id uuid NOT NULL REFERENCES public.partner_identities(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES public.hosts(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, host_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_identity_hosts_host_uniq
  ON public.partner_identity_hosts (host_id);

CREATE TABLE IF NOT EXISTS public.partner_identity_accounts (
  identity_id uuid NOT NULL REFERENCES public.partner_identities(id) ON DELETE CASCADE,
  business_account_id uuid NOT NULL REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, business_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_identity_accounts_acct_uniq
  ON public.partner_identity_accounts (business_account_id);

CREATE TABLE IF NOT EXISTS public.partner_login_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  identity_id uuid REFERENCES public.partner_identities(id) ON DELETE SET NULL,
  purpose text NOT NULL DEFAULT 'magic_link'
    CHECK (purpose IN ('magic_link', 'onboarding_handoff')),
  host_id uuid REFERENCES public.hosts(id) ON DELETE SET NULL,
  business_account_id uuid REFERENCES public.business_accounts(id) ON DELETE SET NULL,
  onboarding_kind text CHECK (onboarding_kind IN ('host', 'commercial')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_login_tokens_email_idx
  ON public.partner_login_tokens (lower(email), created_at DESC);

CREATE TABLE IF NOT EXISTS public.partner_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  identity_id uuid NOT NULL REFERENCES public.partner_identities(id) ON DELETE CASCADE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_portal_sessions_identity_idx
  ON public.partner_portal_sessions (identity_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.partner_portal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid REFERENCES public.partner_identities(id) ON DELETE SET NULL,
  relationship text NOT NULL CHECK (relationship IN ('host', 'commercial')),
  kind text NOT NULL CHECK (kind IN (
    'additional_property',
    'additional_site',
    'additional_service',
    'schedule_change'
  )),
  host_id uuid REFERENCES public.hosts(id) ON DELETE SET NULL,
  business_account_id uuid REFERENCES public.business_accounts(id) ON DELETE SET NULL,
  business_site_id uuid REFERENCES public.business_sites(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_portal_requests_pending_idx
  ON public.partner_portal_requests (status, created_at DESC);

COMMENT ON TABLE public.partner_portal_requests IS
  'Admin-routed extra property/site/service/schedule requests. Never auto-priced or auto-added.';

ALTER TABLE public.turnover_requests
  ADD COLUMN IF NOT EXISTS cancel_fee_cents integer,
  ADD COLUMN IF NOT EXISTS cancel_fee_tier text,
  ADD COLUMN IF NOT EXISTS cancel_hours_out numeric,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.qc_issues
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS turnover_request_id uuid REFERENCES public.turnover_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES public.business_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_site_id uuid REFERENCES public.business_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_identity_id uuid REFERENCES public.partner_identities(id) ON DELETE SET NULL;

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_reported_via_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_reported_via_check
  CHECK (reported_via = ANY (ARRAY[
    'va'::text, 'admin'::text, 'cleaner_field'::text, 'system'::text,
    'customer'::text, 'partner_portal'::text
  ]));

ALTER TABLE public.partner_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_identity_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_identity_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_portal_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_identities' AND policyname='partner_identities_service') THEN
    CREATE POLICY partner_identities_service ON public.partner_identities FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_identity_hosts' AND policyname='partner_identity_hosts_service') THEN
    CREATE POLICY partner_identity_hosts_service ON public.partner_identity_hosts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_identity_accounts' AND policyname='partner_identity_accounts_service') THEN
    CREATE POLICY partner_identity_accounts_service ON public.partner_identity_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_login_tokens' AND policyname='partner_login_tokens_service') THEN
    CREATE POLICY partner_login_tokens_service ON public.partner_login_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_portal_sessions' AND policyname='partner_portal_sessions_service') THEN
    CREATE POLICY partner_portal_sessions_service ON public.partner_portal_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='partner_portal_requests' AND policyname='partner_portal_requests_service') THEN
    CREATE POLICY partner_portal_requests_service ON public.partner_portal_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.partner_identities TO service_role;
GRANT ALL ON public.partner_identity_hosts TO service_role;
GRANT ALL ON public.partner_identity_accounts TO service_role;
GRANT ALL ON public.partner_login_tokens TO service_role;
GRANT ALL ON public.partner_portal_sessions TO service_role;
GRANT ALL ON public.partner_portal_requests TO service_role;
REVOKE ALL ON public.partner_identities FROM anon, authenticated;
REVOKE ALL ON public.partner_identity_hosts FROM anon, authenticated;
REVOKE ALL ON public.partner_identity_accounts FROM anon, authenticated;
REVOKE ALL ON public.partner_login_tokens FROM anon, authenticated;
REVOKE ALL ON public.partner_portal_sessions FROM anon, authenticated;
REVOKE ALL ON public.partner_portal_requests FROM anon, authenticated;
