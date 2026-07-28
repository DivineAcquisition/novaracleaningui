-- ─── Schedule buffer: honest projections + enforced breathing room ────────
--
-- Two cleaners overslept, arrived 2 hours late to a 5-hour job, the delay ate
-- the next job on their day, that customer waited with no word and cancelled.
-- The lateness was the trigger; the real defect was a schedule with ZERO
-- tolerance — back-to-back jobs sized off a flat 3-hour guess.
--
-- This half of the build makes the schedule honest and gives it slack:
--
--   1. service_duration_assumptions — the duration model (service type ×
--      sqft band), seeded from the same numbers the pricing engine and
--      auto-dispatch already use, and CORRECTABLE from measured reality by
--      the learning loop (learned_multiplier).
--   2. Projection functions — a booking's start clock and its PROJECTED END
--      (start + realistic duration for its band/tier/condition). A deep clean
--      projects deep-clean hours; a 2,000 sqft standard projects its real
--      time. Never a flat guess.
--   3. evaluate_schedule_buffer() — is there room between this job and the
--      crew's other jobs that day (buffer + travel time where coordinates
--      exist)?
--   4. Write guards — the buffer is enforced at the moment the data changes,
--      on job_assignments AND on bookings (date/time/crew). That covers every
--      path that books or edits: internal booking flow, recurring generation,
--      admin edits, dispatch, GHL patches — including any path added later.
--      An explicit, logged admin override in schedule_buffer_overrides is the
--      only way through, and it stays on the record so a cascade can always be
--      traced back to the override that allowed it.
--
-- Reuses: app_settings (thresholds), jobs/job_assignments (the dispatch
-- clock + crew), is_admin_or_va() RLS, events + discord_routes (alerts).

-- ─── 1. Tunables ────────────────────────────────────────────────────────────
-- All thresholds live in one admin-editable settings row. schedule_guard_settings()
-- merges stored values over the defaults so a partial row is always safe.

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'schedule_guard_settings',
  jsonb_build_object(
    'timezone',                          'America/New_York',
    'buffer_minutes',                    60,
    'enforce_buffer_at_write',           true,
    'travel_time_enabled',               true,
    'travel_speed_mph',                  30,
    'late_start_minutes',                15,
    'no_show_minutes',                   30,
    'overrun_grace_minutes',             10,
    'field_flag_overrun_minutes',        45,
    'risk_ack_escalate_minutes',         20,
    'customer_message_escalate_minutes', 20,
    'auto_send_initial_heads_up',        false,
    'condition_multipliers',             jsonb_build_object('light', 0.9, 'normal', 1.0, 'heavy', 1.25, 'severe', 1.5),
    'variance_min_samples',              5
  ),
  'Schedule buffer + delay-cascade config. buffer_minutes: required gap between a crew''s consecutive jobs (travel time added on top when both addresses are geocoded). late_start_minutes / no_show_minutes: minutes past scheduled start with no en-route/start before a late-start, then a no-show, event fires. overrun_grace_minutes: slack past projected end before an overrun event. field_flag_overrun_minutes: overrun assumed the moment a cleaner flags the job as bigger than scoped. risk_ack_escalate_minutes / customer_message_escalate_minutes: how long an at-risk booking or an unsent customer heads-up may sit before it escalates to admin. auto_send_initial_heads_up: when true the first heads-up text sends itself (default false — a human taps send).'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.schedule_guard_default_settings()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'timezone',                          'America/New_York',
    'buffer_minutes',                    60,
    'enforce_buffer_at_write',           true,
    'travel_time_enabled',               true,
    'travel_speed_mph',                  30,
    'late_start_minutes',                15,
    'no_show_minutes',                   30,
    'overrun_grace_minutes',             10,
    'field_flag_overrun_minutes',        45,
    'risk_ack_escalate_minutes',         20,
    'customer_message_escalate_minutes', 20,
    'auto_send_initial_heads_up',        false,
    'condition_multipliers',             jsonb_build_object('light', 0.9, 'normal', 1.0, 'heavy', 1.25, 'severe', 1.5),
    'variance_min_samples',              5
  );
$$;

CREATE OR REPLACE FUNCTION public.schedule_guard_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.schedule_guard_default_settings() || COALESCE(
    (SELECT value FROM public.app_settings
      WHERE key = 'schedule_guard_settings' AND jsonb_typeof(value) = 'object'),
    '{}'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION public.schedule_guard_settings() TO authenticated, service_role;

-- Single accessor so every caller reads the same tunable the same way.
CREATE OR REPLACE FUNCTION public.schedule_guard_setting_num(p_key text, p_fallback numeric)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(public.schedule_guard_settings() ->> p_key, '')::numeric, p_fallback);
$$;

CREATE OR REPLACE FUNCTION public.schedule_guard_timezone()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(public.schedule_guard_settings() ->> 'timezone', ''), 'America/New_York');
$$;

-- ─── 2. The duration model ──────────────────────────────────────────────────
-- Seeded from the numbers already in production: HOME_SIZE_HOURS (sqft band
-- base hours, shared by the pricing engine and the checkout estimate) scaled
-- by the service-tier effort multipliers auto-dispatch uses for job windows
-- (deep 1.5×, move-in/out 2.0×, combo 2.5×). Keeping the model in the
-- database — rather than only in TypeScript — means every projection (SQL
-- guards, cron sweeps, reports, and the app) reads ONE set of numbers, and
-- the learning loop can correct them without a deploy.

CREATE OR REPLACE FUNCTION public.normalize_service_key(p_service_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN regexp_replace(lower(COALESCE(p_service_type, '')), '[\s_-]+', '', 'g') LIKE '%move%'  THEN 'moveinout'
    WHEN regexp_replace(lower(COALESCE(p_service_type, '')), '[\s_-]+', '', 'g') LIKE '%combo%' THEN 'combo'
    WHEN regexp_replace(lower(COALESCE(p_service_type, '')), '[\s_-]+', '', 'g') LIKE '%deep%'  THEN 'deep'
    ELSE 'standard'
  END;
$$;

CREATE TABLE IF NOT EXISTS public.service_duration_assumptions (
  service_type text NOT NULL,          -- normalized key: standard | deep | moveinout | combo
  home_size_id text NOT NULL,          -- sqft band id, e.g. '2001_2500'
  base_hours numeric(5,2) NOT NULL CHECK (base_hours > 0),
  -- Correction applied by the learning loop once enough completed jobs show a
  -- consistent gap between projection and reality. 1.000 = the model as
  -- originally assumed. Bounded so a bad sample can never produce an absurd
  -- projection.
  learned_multiplier numeric(5,3) NOT NULL DEFAULT 1.000
    CHECK (learned_multiplier BETWEEN 0.500 AND 2.500),
  learned_from_samples integer NOT NULL DEFAULT 0,
  learned_at timestamptz,
  learned_by uuid,
  learned_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_type, home_size_id)
);

INSERT INTO public.service_duration_assumptions (service_type, home_size_id, base_hours)
SELECT tier.key, band.id, ROUND(band.hours * tier.mult, 2)
FROM (VALUES
  ('0_999',      2.0),
  ('1000_1500',  2.5),
  ('1501_2000',  3.0),
  ('2001_2500',  3.5),
  ('2501_3000',  4.0),
  ('3001_3500',  4.5),
  ('3501_4000',  5.0),
  ('4001_4500',  5.5),
  ('4501_5000',  6.0),
  ('5000_plus',  8.0)
) AS band(id, hours)
CROSS JOIN (VALUES
  ('standard',  1.0),
  ('deep',      1.5),
  ('moveinout', 2.0),
  ('combo',     2.5)
) AS tier(key, mult)
ON CONFLICT (service_type, home_size_id) DO NOTHING;

ALTER TABLE public.service_duration_assumptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_duration_assumptions' AND policyname = 'sda_admin_read') THEN
    CREATE POLICY sda_admin_read ON public.service_duration_assumptions FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_duration_assumptions' AND policyname = 'sda_service_role') THEN
    CREATE POLICY sda_service_role ON public.service_duration_assumptions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Condition is optional and only tightens the projection when someone has
-- actually assessed the property (a VA on the booking, or a heavy-condition
-- scope adjustment after the fact). Unset means the tier/band model stands.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS condition_level text
    CHECK (condition_level IS NULL OR condition_level IN ('light','normal','heavy','severe'));

COMMENT ON COLUMN public.bookings.condition_level IS
  'Assessed property condition. Feeds the duration projection through schedule_guard_settings.condition_multipliers. NULL = not assessed, tier/band projection stands.';

/**
 * Realistic hours for a service type × sqft band, with the learned correction
 * and the condition multiplier applied. Falls back to the tier multipliers
 * over a 4h base for any band id not in the table, so a projection is ALWAYS
 * produced — silence here would mean an unbuffered booking slipping through.
 */
CREATE OR REPLACE FUNCTION public.projected_duration_hours(
  p_home_size_id text,
  p_service_type text,
  p_condition_level text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := public.normalize_service_key(p_service_type);
  v_hours numeric;
  v_learned numeric := 1.0;
  v_condition numeric := 1.0;
BEGIN
  SELECT base_hours, learned_multiplier
    INTO v_hours, v_learned
  FROM public.service_duration_assumptions
  WHERE service_type = v_key AND home_size_id = COALESCE(p_home_size_id, '');

  IF v_hours IS NULL THEN
    v_hours := 4.0 * CASE v_key
      WHEN 'deep' THEN 1.5
      WHEN 'moveinout' THEN 2.0
      WHEN 'combo' THEN 2.5
      ELSE 1.0
    END;
    v_learned := 1.0;
  END IF;

  IF p_condition_level IS NOT NULL THEN
    v_condition := COALESCE(
      NULLIF(public.schedule_guard_settings() -> 'condition_multipliers' ->> p_condition_level, '')::numeric,
      1.0
    );
  END IF;

  RETURN ROUND(v_hours * COALESCE(v_learned, 1.0) * v_condition, 2);
END;
$$;

/**
 * Start clock for a booking's arrival window. Mirrors parseTimeSlotToClock in
 * supabase/functions/_shared/sms.ts: canonical slot ids ('8-12'), named
 * windows, and freeform '9:00 AM - 12:00 PM'. NULL when unparseable — callers
 * decide whether to skip or default, rather than silently projecting 9am.
 */
CREATE OR REPLACE FUNCTION public.parse_time_slot_start(p_slot text)
RETURNS time
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw text := btrim(COALESCE(p_slot, ''));
  v_low text;
  v_m text[];
  v_hour int;
  v_min int;
  v_mer text;
BEGIN
  IF v_raw = '' THEN RETURN NULL; END IF;
  v_low := lower(v_raw);

  -- Canonical arrival-window ids the booking funnel stores.
  IF v_raw = '8-12'  THEN RETURN time '08:00'; END IF;
  IF v_raw = '12-16' THEN RETURN time '12:00'; END IF;
  IF v_raw = '16-20' THEN RETURN time '16:00'; END IF;

  -- Named windows used by some legacy callers.
  IF v_low = 'morning' THEN RETURN time '08:00'; END IF;
  IF v_low IN ('midday','afternoon') THEN RETURN time '12:00'; END IF;
  IF v_low = 'evening' THEN RETURN time '16:00'; END IF;

  -- Freeform range: '9:00 AM - 12:00 PM', '9-12', '9am-1pm'.
  v_m := regexp_match(v_raw, '(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*(?:-|–|—|to)\s*\d', 'i');
  IF v_m IS NULL THEN
    -- Single time: '9:00 AM', '10am'.
    v_m := regexp_match(v_raw, '^(\d{1,2}):(\d{2})\s*(AM|PM)?$', 'i');
    IF v_m IS NULL THEN
      v_m := regexp_match(v_raw, '^(\d{1,2})()\s*(AM|PM)$', 'i');
    END IF;
  END IF;
  IF v_m IS NULL THEN RETURN NULL; END IF;

  v_hour := v_m[1]::int;
  v_min := COALESCE(NULLIF(v_m[2], ''), '0')::int;
  v_mer := upper(COALESCE(v_m[3], ''));
  IF v_mer = 'PM' AND v_hour < 12 THEN v_hour := v_hour + 12; END IF;
  IF v_mer = 'AM' AND v_hour = 12 THEN v_hour := 0; END IF;
  IF v_hour > 23 OR v_min > 59 THEN RETURN NULL; END IF;

  RETURN make_time(v_hour, v_min, 0);
END;
$$;

/**
 * The instant a booking's arrival window opens.
 *
 * service_date is a DATE and time_slot a label, so the two only become a real
 * instant against the operating timezone (schedule_guard_settings.timezone).
 * Everything in this feature — lateness, overrun, projected arrival — measures
 * against this, so the clock is the same everywhere.
 */
CREATE OR REPLACE FUNCTION public.booking_scheduled_start(
  p_service_date date,
  p_time_slot text,
  p_arrival_window text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time time := COALESCE(
    public.parse_time_slot_start(p_time_slot),
    public.parse_time_slot_start(p_arrival_window)
  );
BEGIN
  IF p_service_date IS NULL OR v_time IS NULL THEN RETURN NULL; END IF;
  RETURN (p_service_date + v_time) AT TIME ZONE public.schedule_guard_timezone();
END;
$$;

/** Straight-line miles between two points (haversine). */
CREATE OR REPLACE FUNCTION public.geo_distance_miles(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE ROUND((
      3958.8 * 2 * asin(LEAST(1, sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
          * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      )))
    )::numeric, 2)
  END;
$$;

/**
 * Drive minutes between two job sites, or NULL when either address has never
 * been geocoded. Straight-line distance at a configurable average speed is a
 * deliberate under-estimate: where the data doesn't exist the buffer alone
 * stands, and where it does exist it only ever ASKS FOR MORE room.
 */
CREATE OR REPLACE FUNCTION public.travel_minutes_between(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.schedule_guard_settings();
  v_miles numeric;
  v_mph numeric;
BEGIN
  IF COALESCE(v_cfg ->> 'travel_time_enabled', 'true') <> 'true' THEN RETURN NULL; END IF;
  v_miles := public.geo_distance_miles(p_lat1, p_lng1, p_lat2, p_lng2);
  IF v_miles IS NULL THEN RETURN NULL; END IF;
  v_mph := GREATEST(5, COALESCE(NULLIF(v_cfg ->> 'travel_speed_mph', '')::numeric, 30));
  RETURN CEIL(v_miles / v_mph * 60)::integer;
END;
$$;

/** NVC-#### where a booking number exists, else a short id — matches QC. */
CREATE OR REPLACE FUNCTION public.booking_ref_label(p_booking_number integer, p_booking_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_booking_number IS NOT NULL THEN 'NVC-' || lpad(p_booking_number::text, 4, '0')
    ELSE 'Job ' || left(COALESCE(p_booking_id::text, ''), 8)
  END;
$$;

-- Statuses where a booking still occupies real time on a cleaner's day.
CREATE OR REPLACE FUNCTION public.schedule_live_booking_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(COALESCE(p_status, '')) NOT IN
    ('cancelled','canceled','completed','abandoned','pending_payment','refunded');
$$;

-- Assignment statuses that represent a real commitment (not a speculative
-- offer or broadcast). The buffer is enforced on commitment.
CREATE OR REPLACE FUNCTION public.schedule_committed_assignment_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(replace(COALESCE(p_status, ''), '_', ' ')) IN
    ('confirmed','accepted','assigned','in progress','completed');
$$;

-- ─── 3. Projection view ─────────────────────────────────────────────────────
-- One read surface for "when does this booking start, and when does it really
-- end?" — used by the buffer math, the cascade walk, the sweep, and the UI.

CREATE OR REPLACE VIEW public.booking_projection_v1 AS
SELECT
  b.id                                  AS booking_id,
  b.job_id,
  b.booking_number,
  public.booking_ref_label(b.booking_number, b.id) AS booking_ref,
  b.status,
  b.service_date,
  b.time_slot,
  b.arrival_window,
  b.service_type,
  b.home_size_id,
  b.condition_level,
  b.cleaner_id,
  b.first_name,
  b.last_name,
  b.phone,
  b.email,
  b.address,
  b.city,
  b.state,
  b.zip_code,
  j.lat,
  j.lng,
  j.check_in_time,
  j.check_out_time,
  j.en_route_at,
  public.booking_scheduled_start(b.service_date, b.time_slot, b.arrival_window) AS scheduled_start_at,
  public.projected_duration_hours(b.home_size_id, b.service_type, b.condition_level) AS projected_duration_hours,
  public.booking_scheduled_start(b.service_date, b.time_slot, b.arrival_window)
    + (public.projected_duration_hours(b.home_size_id, b.service_type, b.condition_level) || ' hours')::interval
                                        AS projected_end_at,
  -- Once a crew actually starts, the honest projection runs from the real
  -- check-in, not the window we hoped for.
  COALESCE(j.check_in_time, public.booking_scheduled_start(b.service_date, b.time_slot, b.arrival_window))
    + (public.projected_duration_hours(b.home_size_id, b.service_type, b.condition_level) || ' hours')::interval
                                        AS live_projected_end_at
FROM public.bookings b
LEFT JOIN public.jobs j ON j.id = b.job_id;

COMMENT ON VIEW public.booking_projection_v1 IS
  'Per-booking schedule projection: arrival-window start as a real instant, realistic duration from the service-type × sqft-band model (with learned correction and condition), and the resulting projected end — the number every buffer and cascade decision is made against.';

-- ─── 4. Logged buffer overrides ─────────────────────────────────────────────
-- The ONLY way a booking lands inside a crew's buffer. Kept forever: when a
-- cascade happens, the override that allowed it is right here on the record.

CREATE TABLE IF NOT EXISTS public.schedule_buffer_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  -- The other job whose buffer this booking eats into.
  conflicting_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  required_buffer_minutes integer NOT NULL,
  actual_gap_minutes integer,
  travel_minutes integer,
  projected_end_at timestamptz,
  -- Why the admin forced it. Required — an override without a reason is just
  -- the old zero-tolerance schedule with extra steps.
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  conflict_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sbo_booking_idx
  ON public.schedule_buffer_overrides (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sbo_active_lookup_idx
  ON public.schedule_buffer_overrides (booking_id, cleaner_id) WHERE active;
CREATE INDEX IF NOT EXISTS sbo_created_at_idx
  ON public.schedule_buffer_overrides (created_at DESC);

ALTER TABLE public.schedule_buffer_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'schedule_buffer_overrides' AND policyname = 'sbo_admin_read') THEN
    CREATE POLICY sbo_admin_read ON public.schedule_buffer_overrides FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'schedule_buffer_overrides' AND policyname = 'sbo_service_role') THEN
    CREATE POLICY sbo_service_role ON public.schedule_buffer_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

COMMENT ON TABLE public.schedule_buffer_overrides IS
  'Explicit admin decisions to book inside a crew''s required buffer, with the reason and the exact conflict that was overridden. The write guards accept a booking into the buffer only when a matching active row exists.';

-- ─── 5. Buffer evaluation ───────────────────────────────────────────────────

/**
 * Does this cleaner set have room for this booking on this day?
 *
 * Walks every OTHER live booking the cleaner(s) hold that day (via
 * bookings.cleaner_id or a committed job_assignments row), projects each one's
 * end from the duration model, and requires buffer_minutes — plus drive time
 * when both addresses are geocoded — on either side.
 *
 * Returns { ok, required_buffer_minutes, start_at, projected_end_at,
 *           conflicts: [ … ], message }. Conflicts carry the numbers the
 * message is built from so the UI can render its own copy.
 */
CREATE OR REPLACE FUNCTION public.evaluate_schedule_buffer(
  p_booking_id uuid,
  p_cleaner_ids uuid[],
  p_service_date date DEFAULT NULL,
  p_time_slot text DEFAULT NULL,
  p_service_type text DEFAULT NULL,
  p_home_size_id text DEFAULT NULL,
  p_condition_level text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.schedule_guard_settings();
  v_tz text := public.schedule_guard_timezone();
  v_buffer int := GREATEST(0, COALESCE(NULLIF(v_cfg ->> 'buffer_minutes', '')::int, 60));
  v_booking record;
  v_date date;
  v_slot text;
  v_service text;
  v_band text;
  v_condition text;
  v_start timestamptz;
  v_duration numeric;
  v_end timestamptz;
  v_lat numeric;
  v_lng numeric;
  v_ids uuid[];
  v_conflicts jsonb := '[]'::jsonb;
  v_row record;
  v_travel int;
  v_required int;
  v_gap int;
  v_kind text;
  v_message text;
BEGIN
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_cleaner_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL);

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;

  v_date      := COALESCE(p_service_date, v_booking.service_date);
  v_slot      := COALESCE(p_time_slot, v_booking.time_slot, v_booking.arrival_window);
  v_service   := COALESCE(p_service_type, v_booking.service_type);
  v_band      := COALESCE(p_home_size_id, v_booking.home_size_id);
  v_condition := COALESCE(p_condition_level, v_booking.condition_level);

  -- No cleaner, no date, or an unparseable window: nothing to measure. Say so
  -- explicitly rather than pretending the schedule is safe.
  IF array_length(v_ids, 1) IS NULL OR v_date IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'evaluated', false, 'reason', 'no_crew_or_date',
                              'required_buffer_minutes', v_buffer, 'conflicts', '[]'::jsonb);
  END IF;

  v_start := public.booking_scheduled_start(v_date, v_slot, NULL);
  IF v_start IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'evaluated', false, 'reason', 'unparseable_time_slot',
                              'required_buffer_minutes', v_buffer, 'conflicts', '[]'::jsonb);
  END IF;

  v_duration := public.projected_duration_hours(v_band, v_service, v_condition);
  v_end := v_start + (v_duration || ' hours')::interval;

  SELECT j.lat, j.lng INTO v_lat, v_lng
  FROM public.jobs j WHERE j.id = v_booking.job_id;

  FOR v_row IN
    SELECT DISTINCT ON (p.booking_id)
      p.booking_id, p.booking_ref, p.scheduled_start_at, p.projected_end_at,
      p.projected_duration_hours, p.service_type, p.home_size_id, p.lat, p.lng,
      p.first_name, p.last_name, p.time_slot,
      a.cleaner_id,
      TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name
    FROM public.booking_projection_v1 p
    JOIN (
      SELECT b2.id AS booking_id, b2.cleaner_id
      FROM public.bookings b2
      WHERE b2.cleaner_id = ANY (v_ids)
      UNION
      SELECT b3.id, ja.cleaner_id
      FROM public.bookings b3
      JOIN public.job_assignments ja ON ja.job_id = b3.job_id
      WHERE ja.cleaner_id = ANY (v_ids)
        AND public.schedule_committed_assignment_status(ja.status)
    ) a ON a.booking_id = p.booking_id
    LEFT JOIN public.cleaners c ON c.id = a.cleaner_id
    WHERE p.service_date = v_date
      AND (p_booking_id IS NULL OR p.booking_id <> p_booking_id)
      AND public.schedule_live_booking_status(p.status)
      AND p.scheduled_start_at IS NOT NULL
    ORDER BY p.booking_id, p.scheduled_start_at
  LOOP
    v_travel := public.travel_minutes_between(v_row.lat, v_row.lng, v_lat, v_lng);
    v_required := v_buffer + COALESCE(v_travel, 0);

    IF v_row.scheduled_start_at <= v_start THEN
      -- Existing job runs BEFORE this one: its projected end must clear our start.
      v_kind := 'before';
      v_gap := FLOOR(EXTRACT(EPOCH FROM (v_start - v_row.projected_end_at)) / 60)::int;
    ELSE
      -- Existing job runs AFTER: our projected end must clear its start.
      v_kind := 'after';
      v_gap := FLOOR(EXTRACT(EPOCH FROM (v_row.scheduled_start_at - v_end)) / 60)::int;
    END IF;

    IF v_gap >= v_required THEN CONTINUE; END IF;

    IF v_kind = 'before' THEN
      v_message := format(
        'This crew''s earlier job (%s) projects to end at %s — this start time leaves only %s of the required %s buffer%s.',
        v_row.booking_ref,
        to_char(v_row.projected_end_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
        CASE WHEN v_gap < 0 THEN format('%s min of overlap', abs(v_gap)) ELSE format('%s min', v_gap) END,
        format('%s min', v_buffer),
        CASE WHEN v_travel IS NOT NULL THEN format(' plus %s min of travel', v_travel) ELSE '' END
      );
    ELSE
      v_message := format(
        'This job projects to end at %s — the crew''s next job (%s) starts at %s, leaving only %s of the required %s buffer%s.',
        to_char(v_end AT TIME ZONE v_tz, 'FMHH12:MI AM'),
        v_row.booking_ref,
        to_char(v_row.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
        CASE WHEN v_gap < 0 THEN format('%s min of overlap', abs(v_gap)) ELSE format('%s min', v_gap) END,
        format('%s min', v_buffer),
        CASE WHEN v_travel IS NOT NULL THEN format(' plus %s min of travel', v_travel) ELSE '' END
      );
    END IF;

    v_conflicts := v_conflicts || jsonb_build_object(
      'kind', v_kind,
      'booking_id', v_row.booking_id,
      'booking_ref', v_row.booking_ref,
      'cleaner_id', v_row.cleaner_id,
      'cleaner_name', NULLIF(v_row.cleaner_name, ''),
      'customer_name', NULLIF(TRIM(COALESCE(v_row.first_name, '') || ' ' || COALESCE(v_row.last_name, '')), ''),
      'other_start_at', v_row.scheduled_start_at,
      'other_projected_end_at', v_row.projected_end_at,
      'other_service_type', v_row.service_type,
      'other_home_size_id', v_row.home_size_id,
      'this_start_at', v_start,
      'this_projected_end_at', v_end,
      'this_duration_hours', v_duration,
      'travel_minutes', v_travel,
      'required_minutes', v_required,
      'gap_minutes', v_gap,
      'shortfall_minutes', v_required - v_gap,
      'message', v_message
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_conflicts) = 0,
    'evaluated', true,
    'required_buffer_minutes', v_buffer,
    'start_at', v_start,
    'projected_end_at', v_end,
    'projected_duration_hours', v_duration,
    'cleaner_ids', to_jsonb(v_ids),
    'conflicts', v_conflicts,
    'message', COALESCE((v_conflicts -> 0 ->> 'message'), NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_schedule_buffer(uuid, uuid[], date, text, text, text, text)
  TO authenticated, service_role;

/**
 * Convenience wrapper: evaluate the buffer for a booking against a candidate
 * crew, resolving the crew from the booking itself when none is supplied.
 * This is the RPC the app calls before assigning or moving a job.
 */
CREATE OR REPLACE FUNCTION public.check_booking_buffer(
  p_booking_id uuid,
  p_cleaner_ids uuid[] DEFAULT NULL,
  p_service_date date DEFAULT NULL,
  p_time_slot text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_cleaner_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL);
BEGIN
  IF array_length(v_ids, 1) IS NULL THEN
    SELECT ARRAY(
      SELECT DISTINCT cid FROM (
        SELECT b.cleaner_id AS cid FROM public.bookings b WHERE b.id = p_booking_id
        UNION
        SELECT ja.cleaner_id FROM public.job_assignments ja
        JOIN public.bookings b2 ON b2.job_id = ja.job_id
        WHERE b2.id = p_booking_id AND public.schedule_committed_assignment_status(ja.status)
      ) q WHERE cid IS NOT NULL
    ) INTO v_ids;
  END IF;

  RETURN public.evaluate_schedule_buffer(p_booking_id, v_ids, p_service_date, p_time_slot);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_booking_buffer(uuid, uuid[], date, text) TO authenticated, service_role;

-- ─── 6. Write guards ────────────────────────────────────────────────────────
-- The buffer is a property of the DATA, so it is enforced where the data
-- changes. Every creation and edit path — the internal booking flow, recurring
-- generation, admin time/crew edits, dispatch, GHL patches, and anything added
-- later — hits one of these two triggers.
--
-- Escape hatches, both deliberate and both visible:
--   * an active schedule_buffer_overrides row for (booking, cleaner) — the
--     logged admin override;
--   * SET LOCAL novara.skip_buffer_guard = 'on' — for data repair/backfill
--     only, scoped to a single transaction.

CREATE OR REPLACE FUNCTION public.schedule_buffer_guard_enabled()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('novara.skip_buffer_guard', true), '') = 'on' THEN
    RETURN false;
  END IF;
  RETURN COALESCE(public.schedule_guard_settings() ->> 'enforce_buffer_at_write', 'true') = 'true';
END;
$$;

/**
 * Raises a buffer_conflict with the human explanation as the message and the
 * machine detail as DETAIL, so callers can show the copy verbatim and offer
 * the override. HINT is the stable code the app switches on.
 */
CREATE OR REPLACE FUNCTION public.raise_buffer_conflict(p_result jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%', COALESCE(
    p_result ->> 'message',
    'This start time does not leave the required buffer after the crew''s other job.'
  )
  USING DETAIL = p_result::text,
        HINT = 'buffer_conflict',
        ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_buffer_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking record;
  v_result jsonb;
  v_conflict jsonb;
  v_overridden boolean;
BEGIN
  IF NOT public.schedule_buffer_guard_enabled() THEN RETURN NEW; END IF;
  IF NOT public.schedule_committed_assignment_status(NEW.status) THEN RETURN NEW; END IF;

  -- Only a NEW commitment needs checking: re-saving an already-committed row
  -- (a status bump within the committed set, a token refresh) must not
  -- retroactively block work that is already on the books.
  IF TG_OP = 'UPDATE'
     AND OLD.cleaner_id = NEW.cleaner_id
     AND OLD.job_id = NEW.job_id
     AND public.schedule_committed_assignment_status(OLD.status) THEN
    RETURN NEW;
  END IF;

  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.job_id = NEW.job_id
  ORDER BY b.created_at DESC
  LIMIT 1;

  IF v_booking.id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.schedule_live_booking_status(v_booking.status) THEN RETURN NEW; END IF;
  IF v_booking.service_date IS NULL OR v_booking.service_date < (now() AT TIME ZONE public.schedule_guard_timezone())::date THEN
    RETURN NEW;
  END IF;

  v_result := public.evaluate_schedule_buffer(v_booking.id, ARRAY[NEW.cleaner_id]);
  IF COALESCE((v_result ->> 'ok')::boolean, true) THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.schedule_buffer_overrides o
    WHERE o.booking_id = v_booking.id AND o.active
      AND (o.cleaner_id IS NULL OR o.cleaner_id = NEW.cleaner_id)
  ) INTO v_overridden;
  IF v_overridden THEN RETURN NEW; END IF;

  v_conflict := v_result -> 'conflicts' -> 0;
  PERFORM public.raise_buffer_conflict(v_result || jsonb_build_object(
    'booking_id', v_booking.id,
    'cleaner_id', NEW.cleaner_id,
    'conflicting_booking_id', v_conflict ->> 'booking_id'
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_buffer_on_assignment_trg ON public.job_assignments;
CREATE TRIGGER enforce_buffer_on_assignment_trg
  BEFORE INSERT OR UPDATE OF cleaner_id, job_id, status ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_buffer_on_assignment();

CREATE OR REPLACE FUNCTION public.enforce_buffer_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_conflict jsonb;
  v_overridden boolean;
  v_changed boolean;
BEGIN
  IF NOT public.schedule_buffer_guard_enabled() THEN RETURN NEW; END IF;
  IF NEW.cleaner_id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.schedule_live_booking_status(NEW.status) THEN RETURN NEW; END IF;
  IF NEW.service_date IS NULL OR NEW.service_date < (now() AT TIME ZONE public.schedule_guard_timezone())::date THEN
    RETURN NEW;
  END IF;

  -- Only re-check when the scheduling facts actually moved.
  v_changed := TG_OP = 'INSERT'
    OR OLD.cleaner_id IS DISTINCT FROM NEW.cleaner_id
    OR OLD.service_date IS DISTINCT FROM NEW.service_date
    OR OLD.time_slot IS DISTINCT FROM NEW.time_slot
    OR OLD.arrival_window IS DISTINCT FROM NEW.arrival_window
    OR OLD.service_type IS DISTINCT FROM NEW.service_type
    OR OLD.home_size_id IS DISTINCT FROM NEW.home_size_id
    OR OLD.condition_level IS DISTINCT FROM NEW.condition_level;
  IF NOT v_changed THEN RETURN NEW; END IF;

  v_result := public.evaluate_schedule_buffer(
    NEW.id, ARRAY[NEW.cleaner_id], NEW.service_date,
    COALESCE(NEW.time_slot, NEW.arrival_window), NEW.service_type,
    NEW.home_size_id, NEW.condition_level
  );
  IF COALESCE((v_result ->> 'ok')::boolean, true) THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.schedule_buffer_overrides o
    WHERE o.booking_id = NEW.id AND o.active
      AND (o.cleaner_id IS NULL OR o.cleaner_id = NEW.cleaner_id)
  ) INTO v_overridden;
  IF v_overridden THEN RETURN NEW; END IF;

  v_conflict := v_result -> 'conflicts' -> 0;
  PERFORM public.raise_buffer_conflict(v_result || jsonb_build_object(
    'booking_id', NEW.id,
    'cleaner_id', NEW.cleaner_id,
    'conflicting_booking_id', v_conflict ->> 'booking_id'
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_buffer_on_booking_trg ON public.bookings;
CREATE TRIGGER enforce_buffer_on_booking_trg
  BEFORE INSERT OR UPDATE OF cleaner_id, service_date, time_slot, arrival_window,
                             service_type, home_size_id, condition_level
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_buffer_on_booking();

-- A heavy-condition scope adjustment is a measurement of the property: fold it
-- into the projection so the next visit (and every buffer around this one) is
-- sized off what the crew actually found.
CREATE OR REPLACE FUNCTION public.apply_condition_from_scope_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reason_codes && ARRAY['heavy_condition','post_event'] THEN
    UPDATE public.bookings
      SET condition_level = 'heavy'
      WHERE id = NEW.booking_id AND condition_level IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_condition_from_scope_adjustment_trg ON public.scope_adjustments;
CREATE TRIGGER apply_condition_from_scope_adjustment_trg
  AFTER INSERT ON public.scope_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.apply_condition_from_scope_adjustment();

-- Overrides are ops-visible the moment they happen: same events → Discord
-- pipeline every other dispatch decision uses.
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('booking.buffer_override', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
