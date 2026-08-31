-- Tokenized walkthrough rows + client portal account on business_accounts.
--
-- Official commercial pipeline files were later applied on hosted under
-- 20260831060614 … 20260831061550. CREATE / ADD COLUMN IF NOT EXISTS so
-- those files can still run without colliding.

ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS portal_user_id uuid,
  ADD COLUMN IF NOT EXISTS portal_created_at timestamptz;

COMMENT ON COLUMN public.business_accounts.portal_user_id IS
  'auth.users id for the client portal login. Required before a commercial proposal can be sent.';

CREATE UNIQUE INDEX IF NOT EXISTS business_accounts_portal_user_uniq
  ON public.business_accounts (portal_user_id)
  WHERE portal_user_id IS NOT NULL;

ALTER TABLE public.business_sites
  ADD COLUMN IF NOT EXISTS facility_type_key text,
  ADD COLUMN IF NOT EXISTS scope_level text,
  ADD COLUMN IF NOT EXISTS firm_price_cents integer,
  ADD COLUMN IF NOT EXISTS recommended_crew_size integer,
  ADD COLUMN IF NOT EXISTS walkthrough_id uuid,
  ADD COLUMN IF NOT EXISTS pricing_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS exclusion_code text,
  ADD COLUMN IF NOT EXISTS exclusion_note text;

CREATE TABLE IF NOT EXISTS public.commercial_walkthroughs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  business_site_id uuid NOT NULL REFERENCES public.business_sites(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'scheduled', 'conducted', 'priced', 'excluded', 'cancelled')),
  scheduled_for date,
  scheduled_at timestamptz,
  conducted_on date,
  conducted_at timestamptz,
  conducted_by text,
  conducted_by_user_id uuid,
  facility_type_key text,
  scope_level text,
  sqft integer,
  condition_level text
    CHECK (condition_level IS NULL OR condition_level IN ('good', 'average', 'poor', 'severe')),
  obstacles text,
  special_equipment text,
  restroom_count integer,
  breakroom_count integer,
  floor_count integer,
  floor_types text,
  obstacle_density text
    CHECK (obstacle_density IS NULL OR obstacle_density IN ('low', 'moderate', 'high', 'severe')),
  security_complexity text,
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  formula_price_cents integer,
  estimate_low_cents integer,
  estimate_high_cents integer,
  firm_price_cents integer,
  recommended_crew_size integer,
  request_reason text,
  requested_by uuid,
  requested_by_name text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  client_stated_sqft integer,
  client_stated_facility_type text,
  site_address text,
  access_contact_name text,
  access_contact_phone text,
  access_contact_email text,
  conductor_user_id uuid,
  conductor_email text,
  conductor_phone text,
  client_access_confirmed boolean NOT NULL DEFAULT false,
  reminder_sent_at timestamptz,
  badge_required boolean,
  alarm_code text,
  loading_dock_notes text,
  after_hours_access_notes text,
  security_contact_name text,
  security_contact_phone text,
  service_window_start time,
  service_window_end time,
  service_window_notes text,
  required_equipment text[] NOT NULL DEFAULT '{}',
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  exclusion_code text,
  exclusion_note text,
  exclusion_qc_issue_id uuid,
  excluded_at timestamptz,
  priced_at timestamptz,
  priced_by uuid,
  priced_by_name text,
  price_adjustment_reason text,
  assigned_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  assignment_token text,
  token_expires_at timestamptz,
  token_submitted_at timestamptz,
  proposal_request_id uuid,
  property_type_key text,
  checklist_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  walkthrough_pay_cents integer,
  walkthrough_pay_type text,
  pdf_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_walkthroughs_firm_price_chk
    CHECK (firm_price_cents IS NULL OR firm_price_cents > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_walkthroughs_assignment_token_uidx
  ON public.commercial_walkthroughs (assignment_token)
  WHERE assignment_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS commercial_walkthroughs_site_idx
  ON public.commercial_walkthroughs (business_site_id, status);
CREATE INDEX IF NOT EXISTS commercial_walkthroughs_account_idx
  ON public.commercial_walkthroughs (business_account_id, created_at DESC);

ALTER TABLE public.commercial_walkthroughs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_walkthroughs_admin ON public.commercial_walkthroughs;
CREATE POLICY commercial_walkthroughs_admin ON public.commercial_walkthroughs
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_walkthroughs_service ON public.commercial_walkthroughs;
CREATE POLICY commercial_walkthroughs_service ON public.commercial_walkthroughs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.commercial_walkthroughs TO authenticated;
GRANT ALL ON public.commercial_walkthroughs TO service_role;
REVOKE ALL ON public.commercial_walkthroughs FROM anon;

-- QA STR walkthrough so the tokenized contractor page can be opened on
-- contractor.novaracleaning.com without going through admin assign first.
INSERT INTO public.business_accounts (
  id, account_type, business_name, contact_name, email, phone,
  city, state, zip_code, address, facility_type, status, source
)
VALUES (
  'a31c0e10-7d2a-4c6b-9f11-0f6d2e8a1b44',
  'partnership',
  'Walkthrough QA',
  'Walkthrough QA',
  'walkthrough-qa@novaracleaning.com',
  '4105550100',
  'Baltimore',
  'MD',
  '21202',
  '418 E Pratt St',
  'STR / Short-Term Rental',
  'prospect',
  'walkthrough_qa'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.business_sites (
  id, business_account_id, nickname, address, city, state, zip_code,
  facility_type, facility_type_key, sqft, active
)
VALUES (
  'b42d1f21-8e3b-5d7c-0a22-1a7e3f9b2c55',
  'a31c0e10-7d2a-4c6b-9f11-0f6d2e8a1b44',
  'Harbor Loft — QA',
  '418 E Pratt St',
  'Baltimore',
  'MD',
  '21202',
  'STR / Short-Term Rental',
  'other',
  980,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.commercial_walkthroughs (
  id,
  business_account_id,
  business_site_id,
  status,
  property_type_key,
  facility_type_key,
  assignment_token,
  token_expires_at,
  scheduled_at,
  client_stated_sqft,
  client_stated_facility_type,
  site_address,
  access_contact_name,
  access_contact_phone,
  request_reason,
  requested_by_name
)
VALUES (
  'c53e2032-9f4c-6e8d-1b33-2b8f40ac3d66',
  'a31c0e10-7d2a-4c6b-9f11-0f6d2e8a1b44',
  'b42d1f21-8e3b-5d7c-0a22-1a7e3f9b2c55',
  'scheduled',
  'str',
  'other',
  '5s0f7BK-mhlBrIFcXxKNWpDpTAigkvlT',
  now() + interval '14 days',
  now() + interval '1 day',
  980,
  'STR / Short-Term Rental',
  '418 E Pratt St, Baltimore, MD 21202',
  'Site contact (QA)',
  '4105550100',
  'walkthrough_qa',
  'QA seed'
)
ON CONFLICT (id) DO NOTHING;
