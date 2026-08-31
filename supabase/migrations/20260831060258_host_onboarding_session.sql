-- ─── Tokenized Host Onboarding session ────────────────────────────────────
--
-- One unique link, sent when a priced host proposal / agreement goes out,
-- carrying the host through Legal → Property & Rate Schedule → Payment
-- inside a single resumable session. Mirrors commercial_onboarding_sessions
-- without depending on the official commercial migration chain.
--
-- CREATE / ADD COLUMN IF NOT EXISTS so later official files can still run.

-- ─── Tunables ──────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'host_onboarding_settings',
  jsonb_build_object(
    'session_ttl_days', 30,
    'stalled_after_hours', 72,
    'portal_min_password_length', 8
  ),
  'Tokenized host onboarding: link lifetime, stall window, portal password rule.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.host_onboarding_setting_int(
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
  WHERE key = 'host_onboarding_settings';
$$;

GRANT EXECUTE ON FUNCTION public.host_onboarding_setting_int(text, integer)
  TO authenticated, service_role;

-- ─── Token mint (app-side fallback exists; this is what the edge fn uses) ──

CREATE OR REPLACE FUNCTION public.mint_host_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
$$;

GRANT EXECUTE ON FUNCTION public.mint_host_token() TO service_role;

-- ─── Host-level flags that outlive any one session ─────────────────────────

ALTER TABLE public.hosts
  ADD COLUMN IF NOT EXISTS pay_after_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_payment_option text
    CHECK (preferred_payment_option IS NULL OR preferred_payment_option IN ('full', 'split', 'pay_after'));

COMMENT ON COLUMN public.hosts.pay_after_enabled IS
  'Company discretion (Agreement §6.2): Pay After is offered only when this is true. Default false — the option is absent, not merely disabled, on the host onboarding session.';

-- ─── Signed Host Partnership Agreement ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.host_partnership_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.hosts(id) ON DELETE CASCADE,
  session_id uuid,
  submission_id uuid REFERENCES public.host_onboarding_submissions(id) ON DELETE SET NULL,
  signer_name text NOT NULL,
  signer_email text,
  entity_type text,
  entity_name text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  signature_path text,
  document_path text,
  acknowledged_non_circumvention boolean NOT NULL DEFAULT false,
  acknowledged_chargebacks boolean NOT NULL DEFAULT false,
  acknowledged_arbitration boolean NOT NULL DEFAULT false,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_partnership_agreements_host_idx
  ON public.host_partnership_agreements (host_id, signed_at DESC);

-- ─── The session ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.host_onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.hosts(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES public.host_onboarding_submissions(id) ON DELETE SET NULL,
  agreement_id uuid REFERENCES public.host_partnership_agreements(id) ON DELETE SET NULL,

  -- Frozen property + admin-set rate schedule at send time (Agreement §5.2 / §17).
  -- The host confirms or flags these rows; they never edit a rate from the session.
  property_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,

  token text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'superseded', 'cancelled')),

  recipient_name text,
  recipient_email text,
  recipient_phone text,

  -- Snapshot of Company discretion at send time. Live value lives on hosts.
  pay_after_enabled boolean NOT NULL DEFAULT false,
  payment_option text
    CHECK (payment_option IS NULL OR payment_option IN ('full', 'split', 'pay_after')),
  stripe_setup_session_id text,
  payment_method_id text,
  payment_setup_at timestamptz,

  portal_user_id uuid,
  portal_provisioned_at timestamptz,

  signed_at timestamptz,
  signer_name text,
  rates_confirmed_at timestamptz,

  sent_at timestamptz,
  send_count integer NOT NULL DEFAULT 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_completed_step text,
  completed_at timestamptz,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS host_onboarding_sessions_token_uniq
  ON public.host_onboarding_sessions (token)
  WHERE token IS NOT NULL;

CREATE INDEX IF NOT EXISTS host_onboarding_sessions_host_idx
  ON public.host_onboarding_sessions (host_id, created_at DESC);

CREATE INDEX IF NOT EXISTS host_onboarding_sessions_status_idx
  ON public.host_onboarding_sessions (status, last_activity_at);

-- session_id on agreements is set after insert; add the FK now that both exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'host_partnership_agreements_session_fk'
  ) THEN
    ALTER TABLE public.host_partnership_agreements
      ADD CONSTRAINT host_partnership_agreements_session_fk
      FOREIGN KEY (session_id) REFERENCES public.host_onboarding_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── Flags, extra-property requests (never auto-priced) ────────────────────

CREATE TABLE IF NOT EXISTS public.host_onboarding_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.host_onboarding_sessions(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES public.hosts(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('property_decision', 'additional_property')),
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  decision text
    CHECK (decision IS NULL OR decision IN ('confirmed', 'flagged')),
  note text,
  requested_nickname text,
  requested_address text,
  requested_bedrooms numeric,
  requested_bathrooms numeric,
  requested_notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  submitted_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_name text
);

CREATE UNIQUE INDEX IF NOT EXISTS host_onboarding_session_items_decision_uniq
  ON public.host_onboarding_session_items (session_id, property_id)
  WHERE kind = 'property_decision' AND property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS host_onboarding_session_items_pending_idx
  ON public.host_onboarding_session_items (status, created_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE public.host_onboarding_session_items IS
  'Host actions during onboarding: confirm/flag a proposed property, or request an additional one. Flags and extra-property requests route to admin and are never auto-priced or auto-added.';

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.host_partnership_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_onboarding_session_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'host_onboarding_sessions' AND policyname = 'host_onb_sess_service'
  ) THEN
    CREATE POLICY host_onb_sess_service ON public.host_onboarding_sessions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'host_onboarding_sessions' AND policyname = 'host_onb_sess_admin'
  ) THEN
    CREATE POLICY host_onb_sess_admin ON public.host_onboarding_sessions
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'host_partnership_agreements' AND policyname = 'host_agree_service'
  ) THEN
    CREATE POLICY host_agree_service ON public.host_partnership_agreements
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'host_partnership_agreements' AND policyname = 'host_agree_admin'
  ) THEN
    CREATE POLICY host_agree_admin ON public.host_partnership_agreements
      FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'host_onboarding_session_items' AND policyname = 'host_onb_items_service'
  ) THEN
    CREATE POLICY host_onb_items_service ON public.host_onboarding_session_items
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'host_onboarding_session_items' AND policyname = 'host_onb_items_admin'
  ) THEN
    CREATE POLICY host_onb_items_admin ON public.host_onboarding_session_items
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
END $$;

-- ─── Signed-document bucket ────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('host-agreements', 'host-agreements', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND policyname = 'host_agreements_admin_read'
  ) THEN
    CREATE POLICY host_agreements_admin_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'host-agreements' AND public.is_admin_or_va(auth.uid()));
  END IF;
END $$;

-- ─── Progress (derived — session does not store a second copy) ─────────────

CREATE OR REPLACE FUNCTION public.host_onboarding_progress(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.host_onboarding_sessions%ROWTYPE;
  v_host    public.hosts%ROWTYPE;
  v_signed  boolean := false;
  v_rates   boolean := false;
  v_pay     boolean := false;
  v_portal  boolean := false;
  v_snap    int := 0;
  v_decided int := 0;
  v_current text;
BEGIN
  SELECT * INTO v_session FROM public.host_onboarding_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_host FROM public.hosts WHERE id = v_session.host_id;

  v_signed := v_session.signed_at IS NOT NULL OR v_session.agreement_id IS NOT NULL;

  v_snap := COALESCE(jsonb_array_length(v_session.property_snapshot), 0);
  SELECT count(*)::int INTO v_decided
  FROM public.host_onboarding_session_items i
  WHERE i.session_id = v_session.id
    AND i.kind = 'property_decision'
    AND i.decision IN ('confirmed', 'flagged');
  v_rates := v_snap > 0 AND v_decided >= v_snap;

  v_pay := v_session.payment_option IS NOT NULL
           AND (
             v_session.payment_method_id IS NOT NULL
             OR v_session.payment_setup_at IS NOT NULL
             OR COALESCE(v_host.default_payment_method_id, '') <> ''
           );

  v_portal := v_session.portal_user_id IS NOT NULL
              OR v_host.user_id IS NOT NULL;

  v_current := CASE
    WHEN NOT v_signed THEN 'legal'
    WHEN NOT v_rates  THEN 'rates'
    WHEN NOT v_pay OR NOT v_portal THEN 'payment'
    ELSE 'done'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'host_id', v_session.host_id,
    'status', v_session.status,
    'current_step', v_current,
    'complete', (v_signed AND v_rates AND v_pay AND v_portal),
    'signed', v_signed,
    'rates_ready', v_rates,
    'payment_ready', v_pay,
    'portal_ready', v_portal,
    'pay_after_enabled', COALESCE(v_host.pay_after_enabled, v_session.pay_after_enabled, false),
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'legal',   'label', 'Legal & Signature', 'done', v_signed),
      jsonb_build_object('key', 'rates',   'label', 'Property & Rate Schedule', 'done', v_rates),
      jsonb_build_object('key', 'payment', 'label', 'Payment Setup', 'done', (v_pay AND v_portal))
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.host_onboarding_progress(uuid)
  TO authenticated, service_role;

-- ─── Admin visibility, including stalled sessions ──────────────────────────

DROP VIEW IF EXISTS public.host_onboarding_sessions_v1;
CREATE VIEW public.host_onboarding_sessions_v1
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.host_id,
  h.name  AS host_name,
  h.email AS host_email,
  h.phone AS host_phone,
  h.pay_after_enabled,
  s.submission_id,
  s.agreement_id,
  s.status,
  s.recipient_name,
  s.recipient_email,
  s.recipient_phone,
  s.payment_option,
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
  progress.value ->> 'current_step' AS current_step,
  (progress.value ->> 'complete')::boolean AS complete,
  progress.value -> 'steps' AS steps,
  (EXTRACT(EPOCH FROM (now() - s.last_activity_at)) / 3600.0)::numeric(10, 1) AS idle_hours,
  (
    s.status = 'active'
    AND s.sent_at IS NOT NULL
    AND COALESCE((progress.value ->> 'complete')::boolean, false) = false
    AND now() - s.last_activity_at >
        (public.host_onboarding_setting_int('stalled_after_hours', 72) || ' hours')::interval
  ) AS stalled,
  (s.expires_at < now()) AS expired,
  (
    SELECT count(*)::int
    FROM public.host_onboarding_session_items i
    WHERE i.session_id = s.id AND i.status = 'pending'
  ) AS pending_items
FROM public.host_onboarding_sessions s
JOIN public.hosts h ON h.id = s.host_id
CROSS JOIN LATERAL public.host_onboarding_progress(s.id) AS progress(value);

GRANT SELECT ON public.host_onboarding_sessions_v1 TO authenticated, service_role;

COMMENT ON VIEW public.host_onboarding_sessions_v1 IS
  'Host onboarding sessions with derived step, idle hours, and stalled flag for the admin needs-attention surface.';
