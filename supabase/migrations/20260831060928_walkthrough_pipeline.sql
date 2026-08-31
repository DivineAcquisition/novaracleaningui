-- ─── Walkthrough workflow: Request → Firm Price ────────────────────────────
--
-- The commercial booking flow already refuses a firm auto-quote above the
-- walkthrough threshold. That rule only holds if the walkthrough is itself a
-- tracked process with a defined start and end — otherwise "requires a
-- walkthrough" quietly becomes "someone eyeballed it and we hope the price
-- holds."
--
-- So the walkthrough becomes a pipeline:
--
--   requested -> scheduled -> conducted -> priced   ( -> site confirmed )
--                                  \
--                                   `-> excluded    (routes out, never priced)
--
-- Three things make it a pipeline rather than a status field:
--
--   • FINDINGS ARE STRUCTURED. A walkthrough cannot reach `conducted` until
--     every finding the price depends on is present — square footage, facility
--     type, condition, counts, obstacle density, access complexity, service
--     window, equipment, crew size, and photographs. `findings_complete` is a
--     generated column, so "complete" is computed from the data rather than
--     asserted by whoever pressed the button.
--   • THE CONFIRMED SQUARE FOOTAGE IS THE NUMBER OF RECORD. What the client
--     said is kept beside it, not replaced by it, because the difference
--     between the two is worth seeing.
--   • AN EXCLUSION IS A STOP. Mold past the threshold, active infestation,
--     biohazard, or a structural hazard ends the pipeline and routes to the
--     existing stop-and-report handling. It is not a scope adjustment and it
--     is never priced through.
--
-- The record is permanent. It is the baseline for what "clean" looks like at
-- this site, and the evidence behind the rate, long after the pricing event.

-- ─── 1. Tunables ───────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'walkthrough_pipeline_settings',
  jsonb_build_object(
    -- Findings captured but no price set after this many business days is a
    -- deal stalling between "we did the visit" and "we actually priced it".
    'stalled_after_business_days', 3,
    -- Remind the conductor and the client contact this far ahead.
    'reminder_hours_before', 24,
    -- Re-walkthrough signal: how far a site's real service time has to drift
    -- from what the walkthrough assumed, over how many visits, before the
    -- gap stops being noise.
    'variance_min_samples', 4,
    'variance_pct_threshold', 15,
    -- A price set this far from the formula anchor is worth explaining
    -- prominently, though any adjustment at all requires a reason.
    'notable_adjustment_pct', 20
  ),
  'Walkthrough pipeline: stall window, reminder lead time, re-walkthrough variance thresholds.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.walkthrough_setting_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (value ->> p_key)::integer FROM public.app_settings
      WHERE key = 'walkthrough_pipeline_settings'),
    p_default
  );
$$;

GRANT EXECUTE ON FUNCTION public.walkthrough_setting_int(text, integer) TO authenticated, service_role;

-- ─── 2. Pipeline columns ───────────────────────────────────────────────────

ALTER TABLE public.commercial_walkthroughs
  -- Requested: what the client said, kept alongside what was measured.
  ADD COLUMN IF NOT EXISTS request_reason text,
  ADD COLUMN IF NOT EXISTS requested_by uuid,
  ADD COLUMN IF NOT EXISTS requested_by_name text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS client_stated_sqft integer,
  ADD COLUMN IF NOT EXISTS client_stated_facility_type text,
  ADD COLUMN IF NOT EXISTS site_address text,
  ADD COLUMN IF NOT EXISTS access_contact_name text,
  ADD COLUMN IF NOT EXISTS access_contact_phone text,
  ADD COLUMN IF NOT EXISTS access_contact_email text,

  -- Scheduled.
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS conductor_user_id uuid,
  ADD COLUMN IF NOT EXISTS conductor_email text,
  ADD COLUMN IF NOT EXISTS conductor_phone text,
  ADD COLUMN IF NOT EXISTS client_access_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,

  -- Conducted: the structured findings the price is traceable to.
  ADD COLUMN IF NOT EXISTS conducted_at timestamptz,
  ADD COLUMN IF NOT EXISTS floor_count integer,
  ADD COLUMN IF NOT EXISTS obstacle_density text
    CHECK (obstacle_density IS NULL
           OR obstacle_density IN ('low', 'moderate', 'high', 'severe')),
  ADD COLUMN IF NOT EXISTS badge_required boolean,
  ADD COLUMN IF NOT EXISTS alarm_code text,
  ADD COLUMN IF NOT EXISTS loading_dock_notes text,
  ADD COLUMN IF NOT EXISTS after_hours_access_notes text,
  ADD COLUMN IF NOT EXISTS security_contact_name text,
  ADD COLUMN IF NOT EXISTS security_contact_phone text,
  ADD COLUMN IF NOT EXISTS service_window_start time,
  ADD COLUMN IF NOT EXISTS service_window_end time,
  ADD COLUMN IF NOT EXISTS service_window_notes text,
  -- Equipment the site demands, which is what decides who is eligible to work
  -- it. Keys match the contractor supply/equipment catalog.
  ADD COLUMN IF NOT EXISTS required_equipment text[] NOT NULL DEFAULT '{}',
  -- Photographs of the site as found. Retained permanently: this is the
  -- baseline for what "clean" looks like here, not a pricing artefact.
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Exclusion: the pipeline's other ending.
  ADD COLUMN IF NOT EXISTS exclusion_code text,
  ADD COLUMN IF NOT EXISTS exclusion_note text,
  ADD COLUMN IF NOT EXISTS exclusion_qc_issue_id uuid,
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,

  -- Pricing: the anchor, the decision, and why they differ.
  ADD COLUMN IF NOT EXISTS priced_at timestamptz,
  ADD COLUMN IF NOT EXISTS priced_by uuid,
  ADD COLUMN IF NOT EXISTS priced_by_name text,
  ADD COLUMN IF NOT EXISTS price_adjustment_reason text,

  -- Re-walkthrough lineage.
  ADD COLUMN IF NOT EXISTS supersedes_walkthrough_id uuid
    REFERENCES public.commercial_walkthroughs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variance_trigger jsonb;

COMMENT ON COLUMN public.commercial_walkthroughs.sqft IS
  'CONFIRMED square footage, measured on site. This supersedes client_stated_sqft as the number used in pricing; the client''s estimate is kept beside it because the gap between the two is itself worth seeing.';
COMMENT ON COLUMN public.commercial_walkthroughs.photos IS
  'Condition photos, in the same bucket as job photos under a walkthroughs/ prefix. qc-retention-purge only sweeps bookings/, so these are retained permanently — they are the site''s baseline and dispute record.';
COMMENT ON COLUMN public.commercial_walkthroughs.required_equipment IS
  'Equipment the site demands (auto-scrubber, floor buffer, extractor…). Matched against contractor equipment self-certification when suggesting crews.';

-- ─── 3. The pipeline itself ────────────────────────────────────────────────
-- The old vocabulary (scheduled / completed / cancelled) becomes the pipeline.
-- A completed walkthrough was one that had produced a firm price, which is
-- exactly what `priced` means.

UPDATE public.commercial_walkthroughs
SET status = CASE
  WHEN status = 'completed' THEN 'priced'
  WHEN status = 'scheduled' AND scheduled_for IS NULL AND conducted_on IS NULL THEN 'requested'
  ELSE status
END
WHERE status IN ('completed', 'scheduled');

ALTER TABLE public.commercial_walkthroughs
  DROP CONSTRAINT IF EXISTS commercial_walkthroughs_status_check;
ALTER TABLE public.commercial_walkthroughs
  ADD CONSTRAINT commercial_walkthroughs_status_check
  CHECK (status IN ('requested', 'scheduled', 'conducted', 'priced', 'excluded', 'cancelled'));

-- The completeness rule from the old shape referred to 'completed'; the
-- pipeline states it precisely instead.
ALTER TABLE public.commercial_walkthroughs
  DROP CONSTRAINT IF EXISTS commercial_walkthroughs_completed_chk;

/**
 * Every finding the price depends on, present.
 *
 * Generated rather than set, so it cannot be asserted by someone in a hurry.
 * A walkthrough that reaches `conducted` has all of this or it is not a
 * walkthrough — it is a visit somebody made.
 */
-- The pipeline view reads this column, so it has to go first for the column
-- definition below to stay authoritative on a re-run. It is rebuilt further
-- down in this same migration.
DROP VIEW IF EXISTS public.walkthrough_pipeline_v1;

ALTER TABLE public.commercial_walkthroughs
  DROP COLUMN IF EXISTS findings_complete;
ALTER TABLE public.commercial_walkthroughs
  ADD COLUMN findings_complete boolean
  GENERATED ALWAYS AS (
    sqft IS NOT NULL AND sqft > 0
    AND facility_type_key IS NOT NULL AND length(btrim(facility_type_key)) > 0
    AND scope_level IS NOT NULL AND length(btrim(scope_level)) > 0
    AND condition_level IS NOT NULL
    AND restroom_count IS NOT NULL
    AND breakroom_count IS NOT NULL
    AND floor_count IS NOT NULL
    AND obstacle_density IS NOT NULL
    AND floor_types IS NOT NULL AND length(btrim(floor_types)) > 0
    AND (service_window_start IS NOT NULL AND service_window_end IS NOT NULL)
    AND recommended_crew_size IS NOT NULL AND recommended_crew_size > 0
    AND badge_required IS NOT NULL
    AND jsonb_array_length(photos) > 0
    AND conducted_on IS NOT NULL
    AND conducted_by IS NOT NULL AND length(btrim(conducted_by)) > 0
  ) STORED;

COMMENT ON COLUMN public.commercial_walkthroughs.findings_complete IS
  'Computed: every structured finding the price depends on is present, photos included. A walkthrough cannot be marked conducted without it.';

ALTER TABLE public.commercial_walkthroughs
  DROP CONSTRAINT IF EXISTS commercial_walkthroughs_conducted_chk;
ALTER TABLE public.commercial_walkthroughs
  ADD CONSTRAINT commercial_walkthroughs_conducted_chk
  CHECK (status <> 'conducted' OR findings_complete);

-- Priced means a real number arrived at on purpose.
ALTER TABLE public.commercial_walkthroughs
  DROP CONSTRAINT IF EXISTS commercial_walkthroughs_priced_chk;
ALTER TABLE public.commercial_walkthroughs
  ADD CONSTRAINT commercial_walkthroughs_priced_chk
  CHECK (status <> 'priced' OR (firm_price_cents IS NOT NULL AND firm_price_cents > 0));

-- An exclusion has to say what was found. "Couldn't price it" is not a reason.
ALTER TABLE public.commercial_walkthroughs
  DROP CONSTRAINT IF EXISTS commercial_walkthroughs_excluded_chk;
ALTER TABLE public.commercial_walkthroughs
  ADD CONSTRAINT commercial_walkthroughs_excluded_chk
  CHECK (status <> 'excluded' OR (
    exclusion_code IN ('mold_over_threshold', 'active_infestation', 'biohazard', 'structural_hazard', 'other')
    AND exclusion_note IS NOT NULL AND length(btrim(exclusion_note)) >= 10
  ));

-- Moving off the formula requires saying why — the same discipline as every
-- other pricing override in this system.
ALTER TABLE public.commercial_walkthroughs
  DROP CONSTRAINT IF EXISTS commercial_walkthroughs_adjustment_chk;
ALTER TABLE public.commercial_walkthroughs
  ADD CONSTRAINT commercial_walkthroughs_adjustment_chk
  CHECK (
    status <> 'priced'
    OR formula_price_cents IS NULL
    OR firm_price_cents = formula_price_cents
    OR (price_adjustment_reason IS NOT NULL AND length(btrim(price_adjustment_reason)) >= 10)
  );

CREATE INDEX IF NOT EXISTS commercial_walkthroughs_status_idx
  ON public.commercial_walkthroughs (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS commercial_walkthroughs_stalled_idx
  ON public.commercial_walkthroughs (conducted_on)
  WHERE status = 'conducted';

-- One live walkthrough per site: two open pipelines for one building means two
-- prices under negotiation and nobody knowing which is real.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_walkthroughs_one_open
  ON public.commercial_walkthroughs (business_site_id)
  WHERE status IN ('requested', 'scheduled', 'conducted');

-- ─── 4. The Site carries the outcome ───────────────────────────────────────
-- The walkthrough is the evidence; the Site is what the booking flow reads.

ALTER TABLE public.business_sites
  ADD COLUMN IF NOT EXISTS firm_price_cents integer,
  ADD COLUMN IF NOT EXISTS recommended_crew_size integer,
  ADD COLUMN IF NOT EXISTS walkthrough_id uuid
    REFERENCES public.commercial_walkthroughs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pricing_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS required_equipment text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS exclusion_code text,
  ADD COLUMN IF NOT EXISTS exclusion_note text;

COMMENT ON COLUMN public.business_sites.firm_price_cents IS
  'The rate this site services at, set from its walkthrough findings. Written by the walkthrough pipeline; this is what Exhibit A lists and what a booking prices at.';
COMMENT ON COLUMN public.business_sites.walkthrough_id IS
  'The walkthrough that produced the current firm price — the findings-to-price trail for this site.';
COMMENT ON COLUMN public.business_sites.exclusion_note IS
  'Why pricing could not be completed here. Set when a walkthrough finds an excluded condition; cleared when a later walkthrough prices the site.';

-- ─── 5. Requesting a walkthrough is automatic where it is mandatory ────────
-- A site added at or above the threshold needs one whether or not anybody
-- remembers to ask for one. The request is created with the client-stated
-- numbers so the pipeline starts from what we were told.

CREATE OR REPLACE FUNCTION public.request_walkthrough_for_site()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_threshold integer;
  v_open uuid;
BEGIN
  IF NEW.sqft IS NULL OR NOT NEW.active THEN RETURN NEW; END IF;

  SELECT COALESCE((value ->> 'walkthrough_threshold_sqft')::integer, 5000)
    INTO v_threshold
  FROM public.app_settings WHERE key = 'commercial_pricing_settings';
  v_threshold := COALESCE(v_threshold, 5000);

  IF NEW.sqft < v_threshold THEN RETURN NEW; END IF;
  -- Already priced, or already in the pipeline: nothing to open.
  IF NEW.firm_price_cents IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_open FROM public.commercial_walkthroughs
  WHERE business_site_id = NEW.id
    AND status IN ('requested', 'scheduled', 'conducted', 'priced')
  LIMIT 1;
  IF v_open IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.commercial_walkthroughs (
    business_account_id, business_site_id, status,
    request_reason, requested_by_name,
    client_stated_sqft, client_stated_facility_type,
    site_address, facility_type_key, scope_level, sqft
  ) VALUES (
    NEW.business_account_id, NEW.id, 'requested',
    'new_site_at_threshold', 'System',
    NEW.sqft, NEW.facility_type,
    concat_ws(', ', NEW.address, NEW.city, NEW.state, NEW.zip_code),
    NEW.facility_type_key, NEW.scope_level, NULL
  );

  INSERT INTO public.events (event_type, source, summary, data)
  VALUES (
    'walkthrough.requested',
    'business_sites',
    format('Walkthrough requested for %s — %s sq ft is at or above the %s sq ft threshold, so it cannot be priced from a desk.',
           NEW.nickname, NEW.sqft, v_threshold),
    jsonb_build_object('site_id', NEW.id, 'account_id', NEW.business_account_id,
                       'client_stated_sqft', NEW.sqft, 'threshold', v_threshold)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_request_walkthrough_for_site ON public.business_sites;
CREATE TRIGGER trg_request_walkthrough_for_site
  AFTER INSERT OR UPDATE OF sqft, active ON public.business_sites
  FOR EACH ROW EXECUTE FUNCTION public.request_walkthrough_for_site();

-- ─── 6. Is this site priced? ───────────────────────────────────────────────
/**
 * Whether a site may reach a confirmed, dispatchable booking.
 *
 * Below the threshold the formula prices it and no walkthrough is needed.
 * At or above it, a walkthrough must have reached `priced`. An excluded site
 * is never eligible, whatever its size — that is the point of an exclusion.
 */
CREATE OR REPLACE FUNCTION public.commercial_site_pricing_state(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site public.business_sites%ROWTYPE;
  v_threshold integer;
  v_wt public.commercial_walkthroughs%ROWTYPE;
  v_needs boolean;
BEGIN
  SELECT * INTO v_site FROM public.business_sites WHERE id = p_site_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'eligible', false,
                              'reason', 'Site not found.');
  END IF;

  SELECT COALESCE((value ->> 'walkthrough_threshold_sqft')::integer, 5000)
    INTO v_threshold
  FROM public.app_settings WHERE key = 'commercial_pricing_settings';
  v_threshold := COALESCE(v_threshold, 5000);
  v_needs := v_site.sqft IS NOT NULL AND v_site.sqft >= v_threshold;

  SELECT * INTO v_wt FROM public.commercial_walkthroughs
  WHERE business_site_id = p_site_id
    AND status IN ('requested', 'scheduled', 'conducted', 'priced', 'excluded')
  ORDER BY CASE status
             WHEN 'priced' THEN 0 WHEN 'excluded' THEN 1 WHEN 'conducted' THEN 2
             WHEN 'scheduled' THEN 3 ELSE 4 END,
           requested_at DESC
  LIMIT 1;

  IF v_site.excluded_at IS NOT NULL OR (FOUND AND v_wt.status = 'excluded') THEN
    RETURN jsonb_build_object(
      'found', true, 'eligible', false, 'requires_walkthrough', v_needs,
      'stage', 'excluded',
      'exclusion_code', COALESCE(v_site.exclusion_code, v_wt.exclusion_code),
      'reason', COALESCE(v_site.exclusion_note, v_wt.exclusion_note,
                         'A walkthrough found a condition outside what we service.'),
      'walkthrough_id', v_wt.id
    );
  END IF;

  IF NOT v_needs THEN
    RETURN jsonb_build_object('found', true, 'eligible', true,
                              'requires_walkthrough', false, 'stage', 'formula_priced');
  END IF;

  IF v_site.firm_price_cents IS NOT NULL THEN
    RETURN jsonb_build_object(
      'found', true, 'eligible', true, 'requires_walkthrough', true,
      'stage', 'priced', 'firm_price_cents', v_site.firm_price_cents,
      'walkthrough_id', v_site.walkthrough_id,
      'recommended_crew_size', v_site.recommended_crew_size
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true, 'eligible', false, 'requires_walkthrough', true,
    'stage', COALESCE(v_wt.status, 'not_started'),
    'walkthrough_id', v_wt.id,
    'reason', CASE COALESCE(v_wt.status, 'not_started')
      WHEN 'not_started' THEN format('%s sq ft is at or above the %s sq ft walkthrough threshold and no walkthrough has been requested.', v_site.sqft, v_threshold)
      WHEN 'requested' THEN 'A walkthrough has been requested for this site but not yet scheduled.'
      WHEN 'scheduled' THEN 'A walkthrough is scheduled for this site but has not been conducted.'
      WHEN 'conducted' THEN 'The walkthrough is done — its findings still need a firm price set.'
      ELSE 'This site has no firm price yet.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_site_pricing_state(uuid) TO authenticated, service_role;

-- ─── 7. Pipeline view, with aging ──────────────────────────────────────────
-- A large prospective deal must not stall silently between "we did the visit"
-- and "we actually priced it", which is exactly where they stall.

DROP VIEW IF EXISTS public.walkthrough_pipeline_v1;
CREATE VIEW public.walkthrough_pipeline_v1
WITH (security_invoker = true) AS
SELECT
  w.id,
  w.business_account_id,
  w.business_site_id,
  a.business_name,
  s.nickname                       AS site_nickname,
  COALESCE(s.address, w.site_address) AS site_address,
  w.status,
  w.request_reason,
  w.requested_at,
  w.scheduled_at,
  w.conducted_on,
  w.conducted_by,
  w.priced_at,
  w.findings_complete,
  w.client_stated_sqft,
  w.sqft                           AS confirmed_sqft,
  w.facility_type_key,
  w.scope_level,
  w.condition_level,
  w.recommended_crew_size,
  w.required_equipment,
  w.formula_price_cents,
  w.firm_price_cents,
  w.price_adjustment_reason,
  w.exclusion_code,
  w.exclusion_note,
  w.supersedes_walkthrough_id,
  jsonb_array_length(w.photos)     AS photo_count,
  -- Business days since the findings landed. Weekends are not a deal stalling.
  CASE WHEN w.status = 'conducted' AND w.conducted_on IS NOT NULL THEN (
    SELECT count(*)::int FROM generate_series(w.conducted_on + 1, CURRENT_DATE, interval '1 day') d
    WHERE EXTRACT(ISODOW FROM d) < 6
  ) END                            AS business_days_pending_price,
  (w.status = 'conducted' AND w.conducted_on IS NOT NULL AND (
    SELECT count(*)::int FROM generate_series(w.conducted_on + 1, CURRENT_DATE, interval '1 day') d
    WHERE EXTRACT(ISODOW FROM d) < 6
  ) >= public.walkthrough_setting_int('stalled_after_business_days', 3)) AS stalled,
  -- Where the price landed relative to the formula, so an outlier is visible
  -- without opening the record.
  CASE WHEN w.formula_price_cents IS NOT NULL AND w.formula_price_cents > 0
            AND w.firm_price_cents IS NOT NULL
       THEN ROUND(((w.firm_price_cents - w.formula_price_cents)::numeric
                   / w.formula_price_cents) * 100, 1) END AS adjustment_pct,
  -- Ordering: stalled first, then live pipeline oldest-first, then closed.
  CASE
    WHEN w.status = 'conducted' THEN 0
    WHEN w.status = 'scheduled' THEN 1
    WHEN w.status = 'requested' THEN 2
    WHEN w.status = 'excluded'  THEN 3
    WHEN w.status = 'priced'    THEN 4
    ELSE 5
  END                              AS stage_rank
FROM public.commercial_walkthroughs w
LEFT JOIN public.business_accounts a ON a.id = w.business_account_id
LEFT JOIN public.business_sites   s ON s.id = w.business_site_id;

COMMENT ON VIEW public.walkthrough_pipeline_v1 IS
  'Every walkthrough by stage, with business-days-pending-price and the distance between the firm price and the formula anchor. Conducted-pending-price sorts first: findings captured but the deal not moving is the failure this view exists to catch.';

GRANT SELECT ON public.walkthrough_pipeline_v1 TO authenticated, service_role;

-- ─── 8. Re-walkthrough signal ──────────────────────────────────────────────
-- The residential duration-variance loop already measures projected against
-- actual hours per job. Reading it per SITE turns it into the re-walkthrough
-- trigger: a site chronically running long means the walkthrough's assumptions
-- were wrong, and absorbing that gap forever is a decision nobody made.

DROP VIEW IF EXISTS public.commercial_site_variance_v1;
CREATE VIEW public.commercial_site_variance_v1
WITH (security_invoker = true) AS
WITH visits AS (
  SELECT
    b.business_site_id                       AS site_id,
    d.projected_hours,
    d.actual_hours,
    d.variance_pct,
    b.recommended_crew_size,
    b.num_cleaners_assigned
  FROM public.job_duration_actuals d
  JOIN public.bookings b ON b.id = d.booking_id
  WHERE b.business_site_id IS NOT NULL
)
SELECT
  s.id                                       AS site_id,
  s.business_account_id                      AS account_id,
  a.business_name,
  s.nickname                                 AS site_nickname,
  s.firm_price_cents,
  s.walkthrough_id,
  w.conducted_on                             AS priced_from_walkthrough_on,
  count(v.*)::int                            AS samples,
  ROUND(avg(v.projected_hours), 2)           AS avg_projected_hours,
  ROUND(avg(v.actual_hours), 2)              AS avg_actual_hours,
  ROUND(avg(v.variance_pct), 1)              AS avg_variance_pct,
  -- Crews consistently bigger than the walkthrough recommended is the same
  -- signal wearing different clothes: the job is larger than it was priced as.
  ROUND(avg(v.num_cleaners_assigned::numeric), 1)   AS avg_crew_used,
  ROUND(avg(v.recommended_crew_size::numeric), 1)   AS avg_crew_recommended,
  (
    count(v.*) >= public.walkthrough_setting_int('variance_min_samples', 4)
    AND (
      abs(avg(v.variance_pct)) >= public.walkthrough_setting_int('variance_pct_threshold', 15)
      OR avg(v.num_cleaners_assigned::numeric) > avg(v.recommended_crew_size::numeric) + 0.5
    )
  )                                          AS rewalkthrough_suggested
FROM public.business_sites s
JOIN public.business_accounts a ON a.id = s.business_account_id
LEFT JOIN visits v ON v.site_id = s.id
LEFT JOIN public.commercial_walkthroughs w ON w.id = s.walkthrough_id
WHERE s.active
GROUP BY s.id, s.business_account_id, a.business_name, s.nickname,
         s.firm_price_cents, s.walkthrough_id, w.conducted_on;

COMMENT ON VIEW public.commercial_site_variance_v1 IS
  'Per-site projected vs actual service hours and crew size, read from the existing job_duration_actuals loop. rewalkthrough_suggested is the signal that a site''s walkthrough assumptions no longer match how it actually services.';

GRANT SELECT ON public.commercial_site_variance_v1 TO authenticated, service_role;

-- ─── 9. Alert routing ──────────────────────────────────────────────────────
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('walkthrough.requested',   'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('walkthrough.scheduled',   'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('walkthrough.reminder',    'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('walkthrough.conducted',   'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('walkthrough.priced',      'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('walkthrough.excluded',    'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('walkthrough.stalled',     'DISCORD_WEBHOOK_REVENUE',  ARRAY['DISCORD_ROLE_SALES']),
  ('walkthrough.rewalk_suggested', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- ─── 10. Daily sweep: reminders, stalls, re-walkthrough signals ────────────
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

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'walkthrough-pipeline-sweep';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('walkthrough-pipeline-sweep'); END IF;

  -- Hourly: reminders are time-of-day sensitive, stalls and variance are not.
  PERFORM cron.schedule(
    'walkthrough-pipeline-sweep',
    '20 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/walkthrough-pipeline-sweep',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url, coalesce(v_anon_key, '')
    )
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — walkthrough-pipeline-sweep not scheduled.';
END $$;

NOTIFY pgrst, 'reload schema';
