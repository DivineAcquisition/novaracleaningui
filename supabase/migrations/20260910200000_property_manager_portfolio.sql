-- ─── Property Manager: unit registry, turnovers, consolidated billing ─────
--
-- A third partner relationship type for long-term rental portfolios. It is
-- structurally the Host pattern (a registered portfolio, one Company-set rate
-- per unit, booked repeatedly without re-quoting) priced off the RESIDENTIAL
-- engine, but the trigger is a tenant lease turnover rather than a guest
-- calendar.
--
-- Why not the existing types:
--   • Commercial prices facility_type × scope_level × size_tier. A 2BR
--     apartment is not a facility with a scope tier.
--   • Host/STR assumes guests and a nightly cadence. There are none here —
--     work is event-driven off a move-out or a move-in.
--
-- The one behavior everything else hangs off: each unit's standing rates are
-- computed ONCE at registration and stored on the unit. Booking a turnover
-- reads that number. A property manager with twenty units cannot tolerate a
-- quote cycle every time a tenant leaves.
--
-- CREATE / ADD COLUMN IF NOT EXISTS throughout so this file is re-runnable.

-- ─── Tunables ──────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'property_manager_settings',
  jsonb_build_object(
    'session_ttl_days', 30,
    'stalled_after_hours', 72,
    -- A unit outside these bounds is materially outside normal residential
    -- size and routes to admin instead of auto-pricing.
    'review_min_sqft', 250,
    'review_max_sqft', 5000,
    'review_max_bedrooms', 5,
    -- Standing rates assume normal turnover condition. Anything heavier is a
    -- scope adjustment at the job, never a permanent rate change.
    'standing_condition', 'standard',
    -- A lease deadline with no stated time means end of that business day.
    'default_deadline_time', '17:00',
    'default_billing_method', 'invoiced',
    'default_invoice_cycle', 'monthly',
    'default_net_terms', 'net_15'
  ),
  'Property Manager portfolios: link lifetime, stall window, auto-price bounds, billing defaults.'
)
ON CONFLICT (key) DO NOTHING;

-- Admin-configurable volume discount. Thresholds AND percentages are data.
-- The discount comes entirely out of company margin: cleaner pay on every
-- job is computed off the full pre-discount value (see
-- property_manager_turnovers.pay_basis_cents).
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'property_manager_volume_discounts',
  jsonb_build_object(
    'enabled', true,
    'tiers', jsonb_build_array(
      jsonb_build_object('min_units', 1,  'percent', 0,  'label', 'Standard'),
      jsonb_build_object('min_units', 5,  'percent', 5,  'label', 'Portfolio 5+'),
      jsonb_build_object('min_units', 10, 'percent', 8,  'label', 'Portfolio 10+'),
      jsonb_build_object('min_units', 20, 'percent', 12, 'label', 'Portfolio 20+'),
      jsonb_build_object('min_units', 50, 'percent', 15, 'label', 'Portfolio 50+')
    )
  ),
  'Portfolio volume discount tiers by registered unit count. Margin-funded — never reduces cleaner pay.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pm_setting_int(p_key text, p_default integer)
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
  WHERE key = 'property_manager_settings';
$$;

GRANT EXECUTE ON FUNCTION public.pm_setting_int(text, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mint_pm_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
$$;

GRANT EXECUTE ON FUNCTION public.mint_pm_token() TO service_role;

-- ─── The account ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.property_manager_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'offboarded')),

  -- Invoiced is the default for this type: property managers reconcile
  -- monthly across many units rather than paying per job. Auto-Pay stays
  -- available for the ones who prefer it.
  billing_method text NOT NULL DEFAULT 'invoiced'
    CHECK (billing_method IN ('invoiced', 'auto_pay')),
  invoice_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (invoice_cycle IN ('weekly', 'biweekly', 'monthly')),
  net_terms text NOT NULL DEFAULT 'net_15'
    CHECK (net_terms IN ('on_receipt', 'net_15', 'net_30', 'net_45')),

  stripe_customer_id text,
  default_payment_method_id text,

  -- Snapshot of the tier the portfolio currently sits in. Authoritative
  -- discount lives on each unit's stored rate; this is for display and audit.
  volume_discount_percent numeric NOT NULL DEFAULT 0
    CHECK (volume_discount_percent >= 0 AND volume_discount_percent < 100),
  volume_discount_label text,
  volume_discount_reviewed_at timestamptz,

  user_id uuid,
  portal_provisioned_at timestamptz,
  notes text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_manager_accounts_email_idx
  ON public.property_manager_accounts (lower(email));
CREATE INDEX IF NOT EXISTS property_manager_accounts_status_idx
  ON public.property_manager_accounts (status, created_at DESC);

COMMENT ON TABLE public.property_manager_accounts IS
  'Long-term rental portfolio manager. Priced off the residential engine; work is triggered by lease turnover, not a booking calendar.';

-- ─── The unit registry (the core concept) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.property_manager_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_account_id uuid NOT NULL
    REFERENCES public.property_manager_accounts(id) ON DELETE CASCADE,

  -- Identity + the inputs the residential engine needs.
  unit_label text,
  address text NOT NULL,
  city text,
  state text,
  zip_code text,
  sqft integer,
  bedrooms numeric,
  bathrooms numeric,

  -- Zone is derived from the address (zip → pricing_zone_zips → pricing_zones)
  -- and frozen here so a stored rate can always be reconstructed.
  zone_code text,
  zone_multiplier numeric,
  home_size_id text,

  -- ── Standing rates, computed ONCE at registration ────────────────────────
  -- list_* is the full pre-discount residential value. It is the basis for
  -- cleaner pay on every job, always, discount or not.
  -- standing_* is what the property manager actually pays: list minus the
  -- portfolio volume discount, stored so the portal shows a real price and
  -- not a list price with a coupon at checkout.
  list_move_out_cents integer,
  list_move_in_cents integer,
  list_standard_cents integer,
  standing_move_out_cents integer,
  standing_move_in_cents integer,
  standing_standard_cents integer,
  discount_percent_applied numeric NOT NULL DEFAULT 0,
  rates_computed_at timestamptz,
  -- Full engine breakdown per service type, for audit and dispute.
  pricing_basis jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── Access, stored on the unit so it survives every turnover ─────────────
  access_method text,
  access_code text,
  access_notes text,
  parking_notes text,

  special_notes text,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_review', 'inactive')),
  -- Why this unit needed a human. NULL on the normal auto-priced path.
  review_reason text
    CHECK (review_reason IS NULL OR review_reason IN (
      'outside_size_bands', 'missing_size', 'too_many_bedrooms',
      'flagged_non_standard', 'zone_not_served', 'pricing_unavailable'
    )),
  review_note text,
  reviewed_at timestamptz,
  reviewed_by_name text,
  flagged_non_standard boolean NOT NULL DEFAULT false,

  source text NOT NULL DEFAULT 'admin'
    CHECK (source IN ('admin', 'onboarding', 'portal')),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_manager_units_account_idx
  ON public.property_manager_units (pm_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS property_manager_units_review_idx
  ON public.property_manager_units (status, created_at DESC)
  WHERE status = 'pending_review';

COMMENT ON TABLE public.property_manager_units IS
  'Registered rental units. Standing Move-Out / Move-In / Standard rates are Company-set at registration and read-only to the property manager.';
COMMENT ON COLUMN public.property_manager_units.list_move_out_cents IS
  'Full pre-discount residential value. Cleaner pay is computed off this, never off the discounted price.';
COMMENT ON COLUMN public.property_manager_units.standing_move_out_cents IS
  'What the property manager pays: list minus the portfolio volume discount. Stored so booking never triggers a quote.';
COMMENT ON COLUMN public.property_manager_units.access_code IS
  'Persisted on the unit across turnovers. Surfaced to an assigned cleaner only inside the existing time-scoped ACCESS window.';

-- ─── Turnovers (event-driven, deadline-anchored) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.property_manager_turnovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_account_id uuid NOT NULL
    REFERENCES public.property_manager_accounts(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL
    REFERENCES public.property_manager_units(id) ON DELETE RESTRICT,

  service_type text NOT NULL
    CHECK (service_type IN ('move_out', 'move_in', 'standard')),

  -- The hard constraint. Usually a lease date: "must be complete before the
  -- 1st". Dispatch schedules against this the way it does an STR check-in.
  needed_by_date date NOT NULL,
  needed_by_time time,

  scheduled_date date,
  window_start time,
  window_end time,

  -- Locked from the unit's standing rate at booking. No quote, no walkthrough.
  price_cents integer NOT NULL,
  -- Full pre-discount value of the same job.
  list_price_cents integer NOT NULL,
  discount_percent numeric NOT NULL DEFAULT 0,
  -- Raised by an approved scope adjustment; never lowered silently.
  final_price_cents integer,
  scope_adjustment_cents integer NOT NULL DEFAULT 0,
  -- Pay basis: full pre-discount value plus any approved scope delta. The
  -- volume discount is margin-funded and never reaches this number.
  pay_basis_cents integer GENERATED ALWAYS AS
    (list_price_cents + GREATEST(scope_adjustment_cents, 0)) STORED,

  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN (
      'scheduled', 'assigned', 'confirmed', 'in_progress',
      'completed', 'cancelled'
    )),

  -- The dispatch/QC job. Everything downstream (assignment, checklists,
  -- before/after photos, scope adjustments, cleaner pay) runs off this row
  -- through the paths that already exist.
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,

  notes text,
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,

  invoice_id uuid,
  invoiced_at timestamptz,

  booked_by_name text,
  booked_via text NOT NULL DEFAULT 'portal'
    CHECK (booked_via IN ('portal', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A schedule that lands after the deadline is not a schedule.
  CONSTRAINT pm_turnovers_schedule_within_deadline
    CHECK (scheduled_date IS NULL OR scheduled_date <= needed_by_date)
);

CREATE INDEX IF NOT EXISTS property_manager_turnovers_account_idx
  ON public.property_manager_turnovers (pm_account_id, needed_by_date DESC);
CREATE INDEX IF NOT EXISTS property_manager_turnovers_unit_idx
  ON public.property_manager_turnovers (unit_id, needed_by_date DESC);
CREATE INDEX IF NOT EXISTS property_manager_turnovers_open_idx
  ON public.property_manager_turnovers (needed_by_date, status)
  WHERE status IN ('scheduled', 'assigned', 'confirmed', 'in_progress');
CREATE INDEX IF NOT EXISTS property_manager_turnovers_uninvoiced_idx
  ON public.property_manager_turnovers (pm_account_id, completed_at)
  WHERE status = 'completed' AND invoice_id IS NULL;

COMMENT ON COLUMN public.property_manager_turnovers.needed_by_date IS
  'Hard scheduling deadline, typically a lease date. Copied to bookings.hard_deadline_at so dispatch treats it exactly like an STR check-in.';
COMMENT ON COLUMN public.property_manager_turnovers.pay_basis_cents IS
  'Full pre-discount value plus approved scope delta. Portfolio discounts are margin-funded and never reduce cleaner pay.';

-- ─── Consolidated invoices (one per period, itemized by unit) ──────────────

CREATE TABLE IF NOT EXISTS public.property_manager_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_account_id uuid NOT NULL
    REFERENCES public.property_manager_accounts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- One row per unit serviced in the period, each carrying its turnovers.
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  turnover_count integer NOT NULL DEFAULT 0,
  unit_count integer NOT NULL DEFAULT 0,
  subtotal_cents integer NOT NULL DEFAULT 0,
  stripe_invoice_id text,
  stripe_customer_id text,
  hosted_invoice_url text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  due_date date,
  issued_at timestamptz,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS property_manager_invoices_period_uniq
  ON public.property_manager_invoices (pm_account_id, period_start, period_end);

COMMENT ON TABLE public.property_manager_invoices IS
  'One consolidated invoice per billing period covering every turnover across the portfolio, itemized by unit. Never one invoice per turnover.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'property_manager_turnovers_invoice_fk'
  ) THEN
    ALTER TABLE public.property_manager_turnovers
      ADD CONSTRAINT property_manager_turnovers_invoice_fk
      FOREIGN KEY (invoice_id) REFERENCES public.property_manager_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── Signed services agreement ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.property_manager_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_account_id uuid NOT NULL
    REFERENCES public.property_manager_accounts(id) ON DELETE CASCADE,
  session_id uuid,
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

CREATE INDEX IF NOT EXISTS property_manager_agreements_account_idx
  ON public.property_manager_agreements (pm_account_id, signed_at DESC);

-- ─── Tokenized onboarding session (three pages, mirrors Host) ──────────────

CREATE TABLE IF NOT EXISTS public.property_manager_onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_account_id uuid NOT NULL
    REFERENCES public.property_manager_accounts(id) ON DELETE CASCADE,
  agreement_id uuid
    REFERENCES public.property_manager_agreements(id) ON DELETE SET NULL,

  -- Frozen registry + Company-set standing rates at send time. The property
  -- manager confirms or flags these rows; they never edit a rate.
  unit_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,

  token text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'superseded', 'cancelled')),

  recipient_name text,
  recipient_email text,
  recipient_phone text,

  billing_method text NOT NULL DEFAULT 'invoiced'
    CHECK (billing_method IN ('invoiced', 'auto_pay')),
  billing_configured_at timestamptz,
  stripe_setup_session_id text,
  payment_method_id text,

  portal_user_id uuid,
  portal_provisioned_at timestamptz,

  signed_at timestamptz,
  signer_name text,
  registry_confirmed_at timestamptz,

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

CREATE UNIQUE INDEX IF NOT EXISTS property_manager_onboarding_sessions_token_uniq
  ON public.property_manager_onboarding_sessions (token)
  WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS property_manager_onboarding_sessions_account_idx
  ON public.property_manager_onboarding_sessions (pm_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS property_manager_onboarding_sessions_status_idx
  ON public.property_manager_onboarding_sessions (status, last_activity_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'property_manager_agreements_session_fk'
  ) THEN
    ALTER TABLE public.property_manager_agreements
      ADD CONSTRAINT property_manager_agreements_session_fk
      FOREIGN KEY (session_id)
      REFERENCES public.property_manager_onboarding_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.property_manager_onboarding_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL
    REFERENCES public.property_manager_onboarding_sessions(id) ON DELETE CASCADE,
  pm_account_id uuid NOT NULL
    REFERENCES public.property_manager_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('unit_decision', 'additional_unit')),
  unit_id uuid REFERENCES public.property_manager_units(id) ON DELETE SET NULL,
  decision text CHECK (decision IS NULL OR decision IN ('confirmed', 'flagged')),
  note text,
  requested_label text,
  requested_address text,
  requested_sqft integer,
  requested_bedrooms numeric,
  requested_bathrooms numeric,
  requested_notes text,
  -- Set when an added unit auto-priced during the session rather than routing.
  auto_priced boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  submitted_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_name text
);

CREATE UNIQUE INDEX IF NOT EXISTS pm_onboarding_session_items_decision_uniq
  ON public.property_manager_onboarding_session_items (session_id, unit_id)
  WHERE kind = 'unit_decision' AND unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pm_onboarding_session_items_pending_idx
  ON public.property_manager_onboarding_session_items (status, created_at DESC)
  WHERE status = 'pending';

COMMENT ON TABLE public.property_manager_onboarding_session_items IS
  'Confirm/flag decisions on registered units and add-unit requests raised during onboarding. A flag never blocks the session.';

-- ─── Derived progress (the session stores facts, not a second copy) ────────

CREATE OR REPLACE FUNCTION public.property_manager_onboarding_progress(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.property_manager_onboarding_sessions%ROWTYPE;
  v_account public.property_manager_accounts%ROWTYPE;
  v_signed   boolean := false;
  v_registry boolean := false;
  v_billing  boolean := false;
  v_portal   boolean := false;
  v_snap     int := 0;
  v_decided  int := 0;
  v_current  text;
BEGIN
  SELECT * INTO v_session
  FROM public.property_manager_onboarding_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_account
  FROM public.property_manager_accounts WHERE id = v_session.pm_account_id;

  v_signed := v_session.signed_at IS NOT NULL OR v_session.agreement_id IS NOT NULL;

  v_snap := COALESCE(jsonb_array_length(v_session.unit_snapshot), 0);
  SELECT count(*)::int INTO v_decided
  FROM public.property_manager_onboarding_session_items i
  WHERE i.session_id = v_session.id
    AND i.kind = 'unit_decision'
    AND i.decision IN ('confirmed', 'flagged');
  v_registry := v_snap > 0 AND v_decided >= v_snap;

  -- Invoiced accounts are billing-ready once the contact is confirmed; there
  -- is no card to capture. Auto-Pay needs a payment method on file.
  v_billing := v_session.billing_configured_at IS NOT NULL
               AND (
                 v_session.billing_method = 'invoiced'
                 OR v_session.payment_method_id IS NOT NULL
                 OR COALESCE(v_account.default_payment_method_id, '') <> ''
               );

  v_portal := v_session.portal_user_id IS NOT NULL
              OR v_session.portal_provisioned_at IS NOT NULL
              OR v_account.portal_provisioned_at IS NOT NULL;

  v_current := CASE
    WHEN NOT v_signed   THEN 'legal'
    WHEN NOT v_registry THEN 'registry'
    WHEN NOT v_billing OR NOT v_portal THEN 'billing'
    ELSE 'done'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'pm_account_id', v_session.pm_account_id,
    'status', v_session.status,
    'current_step', v_current,
    'complete', (v_signed AND v_registry AND v_billing AND v_portal),
    'signed', v_signed,
    'registry_ready', v_registry,
    'billing_ready', v_billing,
    'portal_ready', v_portal,
    'billing_method', v_session.billing_method,
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'legal',    'label', 'Legal & Signature', 'done', v_signed),
      jsonb_build_object('key', 'registry', 'label', 'Unit Registry & Rates', 'done', v_registry),
      jsonb_build_object('key', 'billing',  'label', 'Billing & Portal', 'done', (v_billing AND v_portal))
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.property_manager_onboarding_progress(uuid)
  TO authenticated, service_role;

-- ─── Admin surfaces ────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.property_manager_onboarding_sessions_v1;
CREATE VIEW public.property_manager_onboarding_sessions_v1
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.pm_account_id,
  a.company_name,
  a.email AS account_email,
  a.phone AS account_phone,
  a.billing_method AS account_billing_method,
  s.agreement_id,
  s.status,
  s.recipient_name,
  s.recipient_email,
  s.recipient_phone,
  s.billing_method,
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
        (public.pm_setting_int('stalled_after_hours', 72) || ' hours')::interval
  ) AS stalled,
  (s.expires_at < now()) AS expired,
  (
    SELECT count(*)::int
    FROM public.property_manager_onboarding_session_items i
    WHERE i.session_id = s.id AND i.status = 'pending'
  ) AS pending_items
FROM public.property_manager_onboarding_sessions s
JOIN public.property_manager_accounts a ON a.id = s.pm_account_id
CROSS JOIN LATERAL public.property_manager_onboarding_progress(s.id) AS progress(value);

GRANT SELECT ON public.property_manager_onboarding_sessions_v1
  TO authenticated, service_role;

-- Open turnovers ordered by how close they are to their lease deadline. This
-- is what makes needed_by_date a scheduling constraint rather than a note.
DROP VIEW IF EXISTS public.property_manager_dispatch_queue_v1;
CREATE VIEW public.property_manager_dispatch_queue_v1
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.pm_account_id,
  a.company_name,
  t.unit_id,
  u.unit_label,
  u.address,
  u.city,
  u.zip_code,
  u.access_method,
  t.service_type,
  t.needed_by_date,
  t.needed_by_time,
  t.scheduled_date,
  t.status,
  t.booking_id,
  t.price_cents,
  t.pay_basis_cents,
  (t.needed_by_date - CURRENT_DATE) AS days_to_deadline,
  (t.scheduled_date IS NULL) AS unscheduled,
  (t.booking_id IS NULL) AS undispatched,
  (
    t.status IN ('scheduled', 'assigned', 'confirmed', 'in_progress')
    AND t.needed_by_date < CURRENT_DATE
  ) AS deadline_missed,
  (
    t.status IN ('scheduled', 'assigned', 'confirmed')
    AND t.scheduled_date IS NULL
    AND t.needed_by_date <= CURRENT_DATE + 3
  ) AS at_risk
FROM public.property_manager_turnovers t
JOIN public.property_manager_accounts a ON a.id = t.pm_account_id
JOIN public.property_manager_units u ON u.id = t.unit_id
WHERE t.status IN ('scheduled', 'assigned', 'confirmed', 'in_progress')
ORDER BY t.needed_by_date, t.created_at;

GRANT SELECT ON public.property_manager_dispatch_queue_v1
  TO authenticated, service_role;

COMMENT ON VIEW public.property_manager_dispatch_queue_v1 IS
  'Open turnovers ordered by lease deadline. needed_by_date is the hard constraint dispatch schedules against.';

-- ─── Portal identity, requests, QC tagging ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.partner_identity_property_managers (
  identity_id uuid NOT NULL
    REFERENCES public.partner_identities(id) ON DELETE CASCADE,
  pm_account_id uuid NOT NULL
    REFERENCES public.property_manager_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, pm_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_identity_property_managers_account_uniq
  ON public.partner_identity_property_managers (pm_account_id);

ALTER TABLE public.partner_login_tokens
  ADD COLUMN IF NOT EXISTS pm_account_id uuid
    REFERENCES public.property_manager_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.partner_login_tokens DROP CONSTRAINT IF EXISTS partner_login_tokens_onboarding_kind_check;
ALTER TABLE public.partner_login_tokens
  ADD CONSTRAINT partner_login_tokens_onboarding_kind_check
  CHECK (onboarding_kind IS NULL OR onboarding_kind IN ('host', 'commercial', 'property_manager'));

ALTER TABLE public.partner_portal_requests
  ADD COLUMN IF NOT EXISTS pm_account_id uuid
    REFERENCES public.property_manager_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pm_unit_id uuid
    REFERENCES public.property_manager_units(id) ON DELETE SET NULL;

ALTER TABLE public.partner_portal_requests DROP CONSTRAINT IF EXISTS partner_portal_requests_relationship_check;
ALTER TABLE public.partner_portal_requests
  ADD CONSTRAINT partner_portal_requests_relationship_check
  CHECK (relationship IN ('host', 'commercial', 'property_manager'));

ALTER TABLE public.partner_portal_requests DROP CONSTRAINT IF EXISTS partner_portal_requests_kind_check;
ALTER TABLE public.partner_portal_requests
  ADD CONSTRAINT partner_portal_requests_kind_check
  CHECK (kind IN (
    'additional_property',
    'additional_site',
    'additional_service',
    'schedule_change',
    'additional_unit'
  ));

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS pm_account_id uuid
    REFERENCES public.property_manager_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pm_unit_id uuid
    REFERENCES public.property_manager_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pm_turnover_id uuid
    REFERENCES public.property_manager_turnovers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS qc_issues_pm_unit_idx
  ON public.qc_issues (pm_unit_id, created_at DESC)
  WHERE pm_unit_id IS NOT NULL;

-- ─── RLS: service role writes, admin/VA reads. No anon, no partner JWT. ────

ALTER TABLE public.property_manager_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_manager_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_manager_turnovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_manager_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_manager_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_manager_onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_manager_onboarding_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_identity_property_managers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'property_manager_accounts',
    'property_manager_units',
    'property_manager_turnovers',
    'property_manager_invoices',
    'property_manager_agreements',
    'property_manager_onboarding_sessions',
    'property_manager_onboarding_session_items',
    'partner_identity_property_managers'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_service'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t || '_service', t
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_admin'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
        'USING (public.is_admin_or_va(auth.uid())) '
        'WITH CHECK (public.is_admin_or_va(auth.uid()))',
        t || '_admin', t
      );
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- ─── Signed-document bucket ────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('pm-agreements', 'pm-agreements', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND policyname = 'pm_agreements_admin_read'
  ) THEN
    CREATE POLICY pm_agreements_admin_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'pm-agreements' AND public.is_admin_or_va(auth.uid()));
  END IF;
END $$;

-- ─── updated_at ────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    FOREACH t IN ARRAY ARRAY[
      'property_manager_accounts',
      'property_manager_units',
      'property_manager_turnovers',
      'property_manager_invoices'
    ] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS set_timestamp_%I ON public.%I', t, t);
      EXECUTE format(
        'CREATE TRIGGER set_timestamp_%I BEFORE UPDATE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
        t, t
      );
    END LOOP;
  END IF;
END $$;
