-- ─── Commercial booking: pricing model, walkthrough gate, compliance ───────
--
-- Residential prices off sqft bands built for homes. Commercial spans a 1,200
-- sqft office suite to a 50,000 sqft warehouse, where the price driver is the
-- facility and the depth of the scope, not the room count:
--
--   price = sqft × facility_type_base_rate × scope_multiplier × size_tier_multiplier
--
-- Each of those three inputs is a row in a table an admin can edit, for the
-- same reason zone multipliers are: the starting values are an educated guess
-- and the real numbers only show up in completed job data.
--
-- Above a configurable square footage (default 5,000) the formula stops being
-- a price and becomes an anchor: racking, dock areas, floor type, restroom
-- count and existing condition swing a 30,000 sqft job far enough that
-- quoting it sight-unseen is expensive in both directions. Those jobs get an
-- estimate range and cannot be booked until a walkthrough sets a firm price.

-- ─── 1. Facility types — the base $/sqft ───────────────────────────────────
-- Detail density varies enormously by facility: a restaurant kitchen costs
-- multiples of open warehouse floor per square foot.

CREATE TABLE IF NOT EXISTS public.commercial_facility_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  -- Cents per square foot, before scope and size-tier multipliers. Fractional
  -- because a cent per sqft is a big step at 40,000 sqft.
  base_rate_cents_per_sqft numeric(10, 4) NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,

  CONSTRAINT commercial_facility_types_key_chk
    CHECK (key = lower(key) AND length(btrim(key)) > 0),
  CONSTRAINT commercial_facility_types_rate_chk
    CHECK (base_rate_cents_per_sqft >= 0 AND base_rate_cents_per_sqft <= 1000)
);

COMMENT ON TABLE public.commercial_facility_types IS
  'Facility type -> base cents per square foot. The first of the three commercial pricing inputs; tune from real job data the way zone multipliers are tuned.';

INSERT INTO public.commercial_facility_types (key, label, base_rate_cents_per_sqft, description, sort_order)
VALUES
  ('office',      'Office',              12.0, 'Suites, floors, professional space — desks, common areas, restrooms.', 10),
  ('warehouse',   'Warehouse/Industrial', 7.0, 'Open floor, racking, dock areas — lowest detail density per sqft.',   20),
  ('retail',      'Retail',              11.0, 'Sales floor, fitting rooms, front-of-house glass.',                    30),
  ('restaurant',  'Restaurant',          20.0, 'Kitchens, grease, food-contact surfaces — highest detail density.',    40),
  ('gym',         'Gym/Fitness',         15.0, 'Equipment sanitization, locker rooms, high-touch throughout.',         50),
  ('medical',     'Medical/Clinical',    22.0, 'Exam rooms, clinical sanitization standards, regulated waste areas.',  60),
  ('other',       'Other',               12.0, 'Anything not covered above — priced at the office baseline.',          99)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Scope levels — how deep the clean goes ─────────────────────────────
-- The same three tiers established for warehouse work, reusable across every
-- facility type: each level is the previous level plus more.

CREATE TABLE IF NOT EXISTS public.commercial_scope_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  multiplier numeric(6, 3) NOT NULL,
  summary text,
  -- Crew throughput at this depth, in square feet one cleaner covers per hour.
  -- Drives the recommended crew size against the service window.
  sqft_per_cleaner_hour integer NOT NULL DEFAULT 2200,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,

  CONSTRAINT commercial_scope_levels_key_chk
    CHECK (key = lower(key) AND length(btrim(key)) > 0),
  CONSTRAINT commercial_scope_levels_mult_chk
    CHECK (multiplier > 0 AND multiplier <= 10),
  CONSTRAINT commercial_scope_levels_rate_chk
    CHECK (sqft_per_cleaner_hour > 0)
);

COMMENT ON TABLE public.commercial_scope_levels IS
  'Light / Standard / Detailed. multiplier prices the depth; sqft_per_cleaner_hour is how fast one cleaner covers ground at that depth, which is what sizes the crew against the service window.';

INSERT INTO public.commercial_scope_levels (key, label, multiplier, summary, sqft_per_cleaner_hour, sort_order)
VALUES
  ('light',    'Light',    0.80,
   'Sweep/vacuum, trash, restrooms.', 3500, 10),
  ('standard', 'Standard', 1.00,
   'Light + mopping, breakroom/kitchen, individual offices and rooms.', 2200, 20),
  ('detailed', 'Detailed', 1.35,
   'Standard + scrubbing, high-touch sanitization, dusting, glass.', 1300, 30)
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Size tiers — economies of scale ────────────────────────────────────
-- Effective $/sqft falls as square footage rises: fixed setup and travel
-- spread across more area, and larger jobs are more efficient per labour-hour.

CREATE TABLE IF NOT EXISTS public.commercial_size_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  min_sqft integer NOT NULL,
  -- NULL = open-ended ("and above").
  max_sqft integer,
  multiplier numeric(6, 3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,

  CONSTRAINT commercial_size_tiers_min_chk CHECK (min_sqft >= 0),
  CONSTRAINT commercial_size_tiers_max_chk
    CHECK (max_sqft IS NULL OR max_sqft >= min_sqft),
  CONSTRAINT commercial_size_tiers_mult_chk
    CHECK (multiplier > 0 AND multiplier <= 10)
);

-- Overlapping bands would make the multiplier for a square footage ambiguous,
-- and an ambiguous price is a dispute waiting to happen — same reasoning as
-- the crew-size pay brackets, same enforcement.
ALTER TABLE public.commercial_size_tiers
  DROP CONSTRAINT IF EXISTS commercial_size_tiers_no_overlap;
ALTER TABLE public.commercial_size_tiers
  ADD CONSTRAINT commercial_size_tiers_no_overlap
  EXCLUDE USING gist (
    int4range(min_sqft, COALESCE(max_sqft, 2147483646), '[]') WITH &&
  );

COMMENT ON TABLE public.commercial_size_tiers IS
  'Square-footage band -> multiplier on the facility base rate. Multipliers decrease as area grows: fixed setup and travel spread across more square feet.';

INSERT INTO public.commercial_size_tiers (label, min_sqft, max_sqft, multiplier)
SELECT * FROM (VALUES
  ('Under 1,000 sq ft',   0,      999,   1.45),
  ('1,000–2,499 sq ft',   1000,   2499,  1.30),
  ('2,500–4,999 sq ft',   2500,   4999,  1.15),
  ('5,000–9,999 sq ft',   5000,   9999,  1.00),
  ('10,000–19,999 sq ft', 10000,  19999, 0.85),
  ('20,000–34,999 sq ft', 20000,  34999, 0.70),
  ('35,000+ sq ft',       35000,  NULL,  0.60)
) AS seed(label, min_sqft, max_sqft, multiplier)
WHERE NOT EXISTS (SELECT 1 FROM public.commercial_size_tiers);

-- ─── Shared RLS for the three config tables ────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_facility_types', 'commercial_scope_levels', 'commercial_size_tiers']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      || 'USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()))',
      t || '_admin_write', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- ─── 4. Tunables that are not a table of their own ─────────────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'commercial_pricing_settings',
  jsonb_build_object(
    -- At or above this, the formula produces a range, not a quotable price.
    'walkthrough_threshold_sqft', 5000,
    -- Half-width of the estimate range around the formula anchor.
    'estimate_range_pct', 0.20,
    -- Crew sizing: cleaners past the first are not fully additive (two people
    -- take roughly 60% of solo time, not 50%). 0.75 means each extra cleaner
    -- adds three quarters of a solo cleaner's throughput.
    'crew_coordination_factor', 0.75,
    'min_crew_size', 1,
    'max_crew_size', 12,
    -- Default service-window length when none is supplied, in hours.
    'default_window_hours', 4,
    'default_cleaner_pay_pct', 40,
    -- Documentation scales to the facility: one before/after pair for 30,000
    -- sqft proves nothing, so large sites are photographed by zone.
    'photo_zone_threshold_sqft', 10000,
    'photo_zone_sqft', 10000,
    'max_photo_zones', 8,
    -- COI expiring inside this window is "needs attention", not yet blocking.
    'coi_warning_days', 30
  ),
  'Commercial booking tunables: walkthrough threshold, estimate range width, crew-sizing model, photo-zone scaling, COI warning window.'
)
ON CONFLICT (key) DO NOTHING;

-- ─── 5. Account compliance: COI + signed agreement ─────────────────────────
-- The account already carries agreement_signed_at and coi_sent_at. A COI that
-- was sent once is not the same as a COI that is current, so record when it
-- expires — that is the field the gate actually needs.

ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS coi_expires_at date,
  ADD COLUMN IF NOT EXISTS coi_carrier text,
  ADD COLUMN IF NOT EXISTS coi_policy_number text,
  ADD COLUMN IF NOT EXISTS coi_document_url text;

COMMENT ON COLUMN public.business_accounts.coi_expires_at IS
  'Expiry of the certificate of insurance on file. Past this date the account blocks booking and dispatch for EVERY site under it.';

/**
 * Whether an account may have commercial work confirmed and dispatched.
 *
 * Compliance is an ACCOUNT-level property, so a gap here blocks every site
 * under the account, not just the one being booked. Returns the reasons rather
 * than a bare boolean: "blocked" without "why" is useless to whoever is trying
 * to book the job.
 *
 * Blocking:  no signed agreement · COI expired · no COI on file at all
 * Warning:   COI expiring soon · COI on file with no recorded expiry
 */
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
  v_warn_days integer;
BEGIN
  SELECT * INTO v_acct FROM public.business_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', to_jsonb(ARRAY['Account not found.']),
      'warnings', to_jsonb(ARRAY[]::text[])
    );
  END IF;

  SELECT COALESCE((value ->> 'coi_warning_days')::integer, 30) INTO v_warn_days
  FROM public.app_settings WHERE key = 'commercial_pricing_settings';
  v_warn_days := COALESCE(v_warn_days, 30);

  IF v_acct.agreement_signed_at IS NULL THEN
    v_blockers := array_append(v_blockers, 'No signed agreement on the account.');
  END IF;

  IF v_acct.coi_expires_at IS NOT NULL AND v_acct.coi_expires_at < CURRENT_DATE THEN
    v_blockers := array_append(
      v_blockers,
      format('Certificate of insurance expired %s.', to_char(v_acct.coi_expires_at, 'Mon DD, YYYY')));
  ELSIF v_acct.coi_expires_at IS NOT NULL
        AND v_acct.coi_expires_at <= CURRENT_DATE + v_warn_days THEN
    v_warnings := array_append(
      v_warnings,
      format('Certificate of insurance expires %s.', to_char(v_acct.coi_expires_at, 'Mon DD, YYYY')));
  ELSIF v_acct.coi_expires_at IS NULL AND v_acct.coi_sent_at IS NULL THEN
    v_blockers := array_append(v_blockers, 'No certificate of insurance on file.');
  ELSIF v_acct.coi_expires_at IS NULL THEN
    -- Recorded as sent before expiries were tracked. Not grounds to block work
    -- on an account that has been servicing, but it needs a real date.
    v_warnings := array_append(v_warnings, 'Certificate of insurance on file has no recorded expiry date.');
  END IF;

  IF v_acct.status = 'offboarded' THEN
    v_blockers := array_append(v_blockers, 'Account is offboarded.');
  END IF;

  RETURN jsonb_build_object(
    'ok', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'agreement_signed_at', v_acct.agreement_signed_at,
    'coi_expires_at', v_acct.coi_expires_at,
    'coi_sent_at', v_acct.coi_sent_at
  );
END;
$$;

COMMENT ON FUNCTION public.commercial_account_compliance(uuid) IS
  'Account-level go/no-go for commercial work: signed agreement + current COI. Blocks every site under the account, because the gap is on the account.';

GRANT EXECUTE ON FUNCTION public.commercial_account_compliance(uuid) TO authenticated, service_role;

-- ─── 6. Site-level commercial detail ───────────────────────────────────────
-- Captured once on the site so a second booking against it never re-enters
-- security, dock, or window information.

ALTER TABLE public.business_sites
  ADD COLUMN IF NOT EXISTS facility_type_key text,
  ADD COLUMN IF NOT EXISTS scope_level text,
  ADD COLUMN IF NOT EXISTS breakrooms integer,
  ADD COLUMN IF NOT EXISTS badge_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alarm_code text,
  ADD COLUMN IF NOT EXISTS security_contact_name text,
  ADD COLUMN IF NOT EXISTS security_contact_phone text,
  ADD COLUMN IF NOT EXISTS loading_dock_notes text,
  ADD COLUMN IF NOT EXISTS after_hours_access_notes text,
  ADD COLUMN IF NOT EXISTS service_window_start time,
  ADD COLUMN IF NOT EXISTS service_window_end time,
  -- Named sections a large site is photographed by. NULL = derive from sqft.
  ADD COLUMN IF NOT EXISTS photo_zones jsonb;

COMMENT ON COLUMN public.business_sites.photo_zones IS
  'Named documentation zones for this site (["Warehouse floor","Dock","Restrooms",…]). Before/after photos are captured per zone; NULL derives generic zones from square footage.';

-- ─── 7. Walkthroughs ───────────────────────────────────────────────────────
-- Its own step in the flow, not a note field: at 30,000 sqft the firm price
-- comes from what someone saw on site, with the formula shown only as an
-- anchor to price against.

CREATE TABLE IF NOT EXISTS public.commercial_walkthroughs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES public.business_accounts(id) ON DELETE CASCADE,
  business_site_id uuid NOT NULL REFERENCES public.business_sites(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  scheduled_for date,
  conducted_on date,
  conducted_by text,
  conducted_by_user_id uuid,

  -- What was quoted against, captured at walkthrough time so a later config
  -- change never rewrites history.
  facility_type_key text,
  scope_level text,
  sqft integer,

  -- Structured findings — the variables that make a large facility unquotable
  -- from a desk.
  condition_level text
    CHECK (condition_level IS NULL
           OR condition_level IN ('good', 'average', 'poor', 'severe')),
  obstacles text,
  special_equipment text,
  restroom_count integer,
  breakroom_count integer,
  floor_types text,
  security_complexity text,
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,

  -- The formula's answer at the time, kept as the anchor that was shown.
  formula_price_cents integer,
  estimate_low_cents integer,
  estimate_high_cents integer,
  -- The price a human set from what they saw. This is what a booking uses.
  firm_price_cents integer,
  recommended_crew_size integer,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commercial_walkthroughs_firm_price_chk
    CHECK (firm_price_cents IS NULL OR firm_price_cents > 0),
  -- A completed walkthrough without a firm price is not a completed
  -- walkthrough — the whole point of the step is the number it produces.
  CONSTRAINT commercial_walkthroughs_completed_chk
    CHECK (status <> 'completed' OR (firm_price_cents IS NOT NULL AND conducted_on IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS commercial_walkthroughs_site_idx
  ON public.commercial_walkthroughs (business_site_id, status, conducted_on DESC);
CREATE INDEX IF NOT EXISTS commercial_walkthroughs_account_idx
  ON public.commercial_walkthroughs (business_account_id, created_at DESC);

COMMENT ON TABLE public.commercial_walkthroughs IS
  'On-site walkthrough for facilities at or above the walkthrough threshold. A completed record with a firm price is what unlocks booking such a site.';

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

-- ─── 8. Booking columns ────────────────────────────────────────────────────
-- business_site_id was only ever inside partner_details jsonb, which cannot be
-- joined or constrained. A commercial booking belongs to a site; make that a
-- real foreign key.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS business_site_id uuid REFERENCES public.business_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS facility_type_key text,
  ADD COLUMN IF NOT EXISTS scope_level text,
  ADD COLUMN IF NOT EXISTS commercial_walkthrough_id uuid
    REFERENCES public.commercial_walkthroughs(id) ON DELETE SET NULL,
  -- formula | walkthrough | manual — how the number on this job was arrived at.
  ADD COLUMN IF NOT EXISTS price_source text,
  ADD COLUMN IF NOT EXISTS estimate_low_cents integer,
  ADD COLUMN IF NOT EXISTS estimate_high_cents integer,
  ADD COLUMN IF NOT EXISTS commercial_pricing jsonb,
  ADD COLUMN IF NOT EXISTS recommended_crew_size integer,
  ADD COLUMN IF NOT EXISTS service_window_hours numeric(5, 2),
  ADD COLUMN IF NOT EXISTS photo_zones jsonb;

CREATE INDEX IF NOT EXISTS bookings_business_site_idx
  ON public.bookings (business_site_id, service_date DESC)
  WHERE business_site_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.commercial_pricing IS
  'The full breakdown behind the price: sqft, facility base rate, scope multiplier, size-tier multiplier, and the config values used. Reproducible after the config changes.';
COMMENT ON COLUMN public.bookings.price_source IS
  'formula (auto-quoted below the walkthrough threshold) | walkthrough (firm price set from findings) | manual (negotiated override).';

-- Backfill the site link for partner bookings that recorded it in jsonb.
UPDATE public.bookings b
SET business_site_id = (b.partner_details ->> 'business_site_id')::uuid
WHERE b.business_site_id IS NULL
  AND b.partner_details ? 'business_site_id'
  AND (b.partner_details ->> 'business_site_id') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.business_sites s
    WHERE s.id = (b.partner_details ->> 'business_site_id')::uuid
  );

-- ─── 9. Recurring: daily cadence + commercial fields ───────────────────────
-- Commercial work is overwhelmingly contract work, and daily service is
-- routine at this scale in a way it never is residentially.

ALTER TABLE public.partner_recurring_schedules
  DROP CONSTRAINT IF EXISTS partner_recurring_schedules_cadence_check;
ALTER TABLE public.partner_recurring_schedules
  ADD CONSTRAINT partner_recurring_schedules_cadence_check
  CHECK (cadence IN ('daily', 'weekly', 'biweekly', 'monthly'));

ALTER TABLE public.partner_recurring_schedules
  ADD COLUMN IF NOT EXISTS facility_type_key text,
  ADD COLUMN IF NOT EXISTS scope_level text,
  ADD COLUMN IF NOT EXISTS sqft integer,
  ADD COLUMN IF NOT EXISTS service_window_hours numeric(5, 2),
  ADD COLUMN IF NOT EXISTS num_cleaners integer;

-- ─── 10. Crew-size pay brackets beyond 2 ───────────────────────────────────
-- The bracket table was built so a 3+ bracket could be added by INSERT. A
-- 30,000 sqft warehouse on a four-hour overnight window needs five or six
-- cleaners, and forcing them into the "crew of 2+" bracket underpays them:
-- coordination overhead grows with crew size, so the pool has to grow with it
-- for per-person hourly to hold.
--
--                solo (1)  crew (2)  crew (3–4)  crew (5+)
--   Foundation      35%       40%        42%         44%
--   Proven          40%       45%        47%         49%
--   Elite           45%       50%        52%         54%
--
-- The open-ended "2+" rows are narrowed to exactly 2 first, because the
-- exclusion constraint refuses overlapping brackets — deliberately.

UPDATE public.cleaner_pay_rates
SET max_crew_size = 2, note = 'Crew of 2', updated_at = now()
WHERE min_crew_size = 2 AND max_crew_size IS NULL;

INSERT INTO public.cleaner_pay_rates (min_crew_size, max_crew_size, pay_tier, rate_percent, note)
SELECT * FROM (VALUES
  (3, 4,    'foundation', 42.0, 'Crew of 3–4 (commercial)'),
  (3, 4,    'proven',     47.0, 'Crew of 3–4 (commercial)'),
  (3, 4,    'elite',      52.0, 'Crew of 3–4 (commercial)'),
  (5, NULL, 'foundation', 44.0, 'Crew of 5+ (large commercial)'),
  (5, NULL, 'proven',     49.0, 'Crew of 5+ (large commercial)'),
  (5, NULL, 'elite',      54.0, 'Crew of 5+ (large commercial)')
) AS seed(min_crew_size, max_crew_size, pay_tier, rate_percent, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.cleaner_pay_rates r WHERE r.min_crew_size = 3
);

-- ─── 11. Site-level attention rollup ───────────────────────────────────────
-- Every site under an account inherits that account's compliance state, so
-- one expiring COI shows up against all of them rather than being noticed on
-- whichever site happened to be opened.

DROP VIEW IF EXISTS public.commercial_site_compliance;
CREATE VIEW public.commercial_site_compliance
WITH (security_invoker = true) AS
SELECT
  s.id                       AS site_id,
  s.business_account_id      AS account_id,
  s.nickname                 AS site_nickname,
  s.active                   AS site_active,
  a.business_name,
  a.status                   AS account_status,
  a.agreement_signed_at,
  a.coi_sent_at,
  a.coi_expires_at,
  public.commercial_account_compliance(a.id) AS compliance
FROM public.business_sites s
JOIN public.business_accounts a ON a.id = s.business_account_id;

COMMENT ON VIEW public.commercial_site_compliance IS
  'Account compliance projected onto every site under it. A COI gap is an account-level fact; this is what makes it visible everywhere it applies.';

GRANT SELECT ON public.commercial_site_compliance TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
