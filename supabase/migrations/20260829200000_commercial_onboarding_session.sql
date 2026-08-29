-- ─── Consolidated tokenized commercial onboarding session ──────────────────
--
-- Adjustment to the commercial proposal-to-billing path. The PIPELINE is
-- unchanged — firm price → proposal → agreement → billing → COI →
-- dispatch-eligible, same order, same gates. What changes is DELIVERY: instead
-- of emailing a proposal link and then a second agreement link, the account
-- moves through ONE tokenized session covering pricing review, signature,
-- billing setup, portal account creation and status.
--
-- Two decisions shape this table:
--
--   1. THE SESSION STORES ALMOST NO PROGRESS. Whether pricing is accepted
--      lives on commercial_proposals; whether it is signed lives on
--      commercial_agreements; whether billing is configured is a GENERATED
--      column on commercial_billing_profiles. The session derives its step
--      from those records (see commercial_onboarding_progress) rather than
--      keeping a second copy that could disagree with the dispatch gate.
--      A session cannot say "billing done" when the gate says otherwise.
--
--   2. THE BILLING METHOD IS CHOSEN BY ADMIN BEFORE THE LINK IS SENT, and is
--      stored on the ACCOUNT (business_accounts.preferred_billing_method), not
--      on the session — it outlives any one session and drives the targeted
--      billing-setup link if it changes later. The client is never asked to
--      pick mid-flow; the session completes whichever method was selected.
--
-- Reuses: mint_commercial_token(), commercial_billing_state(),
-- commercial_account_compliance(), the events table, and the app_settings
-- tunable pattern. No parallel token, billing or compliance system.

-- ─── Tunables ──────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'commercial_onboarding_settings',
  jsonb_build_object(
    -- How long one onboarding link stays usable. Commercial signers routinely
    -- need to check with finance or IT between steps, so this is generous —
    -- the link is resumable by design, not single-use.
    'session_ttl_days', 30,
    -- Idle time before a part-finished session is surfaced to admin, matching
    -- the walkthrough/billing stall pattern.
    'stalled_after_hours', 72,
    -- Minimum password length when a client creates their portal login.
    'portal_min_password_length', 8
  ),
  'Consolidated commercial onboarding session: link lifetime, stall window, portal password rule.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.commercial_onboarding_setting_int(
  p_key text,
  p_default integer
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF((value -> p_key)::text, 'null')::integer,
    p_default
  )
  FROM public.app_settings
  WHERE key = 'commercial_onboarding_settings';
$$;

GRANT EXECUTE ON FUNCTION public.commercial_onboarding_setting_int(text, integer)
  TO authenticated, service_role;

-- ─── Account-level additions ───────────────────────────────────────────────

-- The admin's billing decision, made at approval. Deliberately NOT
-- business_accounts.billing_method: that column is trigger-synced from the
-- billing profile and reflects what is actually configured. This one is the
-- intent, set before anything is configured, and it is what the onboarding
-- session presents.
ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS preferred_billing_method text
    CHECK (preferred_billing_method IN ('auto_pay', 'invoiced')),
  ADD COLUMN IF NOT EXISTS preferred_billing_method_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS preferred_billing_method_set_by text,
  -- The portal login created during onboarding. Until this migration the
  -- commercial portal matched an auth user to an account by email equality
  -- alone, which cannot be provisioned deterministically (a signer's email is
  -- often not the account email). This is the explicit link; email matching
  -- stays as a fallback so existing accounts keep working.
  ADD COLUMN IF NOT EXISTS portal_user_id uuid,
  ADD COLUMN IF NOT EXISTS portal_created_at timestamptz;

COMMENT ON COLUMN public.business_accounts.preferred_billing_method IS
  'Admin decision at approval: how this account will be billed. Presented (not asked) in the onboarding session. business_accounts.billing_method is the configured reality; this is the intent.';
COMMENT ON COLUMN public.business_accounts.portal_user_id IS
  'auth.users id for the client portal login created during onboarding. Authoritative link; email matching remains a fallback for accounts provisioned before this existed.';

CREATE UNIQUE INDEX IF NOT EXISTS business_accounts_portal_user_uniq
  ON public.business_accounts (portal_user_id)
  WHERE portal_user_id IS NOT NULL;

-- ─── The session ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.commercial_onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,

  -- What the session carries the client through. The proposal is set at
  -- creation; the agreement appears when pricing is accepted.
  proposal_id uuid REFERENCES public.commercial_proposals(id) ON DELETE SET NULL,
  agreement_id uuid REFERENCES public.commercial_agreements(id) ON DELETE SET NULL,

  -- One token for the whole sequence. Nulled when the session closes, the
  -- same retire-on-completion pattern the proposal and agreement links use.
  token text,
  expires_at timestamptz NOT NULL,

  -- Snapshot of the admin's billing decision at the moment the link was
  -- generated. The account column is the live value; this records what this
  -- particular session was sent under.
  billing_method text NOT NULL CHECK (billing_method IN ('auto_pay', 'invoiced')),

  -- Who it went to.
  recipient_name text,
  recipient_email text,
  recipient_phone text,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'expired', 'cancelled', 'superseded')),

  sent_at timestamptz,
  send_count integer NOT NULL DEFAULT 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,

  -- Drives the stall signal. Bumped by any client action, not by mere views,
  -- so a signer who keeps reopening the link without progressing still
  -- surfaces as stalled.
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_completed_step text,

  completed_at timestamptz,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A live link must be a usable one.
ALTER TABLE public.commercial_onboarding_sessions
  DROP CONSTRAINT IF EXISTS commercial_onboarding_sessions_active_shape;
ALTER TABLE public.commercial_onboarding_sessions
  ADD CONSTRAINT commercial_onboarding_sessions_active_shape
  CHECK (status <> 'active' OR token IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_onboarding_sessions_token_uniq
  ON public.commercial_onboarding_sessions (token)
  WHERE token IS NOT NULL;

-- One live session per account. A re-issued link supersedes the previous one
-- rather than leaving two valid entry points into the same onboarding.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_onboarding_sessions_one_active
  ON public.commercial_onboarding_sessions (business_account_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS commercial_onboarding_sessions_account_idx
  ON public.commercial_onboarding_sessions (business_account_id, created_at DESC);

COMMENT ON TABLE public.commercial_onboarding_sessions IS
  'One tokenized session carrying a commercial client through pricing review, signature, billing setup, portal creation and status. Progress is derived from the underlying proposal/agreement/billing records, never duplicated here.';

-- ─── Client submissions (extra sites, documents) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.commercial_onboarding_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.commercial_onboarding_sessions(id) ON DELETE SET NULL,
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN ('site_request', 'document', 'note')),

  -- site_request. Captured as free text on purpose: a requested site is a
  -- lead for a walkthrough, not a priced site. Nothing here is ever promoted
  -- to business_sites automatically.
  site_nickname text,
  site_address text,
  site_city text,
  site_state text,
  site_zip text,
  site_sqft integer,

  -- document
  document_path text,
  document_name text,
  document_size_bytes integer,

  note text,

  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewed_at timestamptz,
  reviewed_by_name text,
  review_note text
);

CREATE INDEX IF NOT EXISTS commercial_onboarding_submissions_account_idx
  ON public.commercial_onboarding_submissions (business_account_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS commercial_onboarding_submissions_pending_idx
  ON public.commercial_onboarding_submissions (status, submitted_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE public.commercial_onboarding_submissions IS
  'Things a client sends during or after onboarding: a request to add a site, or a document. Never auto-applied to pricing, scope or billing — a human reviews and acts. A requested site still needs its own walkthrough per the sqft threshold.';

-- Private bucket for client-supplied paperwork (W-9, tax exemption, their own
-- COI). Same posture as commercial-agreements: no public read.
INSERT INTO storage.buckets (id, name, public)
VALUES ('commercial-onboarding-uploads', 'commercial-onboarding-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- ─── Progress, derived ─────────────────────────────────────────────────────

-- The single source of "where is this session". Reads the real records so the
-- checklist a client sees and the gate that lets a site dispatch can never
-- tell two different stories.
CREATE OR REPLACE FUNCTION public.commercial_onboarding_progress(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session   public.commercial_onboarding_sessions%ROWTYPE;
  v_proposal  public.commercial_proposals%ROWTYPE;
  v_agreement public.commercial_agreements%ROWTYPE;
  v_account   public.business_accounts%ROWTYPE;
  v_billing   jsonb;
  v_pricing   boolean := false;
  v_signed    boolean := false;
  v_billed    boolean := false;
  v_portal    boolean := false;
  v_paused    boolean := false;
  v_current   text;
BEGIN
  SELECT * INTO v_session FROM public.commercial_onboarding_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_account FROM public.business_accounts WHERE id = v_session.business_account_id;

  IF v_session.proposal_id IS NOT NULL THEN
    SELECT * INTO v_proposal FROM public.commercial_proposals WHERE id = v_session.proposal_id;
  END IF;
  IF v_session.agreement_id IS NOT NULL THEN
    SELECT * INTO v_agreement FROM public.commercial_agreements WHERE id = v_session.agreement_id;
  END IF;

  -- 1. Pricing. Accepted on the proposal, or already past it if an agreement
  --    exists (a session created after acceptance is still resumable).
  v_pricing := COALESCE(v_proposal.status = 'accepted', false)
               OR v_agreement.id IS NOT NULL;
  v_paused  := COALESCE(v_proposal.status = 'changes_requested', false);

  -- 2. Signature.
  v_signed := COALESCE(v_agreement.status = 'signed', false);

  -- 3. Billing — the generated `configured` column, same value the dispatch
  --    gate reads.
  v_billing := public.commercial_billing_state(v_session.business_account_id);
  v_billed  := COALESCE((v_billing ->> 'configured')::boolean, false);

  -- 4. Portal login.
  v_portal := v_account.portal_user_id IS NOT NULL;

  v_current := CASE
    WHEN v_paused        THEN 'paused'
    WHEN NOT v_pricing   THEN 'pricing'
    WHEN NOT v_signed    THEN 'agreement'
    WHEN NOT v_billed    THEN 'billing'
    WHEN NOT v_portal    THEN 'portal'
    ELSE 'done'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'account_id', v_session.business_account_id,
    'status', v_session.status,
    'billing_method', v_session.billing_method,
    'current_step', v_current,
    'paused_for_changes', v_paused,
    'complete', (v_pricing AND v_signed AND v_billed AND v_portal),
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'pricing',   'label', 'Review pricing and terms', 'done', v_pricing),
      jsonb_build_object('key', 'agreement', 'label', 'Sign the services agreement', 'done', v_signed),
      jsonb_build_object('key', 'billing',   'label',
        CASE WHEN v_session.billing_method = 'auto_pay'
             THEN 'Add a payment method for Auto-Pay'
             ELSE 'Confirm your billing contact and terms' END,
        'done', v_billed),
      jsonb_build_object('key', 'portal',    'label', 'Create your portal login', 'done', v_portal)
    ),
    -- What remains outside the client's control, so the checklist can show it
    -- as pending-on-us rather than pending-on-them.
    'compliance', public.commercial_account_compliance(v_session.business_account_id),
    'billing', v_billing
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_onboarding_progress(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.commercial_onboarding_progress(uuid) IS
  'Derives session step state from the proposal, agreement, billing profile and portal link. The session table stores no duplicate of any of these.';

-- ─── Admin visibility, including stalled sessions ──────────────────────────

DROP VIEW IF EXISTS public.commercial_onboarding_sessions_v1;
CREATE VIEW public.commercial_onboarding_sessions_v1
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.business_account_id,
  a.business_name,
  a.account_type,
  s.proposal_id,
  s.agreement_id,
  s.status,
  s.billing_method,
  s.recipient_name,
  s.recipient_email,
  s.recipient_phone,
  s.sent_at,
  s.send_count,
  s.first_viewed_at,
  s.last_viewed_at,
  s.view_count,
  s.last_activity_at,
  s.last_completed_step,
  s.expires_at,
  s.completed_at,
  s.created_by_name,
  s.created_at,
  (s.token IS NOT NULL) AS link_live,
  progress.value ->> 'current_step'                        AS current_step,
  (progress.value ->> 'paused_for_changes')::boolean       AS paused_for_changes,
  (progress.value ->> 'complete')::boolean                 AS complete,
  progress.value -> 'steps'                                AS steps,

  -- Hours idle since the client last did something.
  (EXTRACT(EPOCH FROM (now() - s.last_activity_at)) / 3600.0)::numeric(10, 1) AS idle_hours,

  -- Stalled: live, started, not finished, and quiet for longer than the
  -- configured window. Same shape as walkthrough_pipeline_v1.stalled so the
  -- admin surfaces read consistently.
  (
    s.status = 'active'
    AND s.sent_at IS NOT NULL
    AND COALESCE((progress.value ->> 'complete')::boolean, false) = false
    AND now() - s.last_activity_at >
        (public.commercial_onboarding_setting_int('stalled_after_hours', 72) || ' hours')::interval
  ) AS stalled,

  (s.expires_at < now()) AS expired,

  (
    SELECT count(*)::int
    FROM public.commercial_onboarding_submissions sub
    WHERE sub.business_account_id = s.business_account_id
      AND sub.status = 'pending'
  ) AS pending_submissions
FROM public.commercial_onboarding_sessions s
JOIN public.business_accounts a ON a.id = s.business_account_id
CROSS JOIN LATERAL (
  SELECT public.commercial_onboarding_progress(s.id) AS value
) AS progress;

COMMENT ON VIEW public.commercial_onboarding_sessions_v1 IS
  'Onboarding sessions with derived step, idle time and stall flag, for the admin commercial pipeline.';

GRANT SELECT ON public.commercial_onboarding_sessions_v1 TO authenticated, service_role;

-- ─── RLS ───────────────────────────────────────────────────────────────────
--
-- No anon policy anywhere. The tokenized client routes read and write with the
-- service role after resolving the token, exactly as the proposal and
-- agreement routes do — the token is the credential, checked in application
-- code, never exposed as a database grant.

ALTER TABLE public.commercial_onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_onboarding_submissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'commercial_onboarding_sessions'
      AND policyname = 'commercial_onboarding_sessions_admin'
  ) THEN
    CREATE POLICY commercial_onboarding_sessions_admin
      ON public.commercial_onboarding_sessions
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'commercial_onboarding_sessions'
      AND policyname = 'commercial_onboarding_sessions_service'
  ) THEN
    CREATE POLICY commercial_onboarding_sessions_service
      ON public.commercial_onboarding_sessions
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'commercial_onboarding_submissions'
      AND policyname = 'commercial_onboarding_submissions_admin'
  ) THEN
    CREATE POLICY commercial_onboarding_submissions_admin
      ON public.commercial_onboarding_submissions
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'commercial_onboarding_submissions'
      AND policyname = 'commercial_onboarding_submissions_service'
  ) THEN
    CREATE POLICY commercial_onboarding_submissions_service
      ON public.commercial_onboarding_submissions
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Storage: admin + service role only, never public read.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'commercial_onboarding_uploads_admin'
  ) THEN
    CREATE POLICY commercial_onboarding_uploads_admin
      ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'commercial-onboarding-uploads' AND public.is_admin_or_va(auth.uid()))
      WITH CHECK (bucket_id = 'commercial-onboarding-uploads' AND public.is_admin_or_va(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'commercial_onboarding_uploads_service'
  ) THEN
    CREATE POLICY commercial_onboarding_uploads_service
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'commercial-onboarding-uploads')
      WITH CHECK (bucket_id = 'commercial-onboarding-uploads');
  END IF;
END $$;

-- ─── Alerting ──────────────────────────────────────────────────────────────

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys)
VALUES
  ('commercial.onboarding.stalled', 'DISCORD_WEBHOOK_REVENUE', ARRAY[]::text[]),
  ('commercial.onboarding.submission', 'DISCORD_WEBHOOK_REVENUE', ARRAY[]::text[]),
  ('commercial.onboarding.completed', 'DISCORD_WEBHOOK_REVENUE', ARRAY[]::text[])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key;

NOTIFY pgrst, 'reload schema';
