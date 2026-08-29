-- ─── Proposal request flow: dedicated Proposals tab ────────────────────────
--
-- Front door for STR / Commercial / Office quotes that need an on-site
-- assessment. A proposal request is NOT a booking. Submit creates a request
-- + prospective account/host + commercial_walkthroughs rows (status
-- requested). Assignment is paid contractor work, tokenized checklist is
-- property-type-specific, and submit hands off to the existing walkthrough
-- pipeline (conduct / exclude → firm price → proposal-to-billing).
--
-- Checklists and email templates live in app_settings so admin can edit
-- them, add property types, and change copy without a deploy.

-- ─── 1. Contractor eligibility + walkthrough assignment fields ────────────

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS walkthrough_eligible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cleaners.walkthrough_eligible IS
  'Contractors flagged to take paid walkthrough assignments from the Proposals tab. Dispatch ranking still uses zone, availability, and Novara Score.';

CREATE INDEX IF NOT EXISTS cleaners_walkthrough_eligible_idx
  ON public.cleaners (walkthrough_eligible)
  WHERE walkthrough_eligible AND status = 'active';

ALTER TABLE public.commercial_walkthroughs
  ADD COLUMN IF NOT EXISTS assigned_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_token text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS proposal_request_id uuid,
  ADD COLUMN IF NOT EXISTS property_type_key text,
  ADD COLUMN IF NOT EXISTS checklist_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS findings_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS walkthrough_pay_cents integer,
  ADD COLUMN IF NOT EXISTS walkthrough_pay_type text,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS drive_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_folder_url text;

CREATE UNIQUE INDEX IF NOT EXISTS commercial_walkthroughs_assignment_token_uidx
  ON public.commercial_walkthroughs (assignment_token)
  WHERE assignment_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS commercial_walkthroughs_assigned_cleaner_idx
  ON public.commercial_walkthroughs (assigned_cleaner_id)
  WHERE assigned_cleaner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS commercial_walkthroughs_proposal_request_idx
  ON public.commercial_walkthroughs (proposal_request_id)
  WHERE proposal_request_id IS NOT NULL;

COMMENT ON COLUMN public.commercial_walkthroughs.assignment_token IS
  'Credential for the contractor tokenized walkthrough form. Unique, auto-expiring. The URL is the login.';
COMMENT ON COLUMN public.commercial_walkthroughs.findings_extra IS
  'Property-type checklist answers that are not columns on the walkthrough row. Firm Price Set reads confirmed findings from the structured columns; this is the rest of the record so nothing is re-entered.';
COMMENT ON COLUMN public.commercial_walkthroughs.walkthrough_pay_cents IS
  'Contractor compensation for the visit. Owed whether or not the proposal converts.';

-- ─── 2. Proposal requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.proposal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_type_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending_assign'
    CHECK (status IN (
      'pending_assign',
      'walkthrough_scheduled',
      'walkthrough_conducted',
      'firm_price_set',
      'excluded',
      'cancelled'
    )),

  requester_name text NOT NULL,
  requester_company text,
  requester_email text NOT NULL,
  requester_phone text,
  requester_role text,

  desired_frequency text,
  desired_start_timeframe text,
  lead_source text,
  client_stated_sqft integer,

  site_contact_name text,
  site_contact_phone text,
  site_contact_email text,

  intake_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,

  business_account_id uuid REFERENCES public.business_accounts(id) ON DELETE SET NULL,
  host_id uuid REFERENCES public.hosts(id) ON DELETE SET NULL,
  assigned_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  scheduled_at timestamptz,

  requester_pending_email_sent_at timestamptz,
  requester_scheduled_email_sent_at timestamptz,
  admin_notified_at timestamptz,

  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_requests_status_idx
  ON public.proposal_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS proposal_requests_email_idx
  ON public.proposal_requests (lower(requester_email));
CREATE INDEX IF NOT EXISTS proposal_requests_account_idx
  ON public.proposal_requests (business_account_id);

COMMENT ON TABLE public.proposal_requests IS
  'Front door for quotes that need an on-site walkthrough. Never creates a job booking. Linked to a prospective business_accounts row (or STR host) and one or more commercial_walkthroughs.';

CREATE TABLE IF NOT EXISTS public.proposal_request_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_request_id uuid NOT NULL REFERENCES public.proposal_requests(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  nickname text,
  address text,
  city text,
  state text,
  zip_code text,
  client_stated_sqft integer,
  business_site_id uuid REFERENCES public.business_sites(id) ON DELETE SET NULL,
  walkthrough_id uuid REFERENCES public.commercial_walkthroughs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_request_sites_request_idx
  ON public.proposal_request_sites (proposal_request_id, sort_order);

ALTER TABLE public.commercial_walkthroughs
  DROP CONSTRAINT IF EXISTS commercial_walkthroughs_proposal_request_id_fkey;
ALTER TABLE public.commercial_walkthroughs
  ADD CONSTRAINT commercial_walkthroughs_proposal_request_id_fkey
  FOREIGN KEY (proposal_request_id) REFERENCES public.proposal_requests(id) ON DELETE SET NULL;

-- ─── 3. Paid walkthrough assignments ──────────────────────────────────────
-- Billable contractor time. Issued regardless of whether the proposal converts.
-- Separate from job_extra_pay because there is no booking.

CREATE TABLE IF NOT EXISTS public.walkthrough_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  walkthrough_id uuid NOT NULL REFERENCES public.commercial_walkthroughs(id) ON DELETE CASCADE,
  proposal_request_id uuid REFERENCES public.proposal_requests(id) ON DELETE SET NULL,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  pay_type text NOT NULL DEFAULT 'flat' CHECK (pay_type IN ('flat', 'hourly')),
  hours numeric,
  status text NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'paid', 'void')),
  note text,
  paid_at timestamptz,
  stripe_transfer_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS walkthrough_payouts_one_per_visit
  ON public.walkthrough_payouts (walkthrough_id, cleaner_id)
  WHERE status <> 'void';

CREATE INDEX IF NOT EXISTS walkthrough_payouts_cleaner_idx
  ON public.walkthrough_payouts (cleaner_id, status);

COMMENT ON TABLE public.walkthrough_payouts IS
  'Contractor pay for a walkthrough visit. Owed on assignment, independent of whether the proposal converts.';

-- ─── 4. RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.proposal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_request_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkthrough_payouts ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'proposal_requests' AND policyname = 'proposal_requests_admin_all'
  ) THEN
    CREATE POLICY proposal_requests_admin_all ON public.proposal_requests
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'proposal_requests' AND policyname = 'proposal_requests_service_role'
  ) THEN
    CREATE POLICY proposal_requests_service_role ON public.proposal_requests
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'proposal_request_sites' AND policyname = 'proposal_request_sites_admin_all'
  ) THEN
    CREATE POLICY proposal_request_sites_admin_all ON public.proposal_request_sites
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'proposal_request_sites' AND policyname = 'proposal_request_sites_service_role'
  ) THEN
    CREATE POLICY proposal_request_sites_service_role ON public.proposal_request_sites
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'walkthrough_payouts' AND policyname = 'walkthrough_payouts_admin_all'
  ) THEN
    CREATE POLICY walkthrough_payouts_admin_all ON public.walkthrough_payouts
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'walkthrough_payouts' AND policyname = 'walkthrough_payouts_service_role'
  ) THEN
    CREATE POLICY walkthrough_payouts_service_role ON public.walkthrough_payouts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$do$;

-- Contractors can read their own owed walkthrough pay (portal).
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'walkthrough_payouts' AND policyname = 'walkthrough_payouts_own_read'
  ) THEN
    CREATE POLICY walkthrough_payouts_own_read ON public.walkthrough_payouts
      FOR SELECT TO authenticated
      USING (
        cleaner_id IN (SELECT id FROM public.cleaners WHERE user_id = auth.uid())
      );
  END IF;
END
$do$;

-- ─── 5. Editable templates + pay rates ────────────────────────────────────

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'proposal_request_settings',
  jsonb_build_object(
    'pendingEmailSubject', 'Your NovaraCleaning proposal request — next steps',
    'pendingEmailBody',
      'Hi [Name], thank you for requesting a proposal for [property/address]. Your request is in, and we''re currently assigning a walkthrough agent to assess the space. Because accurate pricing depends on the actual condition, layout, and access of a property, we conduct an on-site walkthrough before providing a firm quote — this protects you from surprise adjustments later.'
      || E'\n\n'
      || 'We''ll reach out shortly to schedule a convenient time. If you have a preferred window, just reply to this email.',
    'scheduledEmailSubject', 'Your NovaraCleaning walkthrough is scheduled',
    'scheduledEmailBody',
      'Hi [Name], a walkthrough agent has been assigned for [property/address]. The visit is confirmed for [date] at [time]. [Agent name] will assess the space so we can issue a firm quote. Please make sure the site contact can provide access. Reply to this email if the time no longer works.',
    'adminNotifyEmail', '',
    'walkthroughPayType', 'flat',
    'walkthroughPayCents', 7500,
    'walkthroughHourlyCents', 3500,
    'tokenTtlHours', 336,
    'agentEmailSubject', 'Walkthrough assignment — [property/address]',
    'agentEmailBody',
      'Hi [Agent name], you''ve been assigned a paid walkthrough at [property/address] on [date] at [time]. Open the checklist for this property type (it auto-saves):'
      || E'\n\n[link]\n\n'
      || 'Capture confirmed sqft, floor types, access, exclusions, photos, and the type-specific items. You are paid for this visit whether or not the proposal converts.'
  ),
  'Proposal request emails, walkthrough agent pay (flat or hourly), and token lifetime. Admin-editable from the Proposals tab. Placeholders: [Name] [property/address] [date] [time] [Agent name] [link].'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'proposal_walkthrough_checklists',
  jsonb_build_object(
    'types', '[]'::jsonb,
    'universal', '[]'::jsonb,
    'byType', '{}'::jsonb,
    'intakeByType', '{}'::jsonb
  ),
  'Property-type walkthrough checklists and light intake questions. Empty arrays mean "use code defaults". Admin can add types and rewrite items from the Proposals tab without a deploy.'
)
ON CONFLICT (key) DO NOTHING;
