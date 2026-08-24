-- ─── COI lifecycle: versioned documents, computed status, enforced block ───
--
-- The commercial booking flow already refuses to book an account without a
-- current certificate of insurance. That check was a point-in-time read of a
-- date somebody typed. This makes it a lifecycle:
--
--   • the actual document is stored and VERSIONED — a renewal supersedes the
--     prior certificate, it does not overwrite it, because the question
--     "were we insured on the day of that job" gets asked during disputes
--   • STATUS IS COMPUTED from the expiration date, every time it is read.
--     There is deliberately no status column to set. A stored status is a
--     status that drifts: it is correct on the day it is written and wrong
--     every day after.
--   • the block is enforced in code at every dispatch-adjacent point, not
--     surfaced as a dashboard flag someone is expected to notice
--   • a recurring visit that comes due at a blocked account is HELD and
--     recorded, never silently generated and never silently dropped
--   • an exception is possible, but only as an explicit override with a
--     reason and an expiry of its own — never by editing the certificate
--
-- A COI that was valid at onboarding and has since lapsed blocks exactly as
-- hard as one that was never provided, which is the entire point.

-- ─── 1. Tunables ───────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'coi_lifecycle_settings',
  jsonb_build_object(
    -- Days before expiry at which status reads "expiring soon".
    'expiring_soon_days', 30,
    -- Escalation ladder. Each fires once per certificate period.
    'alert_days', jsonb_build_array(90, 30, 15, 7),
    -- At or inside this many days, the reminder repeats DAILY until resolved
    -- rather than firing once — including after expiry.
    'daily_reminder_from_days', 7,
    -- Also email the account's assigned VA, when one is recorded.
    'notify_assigned_va', true,
    -- Longest an admin may hold the block open for.
    'max_override_days', 30
  ),
  'COI lifecycle: expiring-soon window, escalation ladder, daily-reminder threshold, override ceiling.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.coi_setting_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (value ->> p_key)::integer FROM public.app_settings WHERE key = 'coi_lifecycle_settings'),
    p_default
  );
$$;

-- ─── 2. Versioned COI documents ────────────────────────────────────────────
-- One row per certificate ever received. The newest accepted one is the
-- account's current cover; the rest are history and stay readable.

CREATE TABLE IF NOT EXISTS public.commercial_coi_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,

  -- The file itself, in the private coi-documents bucket.
  document_path text,
  document_name text,
  document_size_bytes bigint,

  -- Read off the certificate at upload — extracted where possible, typed by
  -- whoever uploaded it where not.
  effective_date date,
  expiration_date date,
  carrier text,
  policy_number text,
  -- Coverage types and limits, for reference. Presence and currency are what
  -- this system enforces; the numbers are recorded, not evaluated.
  coverage_notes text,

  -- current     — the certificate in force
  -- superseded  — replaced by a newer one, retained for the record
  -- needs_review— uploaded without a readable expiry; NOT accepted as cover
  -- rejected    — reviewed and refused
  --
  -- This is the document's place in the chain, not the account's compliance
  -- state. The account's state is computed (see commercial_coi_status).
  lifecycle text NOT NULL DEFAULT 'current'
    CHECK (lifecycle IN ('current', 'superseded', 'needs_review', 'rejected')),
  review_note text,

  verified_by uuid,
  verified_by_name text,
  verified_at timestamptz,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A certificate that expires before it takes effect is a typo, not cover.
  CONSTRAINT commercial_coi_documents_dates_chk
    CHECK (effective_date IS NULL OR expiration_date IS NULL
           OR expiration_date >= effective_date),
  -- Accepting a document as the certificate in force requires knowing when it
  -- lapses. Without that date there is nothing to compute a status from, so it
  -- has to sit in review instead.
  CONSTRAINT commercial_coi_documents_current_needs_expiry_chk
    CHECK (lifecycle <> 'current' OR expiration_date IS NOT NULL)
);

-- At most one certificate in force per account, enforced rather than assumed:
-- two "current" rows would make the account's cover ambiguous exactly when
-- somebody is asking which certificate applied.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_coi_documents_one_current
  ON public.commercial_coi_documents (business_account_id)
  WHERE lifecycle = 'current';

CREATE INDEX IF NOT EXISTS commercial_coi_documents_account_idx
  ON public.commercial_coi_documents (business_account_id, created_at DESC);

COMMENT ON TABLE public.commercial_coi_documents IS
  'Every certificate of insurance ever received, newest in force and the rest retained. Renewals supersede; nothing is overwritten, because "were we covered on the day of that job" is a question asked after the fact.';
COMMENT ON COLUMN public.commercial_coi_documents.lifecycle IS
  'The document''s place in the chain (current / superseded / needs_review / rejected) — NOT the account''s compliance status, which is computed from the expiration date.';

ALTER TABLE public.commercial_coi_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_coi_documents_admin ON public.commercial_coi_documents;
CREATE POLICY commercial_coi_documents_admin ON public.commercial_coi_documents
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_coi_documents_service ON public.commercial_coi_documents;
CREATE POLICY commercial_coi_documents_service ON public.commercial_coi_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.commercial_coi_documents TO authenticated;
GRANT ALL ON public.commercial_coi_documents TO service_role;
REVOKE ALL ON public.commercial_coi_documents FROM anon;

-- Private bucket: a certificate names policy numbers and limits.
INSERT INTO storage.buckets (id, name, public)
VALUES ('coi-documents', 'coi-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read coi documents" ON storage.objects;
CREATE POLICY "admins read coi documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'coi-documents' AND public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS "admins upload coi documents" ON storage.objects;
CREATE POLICY "admins upload coi documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'coi-documents' AND public.is_admin_or_va(auth.uid()));

-- ─── 3. The account mirrors its certificate in force ───────────────────────
-- business_accounts.coi_expires_at stays the account's expiry date so every
-- existing query keeps working, but it is now DERIVED from the certificate in
-- force rather than typed independently of it.

ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS coi_document_id uuid,
  ADD COLUMN IF NOT EXISTS coi_effective_at date,
  ADD COLUMN IF NOT EXISTS coi_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS coi_verified_by_name text,
  -- Alerts reach ops through the existing events -> Discord bus; when an
  -- account has an owner, they are copied too.
  ADD COLUMN IF NOT EXISTS assigned_va_email text;

COMMENT ON COLUMN public.business_accounts.coi_expires_at IS
  'Expiry of the certificate in force. Maintained from commercial_coi_documents when one exists — the account status is COMPUTED from this date and is never stored.';

CREATE OR REPLACE FUNCTION public.sync_account_coi_from_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account uuid := COALESCE(NEW.business_account_id, OLD.business_account_id);
  v_doc public.commercial_coi_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc
  FROM public.commercial_coi_documents
  WHERE business_account_id = v_account AND lifecycle = 'current'
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.business_accounts
    SET coi_document_id = v_doc.id,
        coi_expires_at = v_doc.expiration_date,
        coi_effective_at = v_doc.effective_date,
        coi_carrier = COALESCE(v_doc.carrier, coi_carrier),
        coi_policy_number = COALESCE(v_doc.policy_number, coi_policy_number),
        coi_verified_at = v_doc.verified_at,
        coi_verified_by_name = v_doc.verified_by_name,
        coi_sent_at = COALESCE(coi_sent_at, v_doc.created_at)
    WHERE id = v_account;
  ELSE
    -- The last accepted certificate was withdrawn or sent to review. The
    -- account has no cover in force; clear the mirror rather than leaving a
    -- stale date that would read as current.
    UPDATE public.business_accounts
    SET coi_document_id = NULL,
        coi_expires_at = NULL,
        coi_effective_at = NULL,
        coi_verified_at = NULL,
        coi_verified_by_name = NULL
    WHERE id = v_account;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_account_coi ON public.commercial_coi_documents;
CREATE TRIGGER trg_sync_account_coi
  AFTER INSERT OR UPDATE OR DELETE ON public.commercial_coi_documents
  FOR EACH ROW EXECUTE FUNCTION public.sync_account_coi_from_document();

-- ─── 4. Overrides — explicit, time-limited, logged ─────────────────────────
-- A renewal confirmed with the insurer but not yet in hand is a real
-- situation. Editing the certificate to paper over it is not an acceptable
-- answer, so the exception is a separate, visible object with its own expiry:
-- it lapses on its own, and it never makes the account look covered.

CREATE TABLE IF NOT EXISTS public.commercial_coi_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_by_name text,
  revoked_reason text,
  -- What the account's state was when the exception was granted, so the log
  -- reads as a decision rather than a bare timestamp.
  coi_status_at_grant text,
  coi_expires_at_grant date,

  CONSTRAINT commercial_coi_overrides_reason_chk
    CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT commercial_coi_overrides_window_chk
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS commercial_coi_overrides_account_idx
  ON public.commercial_coi_overrides (business_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_coi_overrides_active_idx
  ON public.commercial_coi_overrides (business_account_id, expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.commercial_coi_overrides IS
  'Time-limited exceptions to the COI block. An override never changes COI status — it suspends the block for a stated reason until a stated moment, and expires without anyone remembering to clean it up.';

ALTER TABLE public.commercial_coi_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_coi_overrides_admin ON public.commercial_coi_overrides;
CREATE POLICY commercial_coi_overrides_admin ON public.commercial_coi_overrides
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_coi_overrides_service ON public.commercial_coi_overrides;
CREATE POLICY commercial_coi_overrides_service ON public.commercial_coi_overrides
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.commercial_coi_overrides TO authenticated;
GRANT ALL ON public.commercial_coi_overrides TO service_role;
REVOKE ALL ON public.commercial_coi_overrides FROM anon;

/**
 * The override currently suspending an account's block, if any.
 *
 * "Active" is evaluated, not stored: an override that has passed its expiry
 * simply stops matching. There is no sweep to forget to run.
 */
CREATE OR REPLACE FUNCTION public.commercial_coi_active_override(p_account_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_jsonb(o) - 'business_account_id'
  FROM public.commercial_coi_overrides o
  WHERE o.business_account_id = p_account_id
    AND o.revoked_at IS NULL
    AND o.expires_at > now()
  ORDER BY o.expires_at DESC
  LIMIT 1;
$$;

-- ─── 5. Computed status ────────────────────────────────────────────────────

/**
 * The account's COI state, derived from a date and today.
 *
 * Split out so the per-account function, the list view, and the compliance
 * gate cannot disagree about what "expiring soon" means.
 */
CREATE OR REPLACE FUNCTION public.commercial_coi_state(
  p_expiration_date date,
  p_expiring_soon_days integer DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_expiration_date IS NULL THEN 'not_on_file'
    WHEN p_expiration_date < CURRENT_DATE THEN 'expired'
    WHEN p_expiration_date <= CURRENT_DATE + COALESCE(p_expiring_soon_days, 30)
      THEN 'expiring_soon'
    ELSE 'current'
  END;
$$;

COMMENT ON FUNCTION public.commercial_coi_state(date, integer) IS
  'not_on_file | expired | expiring_soon | current, derived from the expiry date. There is no stored status column anywhere: a stored status is right the day it is written and wrong every day after.';

/**
 * Everything the account's COI state consists of, in one read: the computed
 * status, the certificate behind it, how long is left, whether a document is
 * stuck in review, and whether an override is currently holding the block
 * open.
 *
 * `blocked` is the answer every enforcement point actually needs. Note that
 * `status` is untouched by an override — a suspended block and genuine cover
 * must never look alike.
 */
CREATE OR REPLACE FUNCTION public.commercial_coi_status(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expires date;
  v_effective date;
  v_doc_id uuid;
  v_status text;
  v_soon integer := public.coi_setting_int('expiring_soon_days', 30);
  v_review integer;
  v_override jsonb;
  v_blocked boolean;
BEGIN
  SELECT a.coi_expires_at, a.coi_effective_at, a.coi_document_id
    INTO v_expires, v_effective, v_doc_id
  FROM public.business_accounts a WHERE a.id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_on_file', 'blocked', true, 'found', false);
  END IF;

  SELECT count(*) INTO v_review
  FROM public.commercial_coi_documents d
  WHERE d.business_account_id = p_account_id AND d.lifecycle = 'needs_review';

  v_status := public.commercial_coi_state(v_expires, v_soon);
  v_override := public.commercial_coi_active_override(p_account_id);
  -- Expiring soon is a warning, not a stop: the cover is still in force.
  v_blocked := v_status IN ('not_on_file', 'expired') AND v_override IS NULL;

  RETURN jsonb_build_object(
    'found', true,
    'status', v_status,
    'blocked', v_blocked,
    'expiration_date', v_expires,
    'effective_date', v_effective,
    'document_id', v_doc_id,
    'days_remaining', CASE WHEN v_expires IS NULL THEN NULL ELSE (v_expires - CURRENT_DATE) END,
    'documents_in_review', v_review,
    'expiring_soon_days', v_soon,
    'override', v_override
  );
END;
$$;

COMMENT ON FUNCTION public.commercial_coi_status(uuid) IS
  'One read of an account''s COI state: computed status, the certificate behind it, days remaining, documents stuck in review, and any active override. `blocked` is what the enforcement points consume.';

GRANT EXECUTE ON FUNCTION public.commercial_coi_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_coi_active_override(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_coi_state(date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coi_setting_int(text, integer) TO authenticated, service_role;

-- ─── 6. Compliance gate, rebuilt on the computed status ────────────────────
-- Same contract as before (ok / blockers / warnings) so every existing caller
-- keeps working — now with the COI half derived rather than eyeballed, and
-- with override state carried through so a suspended block is distinguishable
-- from real cover at every layer.

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

  IF v_acct.agreement_signed_at IS NULL THEN
    v_blockers := array_append(v_blockers, 'No signed agreement on the account.');
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
    -- An override suspends the block; it does not make the account compliant,
    -- and saying so plainly is the difference between an exception and a
    -- loophole.
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
    'active_site_count', v_sites
  );
END;
$$;

-- ─── 7. The status view ────────────────────────────────────────────────────
-- Expired accounts first: they are active revenue currently unable to be
-- serviced, which outranks every other kind of paperwork gap.

DROP VIEW IF EXISTS public.commercial_coi_status_v1;
CREATE VIEW public.commercial_coi_status_v1
WITH (security_invoker = true) AS
SELECT
  a.id                                       AS account_id,
  a.business_name,
  a.account_type,
  a.status                                   AS account_status,
  a.email,
  a.contact_name,
  a.phone,
  a.assigned_va_email,
  a.agreement_signed_at,
  a.coi_expires_at,
  a.coi_effective_at,
  a.coi_carrier,
  a.coi_policy_number,
  a.coi_document_id,
  a.coi_verified_at,
  a.coi_verified_by_name,
  public.commercial_coi_state(
    a.coi_expires_at,
    public.coi_setting_int('expiring_soon_days', 30)
  )                                          AS coi_status,
  CASE WHEN a.coi_expires_at IS NULL THEN NULL
       ELSE (a.coi_expires_at - CURRENT_DATE) END AS days_remaining,
  public.commercial_coi_active_override(a.id) AS active_override,
  (public.commercial_coi_status(a.id) ->> 'blocked')::boolean AS blocked,
  (SELECT count(*) FROM public.business_sites s
    WHERE s.business_account_id = a.id AND s.active)         AS active_sites,
  (SELECT count(*) FROM public.commercial_coi_documents d
    WHERE d.business_account_id = a.id)                      AS document_count,
  (SELECT count(*) FROM public.commercial_coi_documents d
    WHERE d.business_account_id = a.id AND d.lifecycle = 'needs_review') AS documents_in_review,
  -- Sort weight, so "worst first" is a property of the data rather than
  -- something every consumer re-derives: blocked expired, then not on file,
  -- then expiring soon by urgency, then current.
  CASE
    WHEN a.coi_expires_at IS NOT NULL AND a.coi_expires_at < CURRENT_DATE THEN 0
    WHEN a.coi_expires_at IS NULL THEN 1
    WHEN a.coi_expires_at <= CURRENT_DATE
         + public.coi_setting_int('expiring_soon_days', 30) THEN 2
    ELSE 3
  END                                        AS priority_rank
FROM public.business_accounts a
WHERE a.account_type IN ('commercial', 'office');

COMMENT ON VIEW public.commercial_coi_status_v1 IS
  'COI state for every commercial/office account, computed. priority_rank orders expired first — those are accounts with live revenue that cannot legally be serviced.';

GRANT SELECT ON public.commercial_coi_status_v1 TO authenticated, service_role;

-- ─── 8. Held recurring visits ──────────────────────────────────────────────
-- A recurring visit due at a blocked account must not generate, and must not
-- vanish. It is recorded here with the reason, stays visible, and is released
-- the moment the account clears — which is what stops "we didn't notice we
-- stopped servicing them" being discovered a month later.

CREATE TABLE IF NOT EXISTS public.partner_recurring_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL
    REFERENCES public.partner_recurring_schedules(id) ON DELETE CASCADE,
  business_account_id uuid REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  business_site_id uuid REFERENCES public.business_sites(id) ON DELETE SET NULL,
  service_date date NOT NULL,
  reason text NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- held     — due, not generated, waiting on the account
  -- released — the account cleared and the visit was created
  -- lapsed   — the service date passed while still blocked; the visit did not
  --            happen and the record says so out loud
  -- cancelled— an admin dismissed it
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'released', 'lapsed', 'cancelled')),
  released_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  released_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_recurring_holds_unique_visit
  ON public.partner_recurring_holds (schedule_id, service_date);
CREATE INDEX IF NOT EXISTS partner_recurring_holds_open_idx
  ON public.partner_recurring_holds (business_account_id, service_date)
  WHERE status = 'held';

COMMENT ON TABLE public.partner_recurring_holds IS
  'Recurring visits that came due while their account was blocked. Held, not skipped and not silently generated: released automatically when the account clears, marked lapsed if the date passes first.';

ALTER TABLE public.partner_recurring_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_recurring_holds_admin ON public.partner_recurring_holds;
CREATE POLICY partner_recurring_holds_admin ON public.partner_recurring_holds
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS partner_recurring_holds_service ON public.partner_recurring_holds;
CREATE POLICY partner_recurring_holds_service ON public.partner_recurring_holds
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.partner_recurring_holds TO authenticated;
GRANT ALL ON public.partner_recurring_holds TO service_role;
REVOKE ALL ON public.partner_recurring_holds FROM anon;

-- ─── 9. Alert ledger ───────────────────────────────────────────────────────
-- Records which rung of the escalation ladder has already been sent for which
-- certificate period, so the 90/30/15-day notices fire once and the 7-day and
-- expired notices repeat daily without one run's crash sending the whole
-- ladder twice.

CREATE TABLE IF NOT EXISTS public.commercial_coi_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL
    REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  -- '90' | '30' | '15' | '7' | 'expired' — the rung, not the exact day count.
  milestone text NOT NULL,
  -- Which certificate period this concerns. A renewal changes this, which is
  -- what re-arms the whole ladder for the new period.
  expiration_date date,
  days_remaining integer,
  sent_on date NOT NULL DEFAULT CURRENT_DATE,
  channel text NOT NULL DEFAULT 'events',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_coi_alerts_once
  ON public.commercial_coi_alerts
     (business_account_id, milestone, COALESCE(expiration_date, '1970-01-01'::date), sent_on);
CREATE INDEX IF NOT EXISTS commercial_coi_alerts_account_idx
  ON public.commercial_coi_alerts (business_account_id, created_at DESC);

ALTER TABLE public.commercial_coi_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_coi_alerts_admin ON public.commercial_coi_alerts;
CREATE POLICY commercial_coi_alerts_admin ON public.commercial_coi_alerts
  FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()));

DROP POLICY IF EXISTS commercial_coi_alerts_service ON public.commercial_coi_alerts;
CREATE POLICY commercial_coi_alerts_service ON public.commercial_coi_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.commercial_coi_alerts TO authenticated;
GRANT ALL ON public.commercial_coi_alerts TO service_role;
REVOKE ALL ON public.commercial_coi_alerts FROM anon;

-- ─── 10. Backfill: existing COI dates become certificate records ───────────
-- Accounts already carrying an expiry date get a document row so their status
-- computes from the same place as everyone else's, with the file itself to be
-- attached at the next renewal.

INSERT INTO public.commercial_coi_documents (
  business_account_id, expiration_date, carrier, policy_number,
  lifecycle, review_note, verified_at, verified_by_name, created_at
)
SELECT
  a.id, a.coi_expires_at, a.coi_carrier, a.coi_policy_number,
  'current',
  'Backfilled from the account''s recorded expiry date — the certificate file itself was not on record. Attach it at the next renewal.',
  a.coi_sent_at, 'Backfill', COALESCE(a.coi_sent_at, now())
FROM public.business_accounts a
WHERE a.coi_expires_at IS NOT NULL
  AND a.account_type IN ('commercial', 'office')
  AND NOT EXISTS (
    SELECT 1 FROM public.commercial_coi_documents d
    WHERE d.business_account_id = a.id
  );

-- ─── 11. Alert routing ─────────────────────────────────────────────────────
-- Through the existing events -> discord_routes bus; no parallel channel.
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('coi.expiring',          'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coi.expired',           'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coi.renewed',           'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coi.needs_review',      'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coi.renewal_requested', 'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coi.override.created',  'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coi.override.revoked',  'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coi.block.enforced',    'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('commercial.recurring.held',     'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('commercial.recurring.released', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('commercial.recurring.lapsed',   'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- ─── 12. Daily expiry monitor ──────────────────────────────────────────────
DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_anon_key text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;

  SELECT value INTO v_anon_key FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY';

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'coi-expiry-monitor';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('coi-expiry-monitor');
  END IF;

  -- 13:00 UTC — morning US Eastern, so a same-day renewal chase still has a
  -- business day to land in.
  PERFORM cron.schedule(
    'coi-expiry-monitor',
    '0 13 * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/coi-expiry-monitor',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      coalesce(v_anon_key, '')
    )
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  -- pg_cron is not installed in every environment (local validation, review
  -- databases). The monitor is also invokable directly, so a missing scheduler
  -- must not fail the migration.
  RAISE NOTICE 'pg_cron unavailable — coi-expiry-monitor not scheduled.';
END $$;

NOTIFY pgrst, 'reload schema';
