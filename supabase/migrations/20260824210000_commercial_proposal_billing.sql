-- ─── Commercial proposal → agreement → billing → dispatch ──────────────────
--
-- Residential is one motion: quote, tokenized link, sign, charge the card.
-- Commercial cannot collapse that way, for two reasons that are facts about
-- how the work is actually sold rather than preferences about software:
--
--   1. The decision-maker wants to see pricing and terms informally BEFORE
--      anything legal is put in front of them. A signature field on the first
--      thing they open reads as a trap and stalls the deal.
--   2. Commercial bills by Auto-Pay OR by invoice on Net terms. For an
--      invoiced account there is no card to charge at signing and there never
--      was going to be, so a flow that ends in "collect payment" has no
--      correct ending for half of its accounts.
--
-- So the one residential step becomes five, and each one is a real object
-- with its own record:
--
--   Firm Price Ready → Proposal Sent → Proposal Accepted → Agreement Signed
--     → Billing Configured → Dispatch-Eligible
--
-- Two rules shape most of the schema below:
--
--   • A PROPOSAL SITE CANNOT EXIST WITHOUT A PRICE. The column is NOT NULL
--     and checked > 0. "No proposing against an estimate range" is therefore
--     not a validation someone can forget to run — there is no row shape that
--     expresses an unpriced proposed site.
--   • THE PROPOSAL IS A SNAPSHOT, not a pointer. Exhibit A on the agreement
--     is built from the accepted proposal's own rows, so re-pricing a site
--     tomorrow cannot retroactively change what the client accepted today.
--     A mismatch between what was proposed and what got signed is exactly the
--     error this whole path exists to make impossible.

-- ─── 1. Tunables ───────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'commercial_proposal_settings',
  jsonb_build_object(
    -- How long a sent proposal stays open before it lapses. A proposal that
    -- never expires is a price we are still honouring a year later.
    'proposal_expiry_days', 14,
    -- Nudge the recipient this many days before the proposal lapses.
    'proposal_reminder_days', 3,
    -- How long the agreement signing link stays live.
    'agreement_token_ttl_days', 30,
    -- Standard term offered on every proposal.
    'default_term', 'month_to_month',
    'default_invoice_cycle', 'monthly',
    'default_net_terms', 'net_15',
    -- Warn this many days before OUR OWN certificate lapses. A commercial
    -- client is entitled to a current certificate on file; ours expiring is
    -- our problem to see coming, not theirs to discover.
    'company_coi_warn_days', 30
  ),
  'Commercial proposal pipeline: expiry window, reminder lead time, agreement link TTL, default term and billing defaults.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.commercial_proposal_setting_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (value ->> p_key)::integer FROM public.app_settings
      WHERE key = 'commercial_proposal_settings'),
    p_default
  );
$$;

CREATE OR REPLACE FUNCTION public.commercial_proposal_setting_text(p_key text, p_default text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF((SELECT value ->> p_key FROM public.app_settings
             WHERE key = 'commercial_proposal_settings'), ''),
    p_default
  );
$$;

-- ─── 2. Tokens ─────────────────────────────────────────────────────────────
-- Same trust model as every other tokenized link in the app: the unguessable
-- token IS the credential, it is scoped to exactly one object, and it is
-- revoked by nulling the column. 64 hex characters from two independent
-- UUIDs — no pgcrypto dependency, matching the job_assignments.response_token
-- precedent.

CREATE OR REPLACE FUNCTION public.mint_commercial_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT md5(gen_random_uuid()::text)
       || md5(gen_random_uuid()::text || clock_timestamp()::text);
$$;

COMMENT ON FUNCTION public.mint_commercial_token() IS
  'Unguessable 64-hex link token for commercial proposal / agreement pages. The token is the credential; scope it to one row and revoke by nulling the column.';

-- ─── 3. Proposals ──────────────────────────────────────────────────────────
-- Versioned per account. A revision never overwrites its predecessor: the
-- negotiation is the record, and "what did we offer them in round one" is a
-- question that gets asked when a deal goes sideways.

CREATE TABLE IF NOT EXISTS public.commercial_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,

  -- 1, 2, 3 … within the account. Revisions increment; nothing is reused.
  version integer NOT NULL DEFAULT 1,
  -- The proposal this one replaces, when it came out of a change request.
  supersedes_id uuid REFERENCES public.commercial_proposals(id) ON DELETE SET NULL,

  -- draft            — being built, never seen by anyone outside
  -- sent             — live link with the decision-maker
  -- accepted         — agreement-in-principle; the agreement is generated
  -- changes_requested— client asked for something different; a revision follows
  -- expired          — lapsed unacted-on
  -- withdrawn        — pulled by us
  -- superseded       — a later version replaced it
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'changes_requested',
                      'expired', 'withdrawn', 'superseded')),

  -- The link. Nulled when the proposal stops being actionable.
  token text,
  expires_at timestamptz,

  -- Who it goes to. The decision-maker on the proposal and the authorized
  -- signer on the agreement are frequently two different people, so they are
  -- captured separately rather than assumed to be the same contact.
  recipient_name text,
  recipient_email text,
  recipient_phone text,

  -- What is being offered.
  proposed_frequency text,
  term text NOT NULL DEFAULT 'month_to_month',
  -- Which billing method the proposal leads with. The client may switch to
  -- the other on acceptance; whatever they land on is what the agreement and
  -- the billing profile are built around.
  billing_method text NOT NULL DEFAULT 'invoiced'
    CHECK (billing_method IN ('auto_pay', 'invoiced')),
  billing_method_locked boolean NOT NULL DEFAULT false,
  invoice_cycle text,
  net_terms text,

  -- Sales copy. Optional; the value stack itself is rendered by the page.
  cover_note text,
  internal_note text,

  -- Totals across the proposal's sites, denormalised at send time so the
  -- history shows what was quoted without recomputing it from current rates.
  total_per_visit_cents integer NOT NULL DEFAULT 0,
  estimated_monthly_cents integer,
  visits_per_month numeric(6, 2),

  prepared_by uuid,
  prepared_by_name text,
  assigned_to_email text,

  sent_at timestamptz,
  sent_to text,
  send_count integer NOT NULL DEFAULT 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,

  accepted_at timestamptz,
  accepted_by_name text,
  accepted_by_email text,
  accepted_ip text,
  accepted_user_agent text,
  -- What they picked on the page, when the method was not locked.
  accepted_billing_method text
    CHECK (accepted_billing_method IS NULL
           OR accepted_billing_method IN ('auto_pay', 'invoiced')),

  changes_requested_at timestamptz,
  change_request_note text,
  change_request_by_name text,
  change_request_ack_at timestamptz,
  change_request_ack_by text,

  expired_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A change request without a reason is a dead end for whoever picks it up.
  CONSTRAINT commercial_proposals_change_note_chk
    CHECK (changes_requested_at IS NULL
           OR length(btrim(COALESCE(change_request_note, ''))) >= 5),
  -- A sent proposal has a live link and a recipient, or it was not sent.
  CONSTRAINT commercial_proposals_sent_shape_chk
    CHECK (status <> 'sent'
           OR (token IS NOT NULL AND expires_at IS NOT NULL
               AND recipient_email IS NOT NULL)),
  CONSTRAINT commercial_proposals_accepted_shape_chk
    CHECK (status <> 'accepted' OR accepted_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_proposals_token_uniq
  ON public.commercial_proposals (token) WHERE token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commercial_proposals_account_version_uniq
  ON public.commercial_proposals (business_account_id, version);

-- One live proposal per account. Two open proposals means two prices the
-- client could accept, and no answer to which one we are bound by.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_proposals_one_open
  ON public.commercial_proposals (business_account_id)
  WHERE status IN ('draft', 'sent');

CREATE INDEX IF NOT EXISTS commercial_proposals_account_idx
  ON public.commercial_proposals (business_account_id, version DESC);
CREATE INDEX IF NOT EXISTS commercial_proposals_expiry_idx
  ON public.commercial_proposals (expires_at) WHERE status = 'sent';

COMMENT ON TABLE public.commercial_proposals IS
  'Versioned commercial proposals. Non-binding by construction: the page carries Accept and Request Changes and nothing else. Revisions supersede; prior versions are retained so the negotiation stays readable.';
COMMENT ON COLUMN public.commercial_proposals.total_per_visit_cents IS
  'Sum of the proposal''s own site rows at send time — what was quoted, not what the sites cost today.';

ALTER TABLE public.commercial_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_proposals_admin ON public.commercial_proposals;
CREATE POLICY commercial_proposals_admin ON public.commercial_proposals
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_proposals_service ON public.commercial_proposals;
CREATE POLICY commercial_proposals_service ON public.commercial_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.commercial_proposals TO authenticated;
GRANT ALL ON public.commercial_proposals TO service_role;
REVOKE ALL ON public.commercial_proposals FROM anon;

-- ─── 4. The sites on a proposal — the snapshot ─────────────────────────────
-- Every column here is a copy taken at build time, not a join. That is the
-- whole point: Exhibit A on the signed agreement has to match what the client
-- accepted even after somebody re-walks the building and changes the rate.

CREATE TABLE IF NOT EXISTS public.commercial_proposal_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL
    REFERENCES public.commercial_proposals(id) ON DELETE CASCADE,
  business_site_id uuid
    REFERENCES public.business_sites(id) ON DELETE SET NULL,

  nickname text NOT NULL,
  address text,
  facility_type text,
  scope_level text,
  sqft integer,
  crew_size integer,
  service_window_start time,
  service_window_end time,
  frequency text,

  -- The rate. NOT NULL and > 0: there is no way to express "proposed but
  -- unpriced", which is how the no-proposing-against-an-estimate rule is
  -- enforced structurally instead of by a check somebody can skip.
  per_visit_price_cents integer NOT NULL
    CHECK (per_visit_price_cents > 0),

  -- formula     — under the walkthrough threshold, priced by the engine
  -- walkthrough — a human stood in the building and set a firm price
  price_source text NOT NULL DEFAULT 'walkthrough'
    CHECK (price_source IN ('formula', 'walkthrough')),
  walkthrough_id uuid
    REFERENCES public.commercial_walkthroughs(id) ON DELETE SET NULL,
  pricing_confirmed_at timestamptz,

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commercial_proposal_sites_proposal_idx
  ON public.commercial_proposal_sites (proposal_id, sort_order);
CREATE INDEX IF NOT EXISTS commercial_proposal_sites_site_idx
  ON public.commercial_proposal_sites (business_site_id);

-- The same site twice on one proposal is a build error, not a two-visit deal.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_proposal_sites_once
  ON public.commercial_proposal_sites (proposal_id, business_site_id)
  WHERE business_site_id IS NOT NULL;

COMMENT ON TABLE public.commercial_proposal_sites IS
  'The sites and rates as proposed — a snapshot, never a live join. Exhibit A is built from these rows so the signed agreement matches what was accepted.';
COMMENT ON COLUMN public.commercial_proposal_sites.per_visit_price_cents IS
  'NOT NULL and > 0 by constraint: a site with no firm price cannot be put on a proposal at all.';

ALTER TABLE public.commercial_proposal_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_proposal_sites_admin ON public.commercial_proposal_sites;
CREATE POLICY commercial_proposal_sites_admin ON public.commercial_proposal_sites
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_proposal_sites_service ON public.commercial_proposal_sites;
CREATE POLICY commercial_proposal_sites_service ON public.commercial_proposal_sites
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_proposal_sites TO authenticated;
GRANT ALL ON public.commercial_proposal_sites TO service_role;
REVOKE ALL ON public.commercial_proposal_sites FROM anon;

-- A proposal cannot be sent empty. Combined with the NOT NULL price above,
-- "sent" therefore guarantees at least one site and every site priced.
CREATE OR REPLACE FUNCTION public.guard_commercial_proposal_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sites integer;
BEGIN
  IF NEW.status = 'sent' AND COALESCE(OLD.status, '') <> 'sent' THEN
    SELECT count(*) INTO v_sites
    FROM public.commercial_proposal_sites WHERE proposal_id = NEW.id;
    IF v_sites = 0 THEN
      RAISE EXCEPTION 'A proposal needs at least one priced site before it can be sent.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_commercial_proposal_send ON public.commercial_proposals;
CREATE TRIGGER trg_guard_commercial_proposal_send
  BEFORE UPDATE ON public.commercial_proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_commercial_proposal_send();

-- ─── 5. Agreements ─────────────────────────────────────────────────────────
-- The formal Commercial Cleaning Services Agreement, generated from an
-- accepted proposal and signed through its own tokenized link. Exhibit A is
-- stored as text on the row, not regenerated at render time, for the same
-- reason the proposal snapshots its sites.

CREATE TABLE IF NOT EXISTS public.commercial_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  proposal_id uuid
    REFERENCES public.commercial_proposals(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'signed', 'declined', 'voided', 'superseded')),

  token text,
  expires_at timestamptz,

  -- The authorized signer, who may not be the person the proposal went to.
  signer_name text,
  signer_email text,
  signer_title text,

  term text NOT NULL DEFAULT 'month_to_month',
  billing_method text NOT NULL DEFAULT 'invoiced'
    CHECK (billing_method IN ('auto_pay', 'invoiced')),
  invoice_cycle text,
  net_terms text,

  -- Exhibit A exactly as presented for signature.
  exhibit_a_text text,
  exhibit_a_sites jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_per_visit_cents integer NOT NULL DEFAULT 0,

  sent_at timestamptz,
  sent_to text,
  send_count integer NOT NULL DEFAULT 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,

  signed_at timestamptz,
  signed_by_name text,
  signed_by_title text,
  signed_ip text,
  signed_user_agent text,
  -- The drawn signature (PNG) and the executed document, both in the private
  -- commercial-agreements bucket. Retained permanently — this is the artifact
  -- a dispute is argued from.
  signature_path text,
  document_path text,

  -- Company side. Countersigning may happen before send or on client
  -- signature; either way it is recorded rather than assumed.
  countersigned_at timestamptz,
  countersigned_by_name text,

  docuseal_submission_id text,
  docuseal_document_url text,

  declined_at timestamptz,
  declined_reason text,
  voided_at timestamptz,
  voided_reason text,

  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commercial_agreements_signed_shape_chk
    CHECK (status <> 'signed'
           OR (signed_at IS NOT NULL AND length(btrim(COALESCE(signed_by_name, ''))) > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_agreements_token_uniq
  ON public.commercial_agreements (token) WHERE token IS NOT NULL;

-- One agreement out for signature per account at a time.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_agreements_one_pending
  ON public.commercial_agreements (business_account_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS commercial_agreements_account_idx
  ON public.commercial_agreements (business_account_id, created_at DESC);

COMMENT ON TABLE public.commercial_agreements IS
  'Commercial service agreements generated from accepted proposals and e-signed through their own tokenized link. exhibit_a_text is the schedule as signed; the signed PDF is retained permanently.';

ALTER TABLE public.commercial_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_agreements_admin ON public.commercial_agreements;
CREATE POLICY commercial_agreements_admin ON public.commercial_agreements
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_agreements_service ON public.commercial_agreements;
CREATE POLICY commercial_agreements_service ON public.commercial_agreements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.commercial_agreements TO authenticated;
GRANT ALL ON public.commercial_agreements TO service_role;
REVOKE ALL ON public.commercial_agreements FROM anon;

-- Private bucket. Signed agreements are never purged: the retention sweep
-- only walks job-photo prefixes, and this bucket is not one of them.
INSERT INTO storage.buckets (id, name, public)
VALUES ('commercial-agreements', 'commercial-agreements', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read commercial agreements" ON storage.objects;
CREATE POLICY "admins read commercial agreements" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'commercial-agreements' AND public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admins write commercial agreements" ON storage.objects;
CREATE POLICY "admins write commercial agreements" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'commercial-agreements' AND public.is_admin_or_va(auth.uid()));

-- Signing the agreement is what makes the account's agreement gate true.
-- Previously the gate flipped when the agreement was SENT, which meant an
-- account counted as under contract on the strength of an email leaving the
-- building.
CREATE OR REPLACE FUNCTION public.sync_account_from_commercial_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'signed' AND COALESCE(OLD.status, '') <> 'signed' THEN
    UPDATE public.business_accounts
    SET agreement_signed_at = COALESCE(NEW.signed_at, now()),
        commercial_agreement_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.business_account_id;

    -- Any older agreement on this account is history now.
    UPDATE public.commercial_agreements
    SET status = 'superseded', updated_at = now()
    WHERE business_account_id = NEW.business_account_id
      AND id <> NEW.id
      AND status = 'pending';
  END IF;
  RETURN NULL;
END;
$$;

-- ─── 6. Billing profiles ───────────────────────────────────────────────────
-- The commercial equivalent of "pay". Not a charge — a decision about how
-- money will move, recorded once and then relied on by dispatch.
--
-- `configured` is GENERATED, not set. An Auto-Pay account is configured when
-- a payment method is actually on file; an Invoiced account is configured
-- when the contact, cycle and terms are all present. Neither can be marked
-- done by someone clicking a button, and an Invoiced account is never held up
-- waiting for a card that was never supposed to exist.

CREATE TABLE IF NOT EXISTS public.commercial_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL UNIQUE
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  agreement_id uuid
    REFERENCES public.commercial_agreements(id) ON DELETE SET NULL,

  method text NOT NULL
    CHECK (method IN ('auto_pay', 'invoiced')),

  -- Auto-Pay: a saved method, captured through the existing Stripe setup
  -- session. Cards and ACH both land here.
  stripe_customer_id text,
  stripe_payment_method_id text,
  payment_method_type text
    CHECK (payment_method_type IS NULL
           OR payment_method_type IN ('card', 'us_bank_account')),
  payment_method_brand text,
  payment_method_last4 text,
  payment_method_added_at timestamptz,
  setup_session_id text,

  -- Invoiced: who gets the invoice, how often, and on what terms.
  billing_contact_name text,
  billing_contact_email text,
  billing_contact_phone text,
  invoice_cycle text
    CHECK (invoice_cycle IS NULL
           OR invoice_cycle IN ('per_visit', 'weekly', 'biweekly', 'monthly')),
  net_terms text
    CHECK (net_terms IS NULL
           OR net_terms IN ('on_receipt', 'net_15', 'net_30', 'net_45', 'none')),
  po_number text,
  invoice_notes text,

  confirmed_at timestamptz,
  confirmed_by_name text,
  confirmed_ip text,

  -- Whether this account is actually ready to be billed. Computed from the
  -- facts, so it cannot drift from them.
  configured boolean GENERATED ALWAYS AS (
    CASE method
      WHEN 'auto_pay' THEN stripe_payment_method_id IS NOT NULL
      WHEN 'invoiced' THEN billing_contact_email IS NOT NULL
                        AND invoice_cycle IS NOT NULL
                        AND net_terms IS NOT NULL
      ELSE false
    END
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commercial_billing_profiles_configured_idx
  ON public.commercial_billing_profiles (configured);

COMMENT ON TABLE public.commercial_billing_profiles IS
  'How a commercial account is billed. `configured` is generated from the facts — an Auto-Pay account needs a method on file, an Invoiced account needs contact, cycle and terms. Both are complete paths to dispatch.';
COMMENT ON COLUMN public.commercial_billing_profiles.configured IS
  'GENERATED. Cannot be set by hand, so "billing is ready" always means the underlying fields are actually present.';

ALTER TABLE public.commercial_billing_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_billing_profiles_admin ON public.commercial_billing_profiles;
CREATE POLICY commercial_billing_profiles_admin ON public.commercial_billing_profiles
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_billing_profiles_service ON public.commercial_billing_profiles;
CREATE POLICY commercial_billing_profiles_service ON public.commercial_billing_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.commercial_billing_profiles TO authenticated;
GRANT ALL ON public.commercial_billing_profiles TO service_role;
REVOKE ALL ON public.commercial_billing_profiles FROM anon;

CREATE OR REPLACE FUNCTION public.sync_account_from_billing_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.business_accounts
  SET billing_method = NEW.method,
      billing_configured_at = CASE WHEN NEW.configured THEN COALESCE(billing_configured_at, now()) ELSE NULL END,
      autopay_enabled = (NEW.method = 'auto_pay' AND NEW.stripe_payment_method_id IS NOT NULL),
      stripe_customer_id = COALESCE(NEW.stripe_customer_id, stripe_customer_id),
      updated_at = now()
  WHERE id = NEW.business_account_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_account_billing ON public.commercial_billing_profiles;
CREATE TRIGGER trg_sync_account_billing
  AFTER INSERT OR UPDATE ON public.commercial_billing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_account_from_billing_profile();

-- ─── 7. Our own certificate of insurance ───────────────────────────────────
-- Everything in commercial_coi_documents is a certificate belonging to ONE
-- account. This is the other direction and there is exactly one of it: the
-- certificate NovaraCleaning carries, which a commercial client is entitled
-- to receive on signature and keep on file.
--
-- Kept deliberately separate from the per-account COI lifecycle so the two
-- are never confused. That system governs whether an account stays
-- dispatch-eligible; this one is a document we owe the client.

CREATE TABLE IF NOT EXISTS public.company_coi_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  document_path text,
  document_name text,
  document_size_bytes bigint,

  effective_date date,
  expiration_date date,
  carrier text,
  policy_number text,
  coverage_notes text,
  -- Whether this certificate is the general one or names a specific client
  -- as additional insured. Client-specific certificates are delivered only to
  -- the account they name.
  business_account_id uuid
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,

  lifecycle text NOT NULL DEFAULT 'current'
    CHECK (lifecycle IN ('current', 'superseded', 'needs_review', 'rejected')),
  review_note text,

  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT company_coi_documents_dates_chk
    CHECK (effective_date IS NULL OR expiration_date IS NULL
           OR expiration_date >= effective_date),
  -- Same rule as the account-side certificates: no readable expiry means it
  -- cannot be the certificate in force, because there is nothing to compute a
  -- status from.
  CONSTRAINT company_coi_documents_current_needs_expiry_chk
    CHECK (lifecycle <> 'current' OR expiration_date IS NOT NULL)
);

-- One general certificate in force, plus at most one per named account.
CREATE UNIQUE INDEX IF NOT EXISTS company_coi_documents_one_general_current
  ON public.company_coi_documents ((business_account_id IS NULL))
  WHERE lifecycle = 'current' AND business_account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS company_coi_documents_one_account_current
  ON public.company_coi_documents (business_account_id)
  WHERE lifecycle = 'current' AND business_account_id IS NOT NULL;

COMMENT ON TABLE public.company_coi_documents IS
  'NovaraCleaning''s OWN certificate of insurance — the document we send to a commercial client on signature. Distinct from commercial_coi_documents, which holds certificates belonging to the accounts themselves.';

ALTER TABLE public.company_coi_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_coi_documents_admin ON public.company_coi_documents;
CREATE POLICY company_coi_documents_admin ON public.company_coi_documents
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS company_coi_documents_service ON public.company_coi_documents;
CREATE POLICY company_coi_documents_service ON public.company_coi_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.company_coi_documents TO authenticated;
GRANT ALL ON public.company_coi_documents TO service_role;
REVOKE ALL ON public.company_coi_documents FROM anon;

INSERT INTO storage.buckets (id, name, public)
VALUES ('company-coi', 'company-coi', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read company coi" ON storage.objects;
CREATE POLICY "admins read company coi" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'company-coi' AND public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admins write company coi" ON storage.objects;
CREATE POLICY "admins write company coi" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-coi' AND public.is_admin_or_va(auth.uid()));

-- Each delivery is its own record. "Did they ever get our certificate, and
-- which one" is the question an account manager gets asked, and a single
-- timestamp on the account cannot answer it.
CREATE TABLE IF NOT EXISTS public.company_coi_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  company_coi_document_id uuid
    REFERENCES public.company_coi_documents(id) ON DELETE SET NULL,
  agreement_id uuid
    REFERENCES public.commercial_agreements(id) ON DELETE SET NULL,

  sent_to text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by_name text,
  -- agreement_signature — automatic, on signing
  -- manual              — an admin sent it on request
  trigger_source text NOT NULL DEFAULT 'agreement_signature'
    CHECK (trigger_source IN ('agreement_signature', 'manual', 'renewal')),

  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed', 'skipped')),
  failure_reason text,
  -- Expiry of the certificate that was actually delivered, so a renewal knows
  -- who is holding a stale copy.
  certificate_expires_at date,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_coi_deliveries_account_idx
  ON public.company_coi_deliveries (business_account_id, sent_at DESC);

COMMENT ON TABLE public.company_coi_deliveries IS
  'Every time our certificate of insurance was delivered to a client, which certificate it was, and what triggered it.';

ALTER TABLE public.company_coi_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_coi_deliveries_admin ON public.company_coi_deliveries;
CREATE POLICY company_coi_deliveries_admin ON public.company_coi_deliveries
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS company_coi_deliveries_service ON public.company_coi_deliveries;
CREATE POLICY company_coi_deliveries_service ON public.company_coi_deliveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.company_coi_deliveries TO authenticated;
GRANT ALL ON public.company_coi_deliveries TO service_role;
REVOKE ALL ON public.company_coi_deliveries FROM anon;

-- ─── 8. Account-level additions ────────────────────────────────────────────

ALTER TABLE public.business_accounts
  -- Agreement Section 8.1: does this client require a certificate on file?
  -- Defaulted true because commercial clients almost always do, and sending
  -- one to a client who did not ask is harmless.
  ADD COLUMN IF NOT EXISTS requires_coi_on_file boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS company_coi_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_coi_document_id uuid,
  ADD COLUMN IF NOT EXISTS billing_method text,
  ADD COLUMN IF NOT EXISTS billing_configured_at timestamptz,
  ADD COLUMN IF NOT EXISTS commercial_agreement_id uuid;

COMMENT ON COLUMN public.business_accounts.company_coi_sent_at IS
  'When OUR certificate was last delivered to this client. Distinct from coi_sent_at, which belongs to the account-side COI lifecycle.';
COMMENT ON COLUMN public.business_accounts.billing_configured_at IS
  'Set from the billing profile''s generated `configured` flag — Auto-Pay with a method on file, or Invoiced with contact, cycle and terms.';

DROP TRIGGER IF EXISTS trg_sync_account_commercial_agreement ON public.commercial_agreements;
CREATE TRIGGER trg_sync_account_commercial_agreement
  AFTER INSERT OR UPDATE ON public.commercial_agreements
  FOR EACH ROW EXECUTE FUNCTION public.sync_account_from_commercial_agreement();

-- ─── 9. Backfill: accounts already being serviced are already billable ─────
-- Adding a billing requirement to the dispatch gate would otherwise block
-- every live account overnight. These accounts have terms — the terms simply
-- lived in scattered columns instead of a profile. An account that is being
-- invoiced today under recorded terms IS billing-configured; recording that
-- is bookkeeping, not an exception.

INSERT INTO public.commercial_billing_profiles (
  business_account_id, method,
  billing_contact_name, billing_contact_email, billing_contact_phone,
  invoice_cycle, net_terms,
  stripe_customer_id,
  confirmed_at, confirmed_by_name
)
SELECT
  a.id,
  'invoiced',
  a.contact_name,
  a.email,
  a.phone,
  'monthly',
  CASE a.billing_terms
    WHEN 'net_15' THEN 'net_15'
    WHEN 'net_30' THEN 'net_30'
    WHEN 'none' THEN 'none'
    ELSE 'on_receipt'
  END,
  a.stripe_customer_id,
  now(),
  'Backfilled from recorded billing terms'
FROM public.business_accounts a
WHERE a.account_type IN ('commercial', 'office')
  AND a.status IN ('active', 'onboarding', 'paused')
  AND a.email IS NOT NULL
ON CONFLICT (business_account_id) DO NOTHING;

-- ─── 10. Is this account billable? ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.commercial_billing_state(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p public.commercial_billing_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.commercial_billing_profiles
  WHERE business_account_id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'configured', false,
      'method', NULL,
      'reason', 'Billing has not been set up — neither Auto-Pay nor invoiced terms are on file.'
    );
  END IF;

  IF v_p.configured THEN
    RETURN jsonb_build_object(
      'configured', true,
      'method', v_p.method,
      'payment_method_type', v_p.payment_method_type,
      'payment_method_last4', v_p.payment_method_last4,
      'invoice_cycle', v_p.invoice_cycle,
      'net_terms', v_p.net_terms,
      'billing_contact_email', v_p.billing_contact_email,
      'summary', CASE v_p.method
        WHEN 'auto_pay' THEN format('Auto-Pay — %s ending %s on file.',
                                    COALESCE(v_p.payment_method_brand,
                                             CASE v_p.payment_method_type
                                               WHEN 'us_bank_account' THEN 'bank account'
                                               ELSE 'card' END),
                                    COALESCE(v_p.payment_method_last4, '••••'))
        ELSE format('Invoiced %s, %s, to %s.',
                    COALESCE(v_p.invoice_cycle, 'monthly'),
                    COALESCE(replace(v_p.net_terms, '_', ' '), 'on receipt'),
                    COALESCE(v_p.billing_contact_email, 'the billing contact'))
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'configured', false,
    'method', v_p.method,
    'reason', CASE v_p.method
      WHEN 'auto_pay' THEN 'Auto-Pay was selected but no payment method has been saved yet.'
      ELSE 'Invoiced billing was selected but the billing contact, cycle or Net terms are still missing.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_billing_state(uuid) TO authenticated, service_role;

-- ─── 11. Compliance gate: billing joins the existing blockers ──────────────
-- Same contract as before (ok / blockers / warnings) so every caller keeps
-- working. Billing becomes a blocker in the same list as the agreement and
-- the certificate, which means the six existing enforcement points pick it up
-- without any of them changing.

CREATE OR REPLACE FUNCTION public.commercial_account_compliance(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acct public.business_accounts%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_coi jsonb;
  v_billing jsonb;
  v_status text;
  v_days integer;
  v_sites integer;
BEGIN
  SELECT * INTO v_acct FROM public.business_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', to_jsonb(ARRAY['Account not found.']),
      'warnings', to_jsonb(ARRAY[]::text[])
    );
  END IF;

  SELECT count(*) INTO v_sites
  FROM public.business_sites s
  WHERE s.business_account_id = p_account_id AND s.active;

  v_coi := public.commercial_coi_status(p_account_id);
  v_status := v_coi ->> 'status';
  v_days := (v_coi ->> 'days_remaining')::integer;
  v_billing := public.commercial_billing_state(p_account_id);

  IF v_acct.agreement_signed_at IS NULL THEN
    v_blockers := array_append(v_blockers, 'No signed agreement on the account.');
  END IF;

  -- Auto-Pay with a saved method, or Invoiced with confirmed terms. Both are
  -- complete; neither outranks the other.
  IF NOT (v_billing ->> 'configured')::boolean THEN
    v_blockers := array_append(v_blockers, v_billing ->> 'reason');
  END IF;

  IF (v_coi ->> 'blocked')::boolean THEN
    IF v_status = 'expired' THEN
      v_blockers := array_append(
        v_blockers,
        format('Certificate of insurance expired %s (%s days ago).',
               to_char(v_acct.coi_expires_at, 'Mon DD, YYYY'), abs(v_days)));
    ELSE
      v_blockers := array_append(v_blockers, 'No current certificate of insurance on file.');
    END IF;
  ELSIF v_coi -> 'override' IS NOT NULL AND v_coi -> 'override' <> 'null'::jsonb THEN
    v_warnings := array_append(
      v_warnings,
      format('COI %s — block temporarily overridden until %s: %s',
             v_status,
             to_char((v_coi -> 'override' ->> 'expires_at')::timestamptz, 'Mon DD, YYYY HH24:MI'),
             v_coi -> 'override' ->> 'reason'));
  ELSIF v_status = 'expiring_soon' THEN
    v_warnings := array_append(
      v_warnings,
      format('Certificate of insurance expires %s — %s days left.',
             to_char(v_acct.coi_expires_at, 'Mon DD, YYYY'), v_days));
  END IF;

  IF (v_coi ->> 'documents_in_review')::integer > 0 THEN
    v_warnings := array_append(
      v_warnings,
      format('%s uploaded certificate(s) awaiting review — no readable expiry date.',
             v_coi ->> 'documents_in_review'));
  END IF;

  -- Not a blocker: a client who requires our certificate and has not been
  -- sent one is a promise outstanding, not a reason to leave their floors
  -- dirty.
  IF v_acct.requires_coi_on_file AND v_acct.company_coi_sent_at IS NULL
     AND v_acct.agreement_signed_at IS NOT NULL THEN
    v_warnings := array_append(
      v_warnings,
      'This client requires a certificate on file and has not been sent ours yet.');
  END IF;

  IF v_acct.status = 'offboarded' THEN
    v_blockers := array_append(v_blockers, 'Account is offboarded.');
  END IF;

  RETURN jsonb_build_object(
    'ok', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'account_id', p_account_id,
    'business_name', v_acct.business_name,
    'agreement_signed_at', v_acct.agreement_signed_at,
    'coi', v_coi,
    'coi_status', v_status,
    'coi_expires_at', v_acct.coi_expires_at,
    'coi_sent_at', v_acct.coi_sent_at,
    'billing', v_billing,
    'billing_configured', (v_billing ->> 'configured')::boolean,
    'company_coi_sent_at', v_acct.company_coi_sent_at,
    'active_site_count', v_sites
  );
END;
$$;

-- ─── 12. One read: may this site be booked and dispatched? ─────────────────
-- Four requirements, evaluated together, each reported by name. The point is
-- that a blocked site says WHICH of the four is outstanding — "not eligible"
-- on its own sends someone hunting through four different consoles.

CREATE OR REPLACE FUNCTION public.commercial_site_dispatch_eligibility(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site public.business_sites%ROWTYPE;
  v_acct public.business_accounts%ROWTYPE;
  v_pricing jsonb;
  v_compliance jsonb;
  v_billing jsonb;
  v_coi jsonb;
  v_reqs jsonb := '[]'::jsonb;
  v_outstanding text[] := ARRAY[]::text[];
  v_price_ok boolean;
  v_agreement_ok boolean;
  v_billing_ok boolean;
  v_coi_ok boolean;
  v_detail text;
BEGIN
  SELECT * INTO v_site FROM public.business_sites WHERE id = p_site_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'eligible', false,
                              'message', 'Site not found.');
  END IF;

  SELECT * INTO v_acct FROM public.business_accounts
  WHERE id = v_site.business_account_id;

  v_pricing := public.commercial_site_pricing_state(p_site_id);
  v_compliance := public.commercial_account_compliance(v_site.business_account_id);
  v_billing := v_compliance -> 'billing';
  v_coi := v_compliance -> 'coi';

  -- 1. Firm price
  v_price_ok := (v_pricing ->> 'eligible')::boolean;
  v_detail := CASE WHEN v_price_ok
    THEN CASE v_pricing ->> 'stage'
           WHEN 'formula_priced' THEN 'Priced by the rate engine — under the walkthrough threshold.'
           ELSE format('Firm price set: $%s per visit.',
                       to_char(COALESCE(v_site.firm_price_cents, 0) / 100.0, 'FM999999990.00'))
         END
    ELSE COALESCE(v_pricing ->> 'reason', 'This site has no firm price yet.')
  END;
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'firm_price', 'label', 'Firm price', 'met', v_price_ok, 'detail', v_detail,
    'fix_path', '/admin/partner?tab=walkthroughs');
  IF NOT v_price_ok THEN
    v_outstanding := array_append(v_outstanding, 'a firm price for this site');
  END IF;

  -- 2. Signed agreement
  v_agreement_ok := v_acct.agreement_signed_at IS NOT NULL;
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'signed_agreement', 'label', 'Signed agreement', 'met', v_agreement_ok,
    'detail', CASE WHEN v_agreement_ok
      THEN format('Signed %s.', to_char(v_acct.agreement_signed_at, 'Mon DD, YYYY'))
      ELSE 'No signed agreement on the account.' END,
    'fix_path', '/admin/partner?tab=proposals');
  IF NOT v_agreement_ok THEN
    v_outstanding := array_append(v_outstanding, 'a signed agreement');
  END IF;

  -- 3. Billing configured — either method counts
  v_billing_ok := (v_billing ->> 'configured')::boolean;
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'billing_configured', 'label', 'Billing configured', 'met', v_billing_ok,
    'detail', COALESCE(v_billing ->> 'summary', v_billing ->> 'reason'),
    'fix_path', '/admin/partner?tab=proposals');
  IF NOT v_billing_ok THEN
    v_outstanding := array_append(v_outstanding, 'billing setup');
  END IF;

  -- 4. Certificate of insurance current
  v_coi_ok := NOT COALESCE((v_coi ->> 'blocked')::boolean, true);
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'coi_current', 'label', 'Certificate of insurance', 'met', v_coi_ok,
    'detail', CASE
      WHEN v_coi_ok AND (v_coi -> 'override') IS NOT NULL
           AND (v_coi -> 'override') <> 'null'::jsonb
        THEN 'Block temporarily overridden — not the same as cover.'
      WHEN v_coi_ok THEN format('Current through %s.',
                                to_char(v_acct.coi_expires_at, 'Mon DD, YYYY'))
      WHEN v_acct.coi_expires_at IS NULL THEN 'No current certificate of insurance on file.'
      ELSE format('Expired %s.', to_char(v_acct.coi_expires_at, 'Mon DD, YYYY'))
    END,
    'fix_path', '/admin/partner?tab=compliance');
  IF NOT v_coi_ok THEN
    v_outstanding := array_append(v_outstanding, 'a current certificate of insurance');
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'eligible', cardinality(v_outstanding) = 0,
    'site_id', p_site_id,
    'site_nickname', v_site.nickname,
    'account_id', v_site.business_account_id,
    'business_name', v_acct.business_name,
    'requirements', v_reqs,
    'outstanding', to_jsonb(v_outstanding),
    'message', CASE WHEN cardinality(v_outstanding) = 0
      THEN format('%s is ready to book and dispatch.', v_site.nickname)
      ELSE format('%s at %s is not ready to dispatch — still outstanding: %s.',
                  v_site.nickname, v_acct.business_name,
                  array_to_string(v_outstanding, ', '))
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_site_dispatch_eligibility(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.commercial_site_dispatch_eligibility(uuid) IS
  'The four dispatch requirements for one site — firm price, signed agreement, configured billing, current COI — each reported by name so a refusal says what is actually missing.';

-- ─── 13. The deal pipeline ─────────────────────────────────────────────────

DROP VIEW IF EXISTS public.commercial_deal_pipeline_v1;
CREATE VIEW public.commercial_deal_pipeline_v1
WITH (security_invoker = true) AS
WITH latest_proposal AS (
  SELECT DISTINCT ON (business_account_id)
    business_account_id, id, version, status, sent_at, expires_at,
    accepted_at, changes_requested_at, change_request_note,
    total_per_visit_cents, recipient_email, recipient_name
  FROM public.commercial_proposals
  ORDER BY business_account_id, version DESC
),
latest_agreement AS (
  SELECT DISTINCT ON (business_account_id)
    business_account_id, id, status, sent_at, signed_at, signer_email
  FROM public.commercial_agreements
  ORDER BY business_account_id, created_at DESC
),
site_rollup AS (
  SELECT
    s.business_account_id,
    count(*) FILTER (WHERE s.active)                              AS active_sites,
    count(*) FILTER (WHERE s.active AND s.excluded_at IS NOT NULL) AS excluded_sites,
    count(*) FILTER (
      WHERE s.active AND s.excluded_at IS NULL
        AND (public.commercial_site_pricing_state(s.id) ->> 'eligible')::boolean
    )                                                              AS priced_sites
  FROM public.business_sites s
  GROUP BY s.business_account_id
)
SELECT
  a.id                                        AS account_id,
  a.business_name,
  a.account_type,
  a.status                                    AS account_status,
  a.email,
  a.contact_name,
  a.assigned_va_email,
  COALESCE(r.active_sites, 0)                 AS active_sites,
  COALESCE(r.priced_sites, 0)                 AS priced_sites,
  COALESCE(r.excluded_sites, 0)               AS excluded_sites,
  p.id                                        AS proposal_id,
  p.version                                   AS proposal_version,
  p.status                                    AS proposal_status,
  p.sent_at                                   AS proposal_sent_at,
  p.expires_at                                AS proposal_expires_at,
  p.accepted_at                               AS proposal_accepted_at,
  p.changes_requested_at,
  p.change_request_note,
  p.total_per_visit_cents,
  g.id                                        AS agreement_id,
  g.status                                    AS agreement_status,
  g.sent_at                                   AS agreement_sent_at,
  g.signed_at                                 AS agreement_signed_at,
  a.billing_method,
  a.billing_configured_at,
  a.company_coi_sent_at,
  a.requires_coi_on_file,
  (public.commercial_billing_state(a.id) ->> 'configured')::boolean AS billing_configured,
  (public.commercial_coi_status(a.id) ->> 'blocked')::boolean       AS coi_blocked,
  -- Where the deal actually is. Read top-down: the furthest stage whose
  -- evidence exists.
  --
  -- dispatch_eligible here means the SAME four things
  -- commercial_site_dispatch_eligibility enforces — firm price, signed
  -- agreement, configured billing, current certificate. A console that shows
  -- a green account the booking function then refuses is worse than no
  -- console, so the two agree by construction rather than by intention.
  CASE
    WHEN a.agreement_signed_at IS NOT NULL
     AND (public.commercial_billing_state(a.id) ->> 'configured')::boolean
     AND NOT (public.commercial_coi_status(a.id) ->> 'blocked')::boolean
     AND COALESCE(r.priced_sites, 0) > 0
     AND COALESCE(r.priced_sites, 0) = COALESCE(r.active_sites, 0) - COALESCE(r.excluded_sites, 0)
      THEN 'dispatch_eligible'
    -- Signed and billable, but the certificate is the thing standing in the
    -- way. Named separately because it is fixed in a different console.
    WHEN a.agreement_signed_at IS NOT NULL
     AND (public.commercial_billing_state(a.id) ->> 'configured')::boolean
     AND (public.commercial_coi_status(a.id) ->> 'blocked')::boolean
      THEN 'coi_blocked'
    -- Everything else is done and the paperwork outran the pricing.
    WHEN a.agreement_signed_at IS NOT NULL
     AND (public.commercial_billing_state(a.id) ->> 'configured')::boolean
      THEN 'pricing_pending'
    WHEN a.agreement_signed_at IS NOT NULL THEN 'billing_pending'
    WHEN g.status = 'pending' THEN 'agreement_sent'
    WHEN p.status = 'accepted' THEN 'proposal_accepted'
    WHEN p.status = 'changes_requested' THEN 'changes_requested'
    WHEN p.status = 'sent' THEN 'proposal_sent'
    WHEN p.status = 'expired' THEN 'proposal_expired'
    WHEN COALESCE(r.priced_sites, 0) > 0
     AND COALESCE(r.priced_sites, 0) = COALESCE(r.active_sites, 0) - COALESCE(r.excluded_sites, 0)
      THEN 'firm_price_ready'
    ELSE 'pricing_pending'
  END                                          AS stage
FROM public.business_accounts a
LEFT JOIN latest_proposal p ON p.business_account_id = a.id
LEFT JOIN latest_agreement g ON g.business_account_id = a.id
LEFT JOIN site_rollup r ON r.business_account_id = a.id
WHERE a.account_type IN ('commercial', 'office');

COMMENT ON VIEW public.commercial_deal_pipeline_v1 IS
  'Commercial deals by stage: pricing_pending → firm_price_ready → proposal_sent → changes_requested → proposal_accepted → agreement_sent → billing_pending → dispatch_eligible.';

-- ─── 14. Readiness to propose ──────────────────────────────────────────────
-- Which of an account's sites may go on a proposal, and why the rest may not.
-- The API builds the proposal from this, so "cannot propose against an
-- estimate" is answered from one place.

CREATE OR REPLACE FUNCTION public.commercial_proposal_readiness(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sites jsonb := '[]'::jsonb;
  v_blocked text[] := ARRAY[]::text[];
  v_ready integer := 0;
  r RECORD;
  v_state jsonb;
  v_price integer;
  v_source text;
BEGIN
  FOR r IN
    SELECT * FROM public.business_sites
    WHERE business_account_id = p_account_id AND active
    ORDER BY nickname
  LOOP
    v_state := public.commercial_site_pricing_state(r.id);

    IF (v_state ->> 'eligible')::boolean THEN
      -- A site under the threshold has no firm_price_cents of its own; the
      -- engine prices it at quote time. Either way the proposal needs a
      -- number, so the caller resolves the formula price before building.
      v_price := r.firm_price_cents;
      v_source := CASE WHEN v_state ->> 'stage' = 'formula_priced'
                       THEN 'formula' ELSE 'walkthrough' END;
      v_ready := v_ready + 1;
      v_sites := v_sites || jsonb_build_object(
        'site_id', r.id,
        'nickname', r.nickname,
        'address', concat_ws(', ', r.address, r.city, r.state, r.zip_code),
        'facility_type', COALESCE(r.facility_type_key, r.facility_type),
        'scope_level', r.scope_level,
        'sqft', r.sqft,
        'crew_size', r.recommended_crew_size,
        'service_window_start', r.service_window_start,
        'service_window_end', r.service_window_end,
        'firm_price_cents', v_price,
        'price_source', v_source,
        'walkthrough_id', r.walkthrough_id,
        'pricing_confirmed_at', r.pricing_confirmed_at,
        'ready', true
      );
    ELSE
      v_blocked := array_append(v_blocked,
        format('%s — %s', r.nickname,
               COALESCE(v_state ->> 'reason', 'no firm price yet')));
      v_sites := v_sites || jsonb_build_object(
        'site_id', r.id,
        'nickname', r.nickname,
        'stage', v_state ->> 'stage',
        'reason', v_state ->> 'reason',
        'ready', false
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'account_id', p_account_id,
    'sites', v_sites,
    'ready_count', v_ready,
    'blocked', to_jsonb(v_blocked),
    -- Every site must be priced, and there must be at least one. Proposing a
    -- subset silently would mean the client accepts a schedule that omits
    -- locations they asked about.
    'can_propose', v_ready > 0 AND cardinality(v_blocked) = 0,
    'reason', CASE
      WHEN v_ready = 0 AND cardinality(v_blocked) = 0
        THEN 'This account has no active sites to propose.'
      WHEN cardinality(v_blocked) > 0
        THEN format('%s site(s) still need a firm price: %s',
                    cardinality(v_blocked), array_to_string(v_blocked, '; '))
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_proposal_readiness(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_proposal_setting_int(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_proposal_setting_text(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mint_commercial_token() TO service_role;

-- ─── 15. Proposal expiry ───────────────────────────────────────────────────
-- A proposal that sat unacted-on past its window lapses on its own. Run from
-- the sweep, but written as SQL so the rule is one statement rather than
-- application logic that only runs when a function is deployed.

CREATE OR REPLACE FUNCTION public.expire_stale_commercial_proposals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH lapsed AS (
    UPDATE public.commercial_proposals
    SET status = 'expired',
        expired_at = now(),
        token = NULL,
        updated_at = now()
    WHERE status = 'sent'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING id, business_account_id, version
  )
  INSERT INTO public.events (event_type, source, summary, data)
  SELECT
    'commercial.proposal.expired',
    'commercial-proposals',
    format('Proposal v%s for %s lapsed unacted-on and its link is now dead.',
           l.version, a.business_name),
    jsonb_build_object('proposal_id', l.id, 'account_id', l.business_account_id,
                       'version', l.version)
  FROM lapsed l
  JOIN public.business_accounts a ON a.id = l.business_account_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_commercial_proposals() TO service_role;

-- ─── 16. Alert routing ─────────────────────────────────────────────────────
-- Deal-stage movement is revenue news; anything that blocks dispatch or leaves
-- a client holding a stale certificate is an operations problem.

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('commercial.proposal.sent',              'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('commercial.proposal.accepted',          'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('commercial.proposal.changes_requested', 'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('commercial.proposal.expiring',          'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('commercial.proposal.expired',           'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_SALES']),
  ('commercial.agreement.signed',           'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('commercial.billing.configured',         'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('commercial.billing.stalled',            'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('company_coi.delivered',                 'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('company_coi.delivery_failed',           'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('company_coi.expiring',                  'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- ─── 17. Sweep schedule ────────────────────────────────────────────────────
-- Hourly at :40 — expires lapsed proposals, nudges the ones about to lapse,
-- and warns when our own certificate is running out.

DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — schedule commercial-proposal-sweep manually.';
    RETURN;
  END IF;

  SELECT value INTO v_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  SELECT value INTO v_key FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Supabase URL/key not in app_secrets — schedule commercial-proposal-sweep manually.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('commercial-proposal-sweep')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'commercial-proposal-sweep');

  PERFORM cron.schedule(
    'commercial-proposal-sweep',
    '40 * * * *',
    format(
      $cron$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
        body := '{}'::jsonb
      );$cron$,
      v_url || '/functions/v1/commercial-proposal-sweep',
      'Bearer ' || v_key
    )
  );
END;
$$;
