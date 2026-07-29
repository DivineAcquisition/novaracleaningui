-- ─── Backup coverage + no-show handling ─────────────────────────────────────
--
-- We lost $160 to a cleaner who simply never arrived: nobody noticed, nobody
-- was told, and there was no bench to pull from. The schedule guard
-- (20260728200000 / 20260728200100) already measures the day and drafts the
-- customer heads-up. This closes the two remaining holes.
--
-- CONTACT BEFORE CONCLUSION. Most "no-shows" are a dead phone or a bad
-- morning, so nothing is declared until we have tried to reach the person:
--
--     +10 min  automatic nudge to the cleaner (SMS + push)
--     +15 min  VA alerted with one-tap call/text links; job marked at risk
--     +30 min  declared a no-show — full response fires
--
-- A cleaner who answers with a real ETA at any point moves the job to RUNNING
-- LATE, not a no-show. Late with communication is a service hiccup;
-- unreachable is an operational failure, and the two must never be recorded
-- as the same thing.
--
-- COVERAGE IS OFFERED, NOT ASSUMED. A coverage request snapshots the ranked
-- candidates (designated backups first, then Novara Score / zone / slack) and
-- offers the job with a short accept window. No answer or a decline rolls to
-- the next candidate automatically. Admin can offer the top N at once, or
-- direct-assign for a tight window — logged with its reason either way.
-- Declining a backup offer is explicitly NOT a reliability penalty; only
-- accepting and then abandoning is.
--
-- WHEN NOBODY CAN COVER, that is OUR failure, not the cleaner's. The job is
-- marked uncovered, the reschedule + goodwill path opens, admin is woken
-- regardless of the hour, and the event is logged distinctly so a pattern
-- reads as a bench-depth problem instead of a cleaner problem.
--
-- Nothing here decides a consequence for anyone. The no-show QC case still
-- opens automatically and a human still works the accountability ladder, and
-- pay for work already completed is never touched.
--
-- Reuses: bookings/jobs/job_assignments (dispatch), cleaners.novara_score +
-- constraints + availability, cleaner_schedule_exceptions, qc_issues +
-- qc_issue_events (the ladder), customer_credits (goodwill), events +
-- discord_routes (VA/admin alerting), app_settings, pg_cron + pg_net.

-- ─── 1. Tunables ────────────────────────────────────────────────────────────
-- Merged over the stored row by schedule_guard_settings(), so an existing
-- settings row keeps working and simply gains the new defaults.

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
    -- Contact before conclusion: nudge the cleaner, then the VA, then declare.
    'cleaner_nudge_minutes',             10,
    'late_start_minutes',                15,
    'no_show_minutes',                   30,
    'overrun_grace_minutes',             10,
    'field_flag_overrun_minutes',        45,
    'risk_ack_escalate_minutes',         20,
    'customer_message_escalate_minutes', 20,
    'auto_send_initial_heads_up',        false,
    -- Coverage.
    'coverage_auto_source',              true,
    'coverage_offer_window_minutes',     10,
    'coverage_simultaneous_offers',      1,
    'coverage_max_rounds',               4,
    'coverage_give_up_minutes',          45,
    'coverage_urgent_within_minutes',    60,
    'str_checkin_time',                  '16:00',
    'goodwill_credit_cents',             2500,
    'short_notice_cancel_hours',         24,
    'condition_multipliers',             jsonb_build_object('light', 0.9, 'normal', 1.0, 'heavy', 1.25, 'severe', 1.5),
    'variance_min_samples',              5
  );
$$;

UPDATE public.app_settings
  SET description =
        'Schedule buffer, delay-cascade and coverage config. buffer_minutes: required gap between a crew''s '
        'consecutive jobs (travel added when both addresses are geocoded). cleaner_nudge_minutes / '
        'late_start_minutes / no_show_minutes: the escalating detection ladder — automatic nudge to the '
        'cleaner, then the VA alert with the job marked at risk, then the no-show declaration. A cleaner who '
        'replies with an ETA becomes RUNNING LATE and is never declared a no-show. coverage_*: the offer '
        'cycle — accept window, how many candidates are offered at once, how many rounds before the job is '
        'marked uncovered, and the window inside which admin may direct-assign. goodwill_credit_cents: the '
        'margin-funded gesture on an uncovered job (cleaner pay is never affected). short_notice_cancel_hours: '
        'notice below which a cleaner-initiated cancellation counts as short notice.',
      updated_at = now()
  WHERE key = 'schedule_guard_settings';

-- ─── 2. The detection trail on a delay event ────────────────────────────────
-- Who we contacted, when, and what they said back. Without this the +30
-- declaration is an assertion; with it, it's evidence — and it's the timeline
-- that gets attached to the QC case.

ALTER TABLE public.schedule_delay_events
  ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudge_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS va_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_declared_at timestamptz,
  -- The cleaner answered. An ETA here is the difference between "running
  -- late" and "no-show", so it is recorded with how it reached us.
  ADD COLUMN IF NOT EXISTS cleaner_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleaner_eta_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleaner_response_note text,
  ADD COLUMN IF NOT EXISTS cleaner_response_via text
    CHECK (cleaner_response_via IS NULL
           OR cleaner_response_via IN ('link','sms','call','portal','admin','app')),
  -- Tokenized "I'm on my way — here's my ETA" link, texted with the nudge so
  -- answering costs one tap and no login.
  ADD COLUMN IF NOT EXISTS response_token text,
  -- Cleaner-initiated cancellation: how much notice we actually got. The whole
  -- point of recording it is to make "tell us early" visibly better.
  ADD COLUMN IF NOT EXISTS notice_minutes integer,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS reported_by uuid,
  ADD COLUMN IF NOT EXISTS reported_by_name text;

CREATE UNIQUE INDEX IF NOT EXISTS sde_response_token_idx
  ON public.schedule_delay_events (response_token) WHERE response_token IS NOT NULL;

-- A cleaner telling us in advance is a different event from a cleaner
-- vanishing, and the data model has to say so.
DO $$
BEGIN
  ALTER TABLE public.schedule_delay_events DROP CONSTRAINT IF EXISTS schedule_delay_events_event_type_check;
  ALTER TABLE public.schedule_delay_events
    ADD CONSTRAINT schedule_delay_events_event_type_check
    CHECK (event_type IN ('late_start','overrun','field_flag','no_show','cleaner_cancellation'));
END$$;

COMMENT ON COLUMN public.schedule_delay_events.cleaner_eta_at IS
  'The ETA the cleaner gave us. Present = the job is RUNNING LATE and will never be declared a no-show: late with communication is a service hiccup, unreachable is an operational failure.';
COMMENT ON COLUMN public.schedule_delay_events.notice_minutes IS
  'Minutes of advance notice on a cleaner-initiated cancellation. Recorded so early notice can be seen to cost less than silence.';

-- ─── 3. Hard deadlines (STR turnovers are the least forgiving) ──────────────
-- A guest checking in at 4pm is not a preference. Where a booking carries a
-- deadline the coverage flow treats it as urgent and skips the offer cycle.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS hard_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS running_late_eta_at timestamptz;

COMMENT ON COLUMN public.bookings.hard_deadline_at IS
  'Immovable finish deadline (STR guest check-in, event start). Coverage for a booking with a deadline inside the urgent window skips the offer cycle in favour of direct assignment.';
COMMENT ON COLUMN public.bookings.running_late_eta_at IS
  'The ETA the assigned cleaner actually gave us. Present = running late (a service hiccup we can communicate), which is deliberately not the same record as a no-show (unreachable).';

/** Is this booking an STR turnover, from either source of truth? */
CREATE OR REPLACE FUNCTION public.booking_is_str_turnover(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT public.booking_client_type(b.booking_type, b.partner_details) = 'str'
       FROM public.bookings b WHERE b.id = p_booking_id),
    false
  );
$$;

/**
 * The moment this job must be finished by, or NULL when nothing is riding on
 * it. An explicit hard_deadline_at always wins; STR turnovers otherwise fall
 * back to the configured guest check-in time on the service date.
 */
CREATE OR REPLACE FUNCTION public.booking_hard_deadline(p_booking_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_b record;
  v_time time;
BEGIN
  SELECT id, service_date, hard_deadline_at INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF v_b.id IS NULL THEN RETURN NULL; END IF;
  IF v_b.hard_deadline_at IS NOT NULL THEN RETURN v_b.hard_deadline_at; END IF;
  IF v_b.service_date IS NULL OR NOT public.booking_is_str_turnover(p_booking_id) THEN RETURN NULL; END IF;

  BEGIN
    v_time := COALESCE(NULLIF(public.schedule_guard_settings() ->> 'str_checkin_time', ''), '16:00')::time;
  EXCEPTION WHEN OTHERS THEN
    v_time := time '16:00';
  END;

  RETURN (v_b.service_date + v_time) AT TIME ZONE public.schedule_guard_timezone();
END;
$$;

-- ─── 4. Coverage requests ───────────────────────────────────────────────────
-- One row per "this job needs somebody else", whatever caused it. It carries
-- the ranked candidate snapshot taken at the moment coverage was needed, so
-- the record shows who was actually available then — not who happens to be
-- available when someone reads the log a week later.

CREATE TABLE IF NOT EXISTS public.coverage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  delay_event_id uuid REFERENCES public.schedule_delay_events(id) ON DELETE SET NULL,
  risk_flag_id uuid REFERENCES public.booking_risk_flags(id) ON DELETE SET NULL,
  -- What put the job here. A cancellation with notice and a silent no-show
  -- both need coverage; they are not the same event.
  trigger text NOT NULL CHECK (trigger IN ('no_show','cleaner_cancellation','cascade_risk','admin')),
  trigger_detail text,
  from_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  from_cleaner_name text,
  status text NOT NULL DEFAULT 'sourcing'
    CHECK (status IN ('sourcing','offered','covered','uncovered','cancelled')),
  -- 'sequential' rolls one candidate at a time; 'simultaneous' offers the top
  -- N and the first accept wins; 'direct' skipped the cycle entirely.
  mode text NOT NULL DEFAULT 'sequential'
    CHECK (mode IN ('sequential','simultaneous','direct')),
  offer_window_minutes integer NOT NULL DEFAULT 10 CHECK (offer_window_minutes BETWEEN 1 AND 240),
  offers_per_round integer NOT NULL DEFAULT 1 CHECK (offers_per_round BETWEEN 1 AND 10),
  max_rounds integer NOT NULL DEFAULT 4 CHECK (max_rounds BETWEEN 1 AND 20),
  round integer NOT NULL DEFAULT 0,
  -- Tight window: an STR turnover before check-in, or a job starting within
  -- the hour. Urgent requests may be direct-assigned without an offer cycle.
  is_urgent boolean NOT NULL DEFAULT false,
  urgency_reason text,
  is_str_turnover boolean NOT NULL DEFAULT false,
  hard_deadline_at timestamptz,
  scheduled_start_at timestamptz,
  -- The ranked list as it stood when coverage was needed, reasons included.
  candidates_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_count integer NOT NULL DEFAULT 0,
  -- Past this, an unaccepted job is uncovered and the customer conversation
  -- changes from "new ETA" to "reschedule".
  give_up_at timestamptz,
  covered_by_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  covered_by_name text,
  covered_at timestamptz,
  covered_via text CHECK (covered_via IS NULL OR covered_via IN ('offer_accepted','direct_assign','manual')),
  was_designated_backup boolean NOT NULL DEFAULT false,
  uncovered_at timestamptz,
  uncovered_reason text,
  -- Margin-funded service recovery. Never a deduction from cleaner pay.
  goodwill_credit_cents integer NOT NULL DEFAULT 0 CHECK (goodwill_credit_cents >= 0),
  goodwill_applied_at timestamptz,
  goodwill_applied_by uuid,
  goodwill_credit_id uuid REFERENCES public.customer_credits(id) ON DELETE SET NULL,
  reschedule_offered_at timestamptz,
  opened_by uuid,
  opened_by_name text,
  closed_by uuid,
  closed_by_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live coverage request per booking: two parallel searches would race
-- each other into a double assignment.
CREATE UNIQUE INDEX IF NOT EXISTS cvr_open_unique_idx
  ON public.coverage_requests (booking_id)
  WHERE status IN ('sourcing','offered');
CREATE INDEX IF NOT EXISTS cvr_status_idx ON public.coverage_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS cvr_booking_idx ON public.coverage_requests (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cvr_uncovered_idx
  ON public.coverage_requests (uncovered_at DESC) WHERE uncovered_at IS NOT NULL;

ALTER TABLE public.coverage_requests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_coverage_requests ON public.coverage_requests;
CREATE TRIGGER set_timestamp_coverage_requests
  BEFORE UPDATE ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.coverage_requests IS
  'One coverage search per job that lost its cleaner. Carries what triggered it, the ranked candidate snapshot taken at that moment, the offer cycle configuration, and how it ended — covered by whom, or uncovered (a bench-depth signal, logged distinctly from any cleaner failure).';

-- ─── 5. Coverage offers ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coverage_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_request_id uuid NOT NULL REFERENCES public.coverage_requests(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  cleaner_name text,
  cleaner_phone text,
  -- Where they sat in the ranked list, and why — so the record shows the
  -- dispatcher was choosing with context rather than guessing.
  rank_position integer NOT NULL DEFAULT 1,
  rank_reason text,
  round integer NOT NULL DEFAULT 1,
  was_designated_backup boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered','accepted','declined','expired','withdrawn','failed')),
  response_token text NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  decline_reason text,
  notified_via text[] NOT NULL DEFAULT '{}',
  notify_error text,
  -- Declining a backup offer is not a reliability penalty. Only accepting and
  -- then abandoning the job is, and that lands as a no-show, not here. This
  -- column exists so the rule is enforced by the data, not by remembering it.
  counts_against_reliability boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cvo_live_unique_idx
  ON public.coverage_offers (coverage_request_id, cleaner_id)
  WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS cvo_request_idx ON public.coverage_offers (coverage_request_id, rank_position);
CREATE INDEX IF NOT EXISTS cvo_open_idx ON public.coverage_offers (status, expires_at) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS cvo_cleaner_idx ON public.coverage_offers (cleaner_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cvo_token_idx ON public.coverage_offers (response_token);

ALTER TABLE public.coverage_offers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_coverage_offers ON public.coverage_offers;
CREATE TRIGGER set_timestamp_coverage_offers
  BEFORE UPDATE ON public.coverage_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON COLUMN public.coverage_offers.counts_against_reliability IS
  'Always false for a coverage offer. Declining backup cover is behaviour we asked for and must never cost a cleaner their score; only accepting and then abandoning a job does, and that is recorded as a no-show.';

-- ─── 6. The outbound queue ──────────────────────────────────────────────────
-- Postgres decides WHO to contact and WHAT to say (it holds the clock, the
-- thresholds and the ranking); the coverage-runner Edge Function sends it
-- through the SMS/push channels that already exist. Queueing rather than
-- firing inline means a transient Twilio/GHL failure is a retry, not a
-- silently skipped nudge — and every nudge, offer and alert is on the record.

CREATE TABLE IF NOT EXISTS public.coverage_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  coverage_request_id uuid REFERENCES public.coverage_requests(id) ON DELETE CASCADE,
  coverage_offer_id uuid REFERENCES public.coverage_offers(id) ON DELETE CASCADE,
  delay_event_id uuid REFERENCES public.schedule_delay_events(id) ON DELETE CASCADE,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  audience text NOT NULL CHECK (audience IN ('cleaner','va','admin')),
  kind text NOT NULL CHECK (kind IN (
    'nudge','va_alert','coverage_offer','offer_withdrawn','offer_expired',
    'coverage_covered','uncovered_alert','cancellation_alert'
  )),
  channels text[] NOT NULL DEFAULT '{sms}',
  to_phone text,
  title text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  sent_via text[],
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cvn_pending_idx
  ON public.coverage_notifications (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS cvn_booking_idx ON public.coverage_notifications (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cvn_cleaner_idx ON public.coverage_notifications (cleaner_id, created_at DESC);

ALTER TABLE public.coverage_notifications ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_coverage_notifications ON public.coverage_notifications;
CREATE TRIGGER set_timestamp_coverage_notifications
  BEFORE UPDATE ON public.coverage_notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 7. RLS: admin/VA read, service role writes ─────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'coverage_requests','coverage_offers','coverage_notifications'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_admin_read') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()))',
        t || '_admin_read', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_service_role') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t || '_service_role', t);
    END IF;
  END LOOP;
END$$;

-- A cleaner may read the offers made to them (their portal lists them) but
-- never anybody else's, and never the ranking behind them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coverage_offers' AND policyname = 'coverage_offers_own_read') THEN
    CREATE POLICY coverage_offers_own_read ON public.coverage_offers FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.cleaners c
        WHERE c.id = coverage_offers.cleaner_id AND c.user_id = auth.uid()
      ));
  END IF;
END$$;

-- ─── 8. Stated availability windows are absolute ────────────────────────────

/**
 * The window a cleaner has actually told us they work on a given date, and
 * whether they work it at all.
 *
 * Sources, all of them the cleaner's own statement:
 *   * cleaner_schedule_exceptions — a day off, sick day or vacation blocks the
 *     whole day; a 'custom' exception with times blocks only those hours;
 *   * cleaners.constraints — the hard cutoffs ("nothing after 3pm");
 *   * cleaners.weekly_schedule — a per-weekday window where one is recorded;
 *   * cleaners.preferred_work_days — the days they work at all.
 *
 * Returns { available, start, end, blocked_start, blocked_end, note }. This is
 * a FILTER, not a ranking input: a cleaner whose day ends before the job would
 * finish is never suggested, however good their score.
 */
CREATE OR REPLACE FUNCTION public.cleaner_stated_window(p_cleaner_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c record;
  v_exc record;
  v_weekday_full text;
  v_weekday_abbr text;
  v_start time := NULL;
  v_end time := NULL;
  v_blocked_start time := NULL;
  v_blocked_end time := NULL;
  v_notes text[] := '{}';
  v_day jsonb;
  v_key text;
  v_raw text;
BEGIN
  SELECT id, status, approved, available_for_bookings, preferred_work_days, constraints, weekly_schedule
    INTO v_c
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF v_c.id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'note', 'Not in the directory.');
  END IF;

  IF v_c.status <> 'active' OR NOT COALESCE(v_c.approved, false)
     OR NOT COALESCE(v_c.available_for_bookings, true) THEN
    RETURN jsonb_build_object('available', false, 'note', 'Not currently taking work.');
  END IF;

  v_weekday_full := lower(btrim(to_char(p_date, 'FMDay')));
  v_weekday_abbr := left(v_weekday_full, 3);

  -- A day they don't work.
  IF v_c.preferred_work_days IS NOT NULL AND cardinality(v_c.preferred_work_days) > 0
     AND NOT EXISTS (
       SELECT 1 FROM unnest(v_c.preferred_work_days) d
       WHERE lower(left(btrim(d), 3)) = v_weekday_abbr
     ) THEN
    RETURN jsonb_build_object('available', false,
      'note', format('Doesn''t work %ss.', initcap(v_weekday_full)));
  END IF;

  -- A logged day off. Times present mean only those hours are blocked.
  SELECT * INTO v_exc FROM public.cleaner_schedule_exceptions
    WHERE cleaner_id = p_cleaner_id AND exception_date = p_date;
  IF v_exc.id IS NOT NULL THEN
    IF v_exc.type IN ('day_off','sick','vacation') OR v_exc.start_time IS NULL THEN
      RETURN jsonb_build_object('available', false,
        'note', format('Off that day (%s).', replace(v_exc.type, '_', ' ')));
    END IF;
    v_blocked_start := v_exc.start_time;
    v_blocked_end := COALESCE(v_exc.end_time, time '23:59');
    v_notes := v_notes || format('unavailable %s–%s',
      to_char(v_blocked_start, 'FMHH12:MI AM'), to_char(v_blocked_end, 'FMHH12:MI AM'));
  END IF;

  -- Their stated weekly window, when they've recorded one. Tolerant of the
  -- shapes this jsonb has been written in, and silent when it holds none.
  IF jsonb_typeof(COALESCE(v_c.weekly_schedule, 'null'::jsonb)) = 'object' THEN
    FOREACH v_key IN ARRAY ARRAY[v_weekday_full, v_weekday_abbr, initcap(v_weekday_full)] LOOP
      IF v_c.weekly_schedule ? v_key THEN
        v_day := v_c.weekly_schedule -> v_key;
        EXIT;
      END IF;
    END LOOP;

    IF v_day IS NOT NULL THEN
      IF jsonb_typeof(v_day) = 'boolean' AND v_day::text = 'false' THEN
        RETURN jsonb_build_object('available', false,
          'note', format('Doesn''t work %ss.', initcap(v_weekday_full)));
      END IF;
      IF jsonb_typeof(v_day) = 'object' THEN
        BEGIN
          v_raw := COALESCE(v_day ->> 'start', v_day ->> 'start_time', v_day ->> 'from');
          IF NULLIF(btrim(COALESCE(v_raw, '')), '') IS NOT NULL THEN v_start := v_raw::time; END IF;
          v_raw := COALESCE(v_day ->> 'end', v_day ->> 'end_time', v_day ->> 'to');
          IF NULLIF(btrim(COALESCE(v_raw, '')), '') IS NOT NULL THEN v_end := v_raw::time; END IF;
        EXCEPTION WHEN OTHERS THEN
          -- An unparseable entry must not silently narrow their day.
          v_start := NULL;
          v_end := NULL;
        END;
      END IF;
    END IF;
  END IF;

  -- The hard cutoffs win over everything: they are the sentence the cleaner
  -- actually said out loud.
  BEGIN
    IF NULLIF(v_c.constraints ->> 'no_work_before', '') IS NOT NULL THEN
      v_start := GREATEST(COALESCE(v_start, time '00:00'), (v_c.constraints ->> 'no_work_before')::time);
      v_notes := v_notes || format('nothing before %s',
        to_char((v_c.constraints ->> 'no_work_before')::time, 'FMHH12:MI AM'));
    END IF;
    IF NULLIF(v_c.constraints ->> 'no_work_after', '') IS NOT NULL THEN
      v_end := LEAST(COALESCE(v_end, time '23:59'), (v_c.constraints ->> 'no_work_after')::time);
      v_notes := v_notes || format('nothing after %s',
        to_char((v_c.constraints ->> 'no_work_after')::time, 'FMHH12:MI AM'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    /* a malformed constraint must not widen their day either — leave as is */
  END;

  RETURN jsonb_build_object(
    'available', true,
    'start', v_start,
    'end', v_end,
    'blocked_start', v_blocked_start,
    'blocked_end', v_blocked_end,
    'note', NULLIF(array_to_string(v_notes, ', '), '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleaner_stated_window(uuid, date) TO authenticated, service_role;

/** Does [p_start, p_end] fit entirely inside what this cleaner said they work? */
CREATE OR REPLACE FUNCTION public.cleaner_window_covers(
  p_window jsonb,
  p_start time,
  p_end time
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((p_window ->> 'available')::boolean, false)
    AND (NULLIF(p_window ->> 'start', '') IS NULL OR p_start >= (p_window ->> 'start')::time)
    -- A job that runs past midnight can never sit inside a stated day window.
    AND (p_end >= p_start)
    AND (NULLIF(p_window ->> 'end', '') IS NULL OR p_end <= (p_window ->> 'end')::time)
    AND (
      NULLIF(p_window ->> 'blocked_start', '') IS NULL
      OR p_end <= (p_window ->> 'blocked_start')::time
      OR p_start >= (p_window ->> 'blocked_end')::time
    );
$$;

-- ─── 9. Ranked coverage candidates, with the reason attached ─────────────────

DROP FUNCTION IF EXISTS public.suggest_coverage_cleaners(uuid, integer);

/**
 * Who can cover this booking?
 *
 * Designated backups for the day come first. Everyone else is ranked by
 * Novara Score, zone fit, and how much slack their day actually has.
 *
 * HARD filters — excluded, never merely ranked lower, no matter the score:
 *   * not active / not approved / not taking work / suspended
 *   * a day off, sick day or vacation on that date
 *   * a day they don't work, or hours outside the window they stated
 *   * stated cutoffs: "nothing after 3pm" never sees a job that ends at 4
 *   * outside their zips and beyond their travel radius
 *   * already at their max jobs for the day
 *
 * A candidate whose own day leaves no buffer IS still listed — ops sometimes
 * has no better option — but ranked last and clearly marked, so fixing one
 * cascade never quietly starts another.
 *
 * Every row carries rank_reason: the sentence a dispatcher reads instead of
 * guessing why somebody is third.
 */
CREATE OR REPLACE FUNCTION public.suggest_coverage_cleaners(
  p_booking_id uuid,
  p_limit integer DEFAULT 8
)
RETURNS TABLE (
  cleaner_id uuid,
  name text,
  phone text,
  email text,
  is_designated_backup boolean,
  backup_priority integer,
  novara_score numeric,
  overall_score numeric,
  distance_miles numeric,
  zone_fit text,
  jobs_that_day integer,
  slack_minutes integer,
  buffer_ok boolean,
  buffer_note text,
  availability_note text,
  rank_reason text,
  rank_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := public.schedule_guard_timezone();
  v_b record;
  v_start timestamptz;
  v_end timestamptz;
  v_start_local time;
  v_end_local time;
  v_current uuid[];
BEGIN
  SELECT * INTO v_b FROM public.booking_projection_v1 WHERE booking_id = p_booking_id;
  IF v_b.booking_id IS NULL THEN RETURN; END IF;

  v_start := v_b.scheduled_start_at;
  IF v_start IS NULL THEN RETURN; END IF;
  -- Coverage has to FINISH the job, not just start it, so availability is
  -- tested against the projected end. That is what makes "nothing after 3pm"
  -- exclude a 1pm deep clean rather than merely rank it lower.
  v_end := COALESCE(v_b.projected_end_at, v_start + interval '3 hours');
  v_start_local := (v_start AT TIME ZONE v_tz)::time;
  v_end_local := (v_end AT TIME ZONE v_tz)::time;
  v_current := public.booking_crew_ids(p_booking_id);

  RETURN QUERY
  WITH candidates AS (
    SELECT
      c.id,
      TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cname,
      c.phone, c.email, c.novara_score, c.overall_score, c.home_lat, c.home_lng,
      c.home_zip, c.service_zip_codes, c.max_travel_miles, c.max_jobs_per_day,
      bk.id AS backup_id, bk.priority AS backup_priority, bk.zips AS backup_zips,
      public.geo_distance_miles(c.home_lat, c.home_lng, v_b.lat, v_b.lng) AS miles,
      public.cleaner_stated_window(c.id, v_b.service_date) AS stated_window
    FROM public.cleaners c
    LEFT JOIN public.daily_backup_cleaners bk
      ON bk.cleaner_id = c.id AND bk.on_call_date = v_b.service_date AND bk.active
    WHERE c.status = 'active'
      AND COALESCE(c.approved, false)
      AND COALESCE(c.available_for_bookings, true)
      AND NOT (c.id = ANY (v_current))
      -- Their zone: a covered zip, their home zip, or inside their radius.
      AND (
        v_b.zip_code = ANY (COALESCE(c.service_zip_codes, '{}'::text[]))
        OR c.home_zip = v_b.zip_code
        OR (
          public.geo_distance_miles(c.home_lat, c.home_lng, v_b.lat, v_b.lng) IS NOT NULL
          AND public.geo_distance_miles(c.home_lat, c.home_lng, v_b.lat, v_b.lng)
              <= COALESCE(c.max_travel_miles, 25)
        )
      )
  ),
  -- Availability is settled HERE, before any scoring touches the row. A
  -- candidate outside their stated window or zone is gone from the list, not
  -- sitting at the bottom of it waiting to be picked in a panic.
  within_window AS (
    SELECT * FROM candidates cd
    WHERE public.cleaner_window_covers(cd.stated_window, v_start_local, v_end_local)
  ),
  loaded AS (
    SELECT
      av.*,
      (SELECT count(*)::int
         FROM public.booking_projection_v1 p
        WHERE p.service_date = v_b.service_date
          AND p.booking_id <> p_booking_id
          AND public.schedule_live_booking_status(p.status)
          AND av.id = ANY (public.booking_crew_ids(p.booking_id))) AS day_jobs,
      (SELECT MIN(
                CASE WHEN p.scheduled_start_at <= v_start
                  THEN FLOOR(EXTRACT(EPOCH FROM (v_start - p.projected_end_at)) / 60)::int
                  ELSE FLOOR(EXTRACT(EPOCH FROM (p.scheduled_start_at - v_end)) / 60)::int
                END)
         FROM public.booking_projection_v1 p
        WHERE p.service_date = v_b.service_date
          AND p.booking_id <> p_booking_id
          AND p.scheduled_start_at IS NOT NULL
          AND public.schedule_live_booking_status(p.status)
          AND av.id = ANY (public.booking_crew_ids(p.booking_id))) AS nearest_gap
    FROM within_window av
  ),
  eligible AS (
    SELECT
      l.*,
      LEAST(COALESCE(l.nearest_gap, 480), 480) AS slack,
      COALESCE((public.evaluate_schedule_buffer(p_booking_id, ARRAY[l.id]) ->> 'ok')::boolean, true) AS ok_buffer,
      CASE
        WHEN v_b.zip_code = ANY (COALESCE(l.service_zip_codes, '{}'::text[])) THEN 'covers zip'
        WHEN l.home_zip = v_b.zip_code THEN 'home zip'
        ELSE 'within radius'
      END AS fit
    FROM loaded l
    WHERE l.day_jobs < COALESCE(l.max_jobs_per_day, 3)
  ),
  scored AS (
    -- Novara Score carries the ranking; zone fit and real schedule slack
    -- adjust it; distance, an already-full day, and no buffer room push a
    -- candidate down. Designated backups sort ahead of all of it.
    SELECT
      e.*,
      ROUND(
        COALESCE(e.novara_score, 60) * 0.5
        + COALESCE(e.overall_score, e.novara_score, 60) * 0.2
        + CASE e.fit WHEN 'covers zip' THEN 12 WHEN 'home zip' THEN 10 ELSE 0 END
        + LEAST(15, e.slack / 30.0)
        - LEAST(20, COALESCE(e.miles, 10) * 0.5)
        - e.day_jobs * 3
        - CASE WHEN e.ok_buffer THEN 0 ELSE 40 END
      , 2) AS rank
    FROM eligible e
  )
  SELECT
    s.id,
    NULLIF(s.cname, ''),
    s.phone,
    s.email,
    s.backup_id IS NOT NULL,
    s.backup_priority,
    s.novara_score,
    s.overall_score,
    s.miles,
    s.fit,
    s.day_jobs,
    s.slack,
    s.ok_buffer,
    CASE WHEN s.ok_buffer THEN NULL
         ELSE 'Their own day has no room for this — assigning here needs a logged buffer override.' END,
    NULLIF(s.stated_window ->> 'note', ''),
    -- The sentence a dispatcher reads instead of guessing.
    concat_ws(' · ',
      CASE WHEN s.backup_id IS NOT NULL
        THEN format('On call for %s (#%s)', v_b.service_date, COALESCE(s.backup_priority, 100)) END,
      format('Novara %s', COALESCE(round(s.novara_score)::text, 'unscored')),
      CASE s.fit
        WHEN 'covers zip' THEN format('covers %s', v_b.zip_code)
        WHEN 'home zip' THEN format('based in %s', v_b.zip_code)
        ELSE format('%s mi away', COALESCE(round(s.miles, 1)::text, '?')) END,
      CASE WHEN s.day_jobs = 0 THEN 'day is clear'
           ELSE format('%s other job%s that day, %s min of slack',
                       s.day_jobs, CASE WHEN s.day_jobs = 1 THEN '' ELSE 's' END, s.slack) END,
      CASE WHEN s.ok_buffer THEN NULL ELSE 'no buffer room — override needed' END
    ),
    s.rank
  FROM scored s
  ORDER BY
    (s.backup_id IS NOT NULL) DESC,
    s.backup_priority NULLS LAST,
    s.ok_buffer DESC,
    s.rank DESC
  LIMIT GREATEST(1, COALESCE(p_limit, 8));
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_coverage_cleaners(uuid, integer) TO authenticated, service_role;

-- ─── 10. Opening a coverage request ─────────────────────────────────────────

/**
 * Start the search for somebody to cover this job.
 *
 * Snapshots the ranked candidates as they stand right now, works out whether
 * the window is tight enough to justify skipping the offer cycle (an STR
 * turnover before check-in, or a job starting within the hour), and sets the
 * point past which an unaccepted job is UNCOVERED rather than still pending.
 *
 * Idempotent: a booking already being covered returns the live request.
 */
CREATE OR REPLACE FUNCTION public.open_coverage_request(
  p_booking_id uuid,
  p_trigger text,
  p_delay_event_id uuid DEFAULT NULL,
  p_risk_flag_id uuid DEFAULT NULL,
  p_actor uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_trigger_detail text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.schedule_guard_settings();
  v_tz text := public.schedule_guard_timezone();
  v_b record;
  v_existing uuid;
  v_id uuid;
  v_crew uuid[];
  v_from uuid;
  v_from_name text;
  v_snapshot jsonb := '[]'::jsonb;
  v_count int := 0;
  v_deadline timestamptz;
  v_is_str boolean;
  v_urgent boolean := false;
  v_urgency text;
  v_give_up_at timestamptz;
  v_window int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'coverage_offer_window_minutes', '')::int, 10));
  v_per_round int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'coverage_simultaneous_offers', '')::int, 1));
  v_rounds int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'coverage_max_rounds', '')::int, 4));
  v_give_up int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'coverage_give_up_minutes', '')::int, 45));
  v_urgent_within int := GREATEST(0, COALESCE(NULLIF(v_cfg ->> 'coverage_urgent_within_minutes', '')::int, 60));
BEGIN
  SELECT * INTO v_b FROM public.booking_projection_v1 WHERE booking_id = p_booking_id;
  IF v_b.booking_id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.coverage_requests
    WHERE booking_id = p_booking_id AND status IN ('sourcing','offered')
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    -- Link the newer cause onto the live search rather than opening a second.
    UPDATE public.coverage_requests
      SET delay_event_id = COALESCE(delay_event_id, p_delay_event_id),
          risk_flag_id = COALESCE(risk_flag_id, p_risk_flag_id),
          updated_at = now()
      WHERE id = v_existing;
    RETURN v_existing;
  END IF;

  v_crew := public.booking_crew_ids(p_booking_id);
  v_from := v_crew[1];
  SELECT NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '')
    INTO v_from_name FROM public.cleaners c WHERE c.id = v_from;

  v_is_str := public.booking_is_str_turnover(p_booking_id);
  v_deadline := public.booking_hard_deadline(p_booking_id);

  -- Tight window → urgent. An STR turnover with a guest arriving is the
  -- least forgiving job we run; a job starting within the hour is the next.
  IF v_deadline IS NOT NULL
     AND v_deadline <= now() + (v_urgent_within || ' minutes')::interval
                       + (COALESCE(v_b.projected_duration_hours, 3) || ' hours')::interval THEN
    v_urgent := true;
    v_urgency := format('Hard deadline %s — %s',
      to_char(v_deadline AT TIME ZONE v_tz, 'FMHH12:MI AM'),
      CASE WHEN v_is_str THEN 'STR turnover before guest check-in' ELSE 'immovable finish time' END);
  ELSIF v_b.scheduled_start_at IS NOT NULL
        AND v_b.scheduled_start_at <= now() + (v_urgent_within || ' minutes')::interval THEN
    v_urgent := true;
    v_urgency := format('Starts %s — inside the %s-minute urgent window',
      to_char(v_b.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'), v_urgent_within);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.ord), '[]'::jsonb), count(*)::int
    INTO v_snapshot, v_count
  FROM (
    SELECT row_number() OVER () AS ord, x.*
    FROM public.suggest_coverage_cleaners(p_booking_id, 12) x
  ) s;

  -- Urgent doesn't mean "stop offering" — it means widen and hurry. Offers
  -- still go out automatically (a dispatcher may be on another call), the
  -- window shortens, and the top few are asked at once so the first accept
  -- wins. Direct assignment stays available on top of all that; it is an
  -- override a person reaches for, not the only path.
  IF v_urgent THEN
    v_window := GREATEST(3, CEIL(v_window / 2.0)::int);
    v_per_round := GREATEST(v_per_round, 3);
  END IF;

  -- When to stop trying. An urgent request gets its fuse measured from the
  -- deadline itself, because that window belongs to a human making a
  -- direct-assign call — but it still burns down, so nothing rots unnoticed.
  v_give_up_at := GREATEST(
    now() + interval '10 minutes',
    CASE WHEN v_urgent
      THEN COALESCE(v_deadline, v_b.scheduled_start_at, now()) + (v_give_up || ' minutes')::interval
      ELSE now() + (v_give_up || ' minutes')::interval
    END
  );

  INSERT INTO public.coverage_requests (
    booking_id, job_id, delay_event_id, risk_flag_id, trigger, trigger_detail,
    from_cleaner_id, from_cleaner_name, status, mode, offer_window_minutes,
    offers_per_round, max_rounds, is_urgent, urgency_reason, is_str_turnover,
    hard_deadline_at, scheduled_start_at, candidates_snapshot, candidate_count,
    give_up_at, opened_by, opened_by_name
  ) VALUES (
    p_booking_id, v_b.job_id, p_delay_event_id, p_risk_flag_id, p_trigger, p_trigger_detail,
    v_from, v_from_name, 'sourcing',
    CASE WHEN v_per_round > 1 THEN 'simultaneous' ELSE 'sequential' END,
    v_window, v_per_round, v_rounds, v_urgent, v_urgency, v_is_str,
    v_deadline, v_b.scheduled_start_at, v_snapshot, v_count,
    v_give_up_at,
    p_actor, p_actor_name
  )
  RETURNING id INTO v_id;

  INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
  VALUES (
    'coverage.requested', p_booking_id, v_b.job_id, v_from, 'coverage',
    format('🛟 Coverage needed on %s (%s)%s — %s candidate%s ranked, designated backups first.%s',
           v_b.booking_ref,
           replace(p_trigger, '_', ' '),
           CASE WHEN v_from_name IS NOT NULL THEN format(', was %s', v_from_name) ELSE '' END,
           v_count, CASE WHEN v_count = 1 THEN '' ELSE 's' END,
           CASE WHEN v_urgent THEN format(' URGENT: %s.', v_urgency) ELSE '' END),
    jsonb_build_object(
      'coverage_request_id', v_id,
      'trigger', p_trigger,
      'candidate_count', v_count,
      'is_urgent', v_urgent,
      'is_str_turnover', v_is_str,
      'hard_deadline_at', v_deadline,
      'from_cleaner_id', v_from
    )
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_coverage_request(uuid, text, uuid, uuid, uuid, text, text)
  TO authenticated, service_role;

-- ─── 11. The offer cycle ────────────────────────────────────────────────────

/**
 * Offer the job to the next candidate(s) with a short accept window.
 *
 * The list is re-ranked live rather than replayed from the snapshot: by the
 * time round three comes around, somebody's day may have changed, and offering
 * a job to a cleaner who can no longer do it wastes the only thing we're short
 * of. Anyone already offered, or who has declined, is skipped.
 *
 * Queues the SMS/push per offer. Returns how many went out.
 */
CREATE OR REPLACE FUNCTION public.issue_coverage_offers(
  p_request_id uuid,
  p_count integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := public.schedule_guard_timezone();
  v_r record;
  v_b record;
  v_want int;
  v_round int;
  v_expires timestamptz;
  v_row record;
  v_offer_id uuid;
  v_token text;
  v_sent int := 0;
  v_pay_label text;
BEGIN
  SELECT * INTO v_r FROM public.coverage_requests WHERE id = p_request_id;
  IF v_r.id IS NULL OR v_r.status NOT IN ('sourcing','offered') THEN RETURN 0; END IF;

  SELECT * INTO v_b FROM public.booking_projection_v1 WHERE booking_id = v_r.booking_id;
  IF v_b.booking_id IS NULL THEN RETURN 0; END IF;

  v_want := GREATEST(1, COALESCE(p_count, v_r.offers_per_round));
  v_round := v_r.round + 1;
  IF v_round > v_r.max_rounds THEN RETURN 0; END IF;
  v_expires := now() + (v_r.offer_window_minutes || ' minutes')::interval;

  -- What the incoming cleaner will earn, quoted in the offer. Coverage is
  -- ordinary work at their ordinary tier: being on call changes nothing about
  -- pay, and nothing about the contractor relationship.
  FOR v_row IN
    SELECT s.*
    FROM public.suggest_coverage_cleaners(v_r.booking_id, 12) s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.coverage_offers o
      WHERE o.coverage_request_id = p_request_id
        AND o.cleaner_id = s.cleaner_id
        AND o.status IN ('offered','declined','accepted','expired')
    )
    LIMIT v_want
  LOOP
    v_token := encode(gen_random_bytes(16), 'hex');

    -- Their ordinary tier rate on ordinary work. Being on call is not paid and
    -- being activated changes nothing about the pay or the relationship, so the
    -- offer quotes the same number any assignment would.
    v_pay_label := NULL;
    SELECT format(' Pay $%s.', to_char(
      ROUND(COALESCE(b.final_charge_cents, b.total_estimate_cents, 0)
            * COALESCE(c.pay_percentage, 35) / 100.0 / 100.0, 2), 'FM999990.00'))
      INTO v_pay_label
    FROM public.bookings b
    CROSS JOIN public.cleaners c
    WHERE b.id = v_r.booking_id AND c.id = v_row.cleaner_id
      AND COALESCE(b.final_charge_cents, b.total_estimate_cents, 0) > 0;

    INSERT INTO public.coverage_offers (
      coverage_request_id, booking_id, cleaner_id, cleaner_name, cleaner_phone,
      rank_position, rank_reason, round, was_designated_backup, response_token, expires_at
    ) VALUES (
      p_request_id, v_r.booking_id, v_row.cleaner_id, v_row.name, v_row.phone,
      COALESCE((SELECT count(*)::int FROM public.coverage_offers WHERE coverage_request_id = p_request_id), 0) + 1,
      v_row.rank_reason, v_round, v_row.is_designated_backup, v_token, v_expires
    )
    RETURNING id INTO v_offer_id;

    INSERT INTO public.coverage_notifications (
      booking_id, coverage_request_id, coverage_offer_id, cleaner_id,
      audience, kind, channels, to_phone, title, body
    ) VALUES (
      v_r.booking_id, p_request_id, v_offer_id, v_row.cleaner_id,
      'cleaner', 'coverage_offer', ARRAY['sms','push'], v_row.phone,
      'Coverage job available',
      format(
        'Novara coverage job: %s, %s%s in %s.%s You have %s min to claim it — first to accept gets it. '
        'Accept: {{ACCEPT_URL}}  Pass: {{DECLINE_URL}}',
        to_char(v_b.scheduled_start_at AT TIME ZONE v_tz, 'FMDy FMMon FMDD, FMHH12:MI AM'),
        COALESCE(replace(v_b.service_type, '_', ' '), 'clean'),
        CASE WHEN v_r.is_str_turnover THEN ' (STR turnover)' ELSE '' END,
        COALESCE(v_b.city, v_b.zip_code, 'the service area'),
        COALESCE(v_pay_label, ''),
        v_r.offer_window_minutes
      )
    );

    v_sent := v_sent + 1;
  END LOOP;

  IF v_sent > 0 THEN
    UPDATE public.coverage_requests
      SET status = 'offered', round = v_round, updated_at = now()
      WHERE id = p_request_id;

    INSERT INTO public.events (event_type, booking_id, job_id, source, summary, data)
    VALUES (
      'coverage.offers_sent', v_r.booking_id, v_r.job_id, 'coverage',
      format('📨 %s coverage offer%s out on %s (round %s, %s-min window). No answer rolls to the next candidate automatically.',
             v_sent, CASE WHEN v_sent = 1 THEN '' ELSE 's' END, v_b.booking_ref, v_round, v_r.offer_window_minutes),
      jsonb_build_object('coverage_request_id', p_request_id, 'round', v_round, 'count', v_sent)
    );
  END IF;

  RETURN v_sent;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_coverage_offers(uuid, integer) TO authenticated, service_role;

/**
 * A cleaner taps accept. Claims the job atomically — first accept wins, the
 * others are withdrawn — but does NOT perform the assignment: the caller
 * (coverage-respond) runs the canonical assign path so the incoming cleaner
 * gets the complete job, and calls release_coverage_claim if that fails.
 */
CREATE OR REPLACE FUNCTION public.claim_coverage_offer(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_o record;
  v_r record;
  v_withdrawn int := 0;
BEGIN
  SELECT * INTO v_o FROM public.coverage_offers WHERE response_token = p_token FOR UPDATE;
  IF v_o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'That link isn''t valid.');
  END IF;

  SELECT * INTO v_r FROM public.coverage_requests WHERE id = v_o.coverage_request_id FOR UPDATE;

  IF v_o.status = 'accepted' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_yours', 'offerId', v_o.id,
                              'bookingId', v_o.booking_id, 'cleanerId', v_o.cleaner_id,
                              'coverageRequestId', v_o.coverage_request_id);
  END IF;
  IF v_o.status <> 'offered' THEN
    RETURN jsonb_build_object('ok', false, 'code', v_o.status,
                              'error', CASE v_o.status
                                WHEN 'declined' THEN 'You already passed on this one.'
                                WHEN 'expired' THEN 'That offer window has closed.'
                                ELSE 'This job has already been covered.' END);
  END IF;
  IF v_o.expires_at <= now() THEN
    UPDATE public.coverage_offers SET status = 'expired', responded_at = now() WHERE id = v_o.id;
    RETURN jsonb_build_object('ok', false, 'code', 'expired', 'error', 'That offer window has closed.');
  END IF;
  IF v_r.status NOT IN ('sourcing','offered') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'closed',
                              'error', 'This job has already been covered.');
  END IF;

  UPDATE public.coverage_offers
    SET status = 'accepted', responded_at = now() WHERE id = v_o.id;

  -- Simultaneous offers: the moment one accepts, the others stop being live.
  WITH pulled AS (
    UPDATE public.coverage_offers
      SET status = 'withdrawn', responded_at = now()
      WHERE coverage_request_id = v_o.coverage_request_id
        AND id <> v_o.id AND status = 'offered'
      RETURNING id, cleaner_id, cleaner_phone, booking_id
  ), queued AS (
    INSERT INTO public.coverage_notifications (
      booking_id, coverage_request_id, coverage_offer_id, cleaner_id,
      audience, kind, channels, to_phone, body
    )
    SELECT p.booking_id, v_o.coverage_request_id, p.id, p.cleaner_id,
           'cleaner', 'offer_withdrawn', ARRAY['sms'], p.cleaner_phone,
           'Novara: that coverage job has been taken — thanks for being ready. No impact on your score.'
    FROM pulled p
    RETURNING 1
  )
  SELECT count(*)::int INTO v_withdrawn FROM queued;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'claimed', 'offerId', v_o.id, 'bookingId', v_o.booking_id,
    'cleanerId', v_o.cleaner_id, 'coverageRequestId', v_o.coverage_request_id,
    'wasDesignatedBackup', v_o.was_designated_backup, 'withdrawn', v_withdrawn
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_coverage_offer(text) TO service_role;

/** The assignment behind an accepted offer failed — put the offer back. */
CREATE OR REPLACE FUNCTION public.release_coverage_claim(p_offer_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.coverage_offers
    SET status = 'failed', responded_at = now(),
        notify_error = left(COALESCE(p_error, 'assignment failed'), 500)
    WHERE id = p_offer_id AND status = 'accepted';
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_coverage_claim(uuid, text) TO service_role;

/**
 * Coverage landed. Records who took it, how, and whether a designated backup
 * was activated, then closes the risk flag the delay had raised.
 */
CREATE OR REPLACE FUNCTION public.settle_coverage_request(
  p_request_id uuid,
  p_cleaner_id uuid,
  p_via text,
  p_actor uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r record;
  v_name text;
  v_backup_id uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_r FROM public.coverage_requests WHERE id = p_request_id;
  IF v_r.id IS NULL THEN RETURN; END IF;

  SELECT NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '')
    INTO v_name FROM public.cleaners c WHERE c.id = p_cleaner_id;
  SELECT booking_ref INTO v_ref FROM public.booking_projection_v1 WHERE booking_id = v_r.booking_id;

  SELECT id INTO v_backup_id FROM public.daily_backup_cleaners
    WHERE cleaner_id = p_cleaner_id
      AND on_call_date = (SELECT service_date FROM public.bookings WHERE id = v_r.booking_id)
      AND active
    LIMIT 1;

  UPDATE public.coverage_requests
    SET status = 'covered',
        covered_by_cleaner_id = p_cleaner_id,
        covered_by_name = v_name,
        covered_at = now(),
        covered_via = p_via,
        was_designated_backup = v_backup_id IS NOT NULL,
        closed_by = p_actor,
        closed_by_name = p_actor_name,
        updated_at = now()
    WHERE id = p_request_id;

  IF v_backup_id IS NOT NULL THEN
    UPDATE public.daily_backup_cleaners
      SET activated_booking_id = v_r.booking_id, activated_at = now()
      WHERE id = v_backup_id;
  END IF;

  IF v_r.risk_flag_id IS NOT NULL THEN
    UPDATE public.booking_risk_flags
      SET status = 'reassigned', resolved_at = now(),
          resolution = format('Covered by %s (%s).', COALESCE(v_name, 'another cleaner'),
                              replace(p_via, '_', ' '))
      WHERE id = v_r.risk_flag_id AND status IN ('open','acknowledged');
  END IF;

  INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
  VALUES (
    'coverage.covered', v_r.booking_id, v_r.job_id, p_cleaner_id, 'coverage',
    format('✅ %s covered by %s (%s)%s. Their portal has the full job — access, scope, instructions, deadline and pay.',
           COALESCE(v_ref, 'The job'), COALESCE(v_name, 'a cleaner'), replace(p_via, '_', ' '),
           CASE WHEN v_backup_id IS NOT NULL THEN ' — designated backup activated' ELSE '' END),
    jsonb_build_object('coverage_request_id', p_request_id, 'cleaner_id', p_cleaner_id,
                       'via', p_via, 'was_designated_backup', v_backup_id IS NOT NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_coverage_request(uuid, uuid, text, uuid, text)
  TO authenticated, service_role;

/**
 * A pass. Recorded, because we want the record — but explicitly NOT a
 * reliability penalty. Declining backup cover is exactly the honest answer we
 * asked for; punishing it teaches cleaners to ignore the text instead.
 */
CREATE OR REPLACE FUNCTION public.decline_coverage_offer(p_token text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_o record;
BEGIN
  SELECT * INTO v_o FROM public.coverage_offers WHERE response_token = p_token FOR UPDATE;
  IF v_o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That link isn''t valid.');
  END IF;
  IF v_o.status <> 'offered' THEN
    RETURN jsonb_build_object('ok', true, 'code', v_o.status, 'alreadyClosed', true);
  END IF;

  UPDATE public.coverage_offers
    SET status = 'declined', responded_at = now(),
        decline_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
        counts_against_reliability = false
    WHERE id = v_o.id;

  INSERT INTO public.events (event_type, booking_id, cleaner_id, source, summary, data)
  VALUES (
    'coverage.declined', v_o.booking_id, v_o.cleaner_id, 'coverage',
    format('↪ %s passed on covering — rolling to the next candidate. Declining backup cover is not a reliability penalty.%s',
           COALESCE(v_o.cleaner_name, 'A cleaner'),
           CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
             THEN format(' Reason: %s', p_reason) ELSE '' END),
    jsonb_build_object('coverage_request_id', v_o.coverage_request_id, 'offer_id', v_o.id,
                       'counts_against_reliability', false)
  );

  RETURN jsonb_build_object('ok', true, 'code', 'declined',
                            'coverageRequestId', v_o.coverage_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_coverage_offer(text, text) TO service_role;

/**
 * Nobody could take it.
 *
 * This is the highest-severity operational event in the system and it is
 * logged as OURS: a recurring pattern of uncovered jobs is a bench-depth
 * problem, not a cleaner problem. The customer conversation switches from a
 * new ETA to a reschedule with a goodwill gesture, funded from margin —
 * cleaner pay is untouched, always.
 */
CREATE OR REPLACE FUNCTION public.mark_coverage_uncovered(
  p_request_id uuid,
  p_reason text DEFAULT NULL,
  p_actor uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.schedule_guard_settings();
  v_tz text := public.schedule_guard_timezone();
  v_r record;
  v_b record;
  v_reason text;
  v_flag_id uuid;
  v_goodwill int := GREATEST(0, COALESCE(NULLIF(v_cfg ->> 'goodwill_credit_cents', '')::int, 2500));
  v_draft text;
BEGIN
  SELECT * INTO v_r FROM public.coverage_requests WHERE id = p_request_id FOR UPDATE;
  IF v_r.id IS NULL OR v_r.status IN ('covered','uncovered') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That coverage request is already closed.');
  END IF;

  SELECT * INTO v_b FROM public.booking_projection_v1 WHERE booking_id = v_r.booking_id;
  v_reason := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''),
    format('No candidate accepted within %s min and none could be direct-assigned in time (%s of %s ranked candidates offered).',
           GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (now() - v_r.created_at)) / 60)::int),
           (SELECT count(*) FROM public.coverage_offers WHERE coverage_request_id = p_request_id),
           v_r.candidate_count));

  UPDATE public.coverage_offers
    SET status = 'withdrawn', responded_at = now()
    WHERE coverage_request_id = p_request_id AND status = 'offered';

  UPDATE public.coverage_requests
    SET status = 'uncovered', uncovered_at = now(), uncovered_reason = v_reason,
        goodwill_credit_cents = v_goodwill, reschedule_offered_at = now(),
        closed_by = p_actor, closed_by_name = p_actor_name, updated_at = now()
    WHERE id = p_request_id;

  -- The customer conversation changes. Replace the "new ETA" draft with an
  -- honest reschedule offer on the same risk flag, so there is still exactly
  -- one prepared message and the customer never hears from us twice.
  v_flag_id := v_r.risk_flag_id;
  IF v_flag_id IS NULL THEN
    SELECT id INTO v_flag_id FROM public.booking_risk_flags
      WHERE booking_id = v_r.booking_id AND status IN ('open','acknowledged')
      ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_flag_id IS NOT NULL THEN
    v_draft := format(
      'Hi %s, it''s NovaraCleaning. I''m sorry — the cleaner scheduled for your %s visit isn''t able to make it '
      'and we haven''t been able to get cover in time. I don''t want to leave you waiting on a maybe. '
      'Can we move you to the next slot that works for you? I''m putting a $%s credit on your account for the '
      'trouble either way. Just reply with a day that suits and I''ll lock it in.',
      COALESCE(NULLIF(btrim(COALESCE(v_b.first_name, '')), ''), 'there'),
      COALESCE(to_char(v_b.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'), 'scheduled'),
      to_char(v_goodwill / 100.0, 'FM999990.00'));

    UPDATE public.booking_risk_messages
      SET draft_body = v_draft, new_eta_at = NULL, updated_at = now()
      WHERE risk_flag_id = v_flag_id AND status = 'pending';

    INSERT INTO public.booking_risk_messages (risk_flag_id, booking_id, channel, draft_body)
    SELECT v_flag_id, v_r.booking_id,
           CASE WHEN NULLIF(btrim(COALESCE(v_b.phone, '')), '') IS NULL THEN 'email' ELSE 'sms' END,
           v_draft
    WHERE NOT EXISTS (
      SELECT 1 FROM public.booking_risk_messages m
      WHERE m.risk_flag_id = v_flag_id AND m.status = 'pending'
    );

    UPDATE public.booking_risk_flags
      SET reason = format('UNCOVERED — %s. %s', COALESCE(v_b.booking_ref, 'This job'), v_reason),
          updated_at = now()
      WHERE id = v_flag_id;
  END IF;

  -- Admin hears about this whatever the hour.
  INSERT INTO public.coverage_notifications (
    booking_id, coverage_request_id, audience, kind, channels, body
  ) VALUES (
    v_r.booking_id, p_request_id, 'admin', 'uncovered_alert', ARRAY['discord'],
    format('UNCOVERED JOB — %s on %s%s. %s Reschedule + $%s goodwill is drafted and waiting. This is a bench-depth signal, not a cleaner failure.',
           COALESCE(v_b.booking_ref, 'a booking'), COALESCE(v_b.service_date::text, 'today'),
           CASE WHEN v_r.is_str_turnover THEN ' (STR TURNOVER)' ELSE '' END,
           v_reason, to_char(v_goodwill / 100.0, 'FM999990.00'))
  );

  INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
  VALUES (
    'coverage.uncovered', v_r.booking_id, v_r.job_id, v_r.from_cleaner_id, 'coverage',
    format('🆘 UNCOVERED: %s on %s%s has nobody. %s The reschedule and a $%s goodwill credit are drafted. '
           'Logged as a coverage gap — repeat uncovered jobs are a bench-depth problem, not a cleaner problem.',
           COALESCE(v_b.booking_ref, 'a booking'), COALESCE(v_b.service_date::text, 'today'),
           CASE WHEN v_r.is_str_turnover THEN ' (STR TURNOVER)' ELSE '' END,
           v_reason, to_char(v_goodwill / 100.0, 'FM999990.00')),
    jsonb_build_object('coverage_request_id', p_request_id, 'reason', v_reason,
                       'candidate_count', v_r.candidate_count,
                       'is_str_turnover', v_r.is_str_turnover,
                       'goodwill_credit_cents', v_goodwill,
                       'trigger', v_r.trigger)
  );

  RETURN jsonb_build_object('ok', true, 'reason', v_reason, 'goodwillCents', v_goodwill,
                            'riskFlagId', v_flag_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_coverage_uncovered(uuid, text, uuid, text)
  TO authenticated, service_role;

-- ─── 12. The cleaner answered ───────────────────────────────────────────────

/**
 * A real ETA moves the job to RUNNING LATE and takes the no-show declaration
 * off the table. Resolves any no-show event already opened on the booking and
 * rewrites the customer draft with the actual arrival time, because "he'll be
 * there at 10:20" is a completely different message from "we don't know where
 * he is".
 */
CREATE OR REPLACE FUNCTION public.record_cleaner_eta(
  p_booking_id uuid,
  p_eta timestamptz,
  p_note text DEFAULT NULL,
  p_via text DEFAULT 'link',
  p_actor uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := public.schedule_guard_timezone();
  v_b record;
  v_cleaner_id uuid;
  v_cleaner_name text;
  v_late int;
  v_updated int := 0;
BEGIN
  SELECT * INTO v_b FROM public.booking_projection_v1 WHERE booking_id = p_booking_id;
  IF v_b.booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking not found.');
  END IF;
  IF p_eta IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'An ETA is required — that is the whole point.');
  END IF;

  v_cleaner_id := (public.booking_crew_ids(p_booking_id))[1];
  SELECT NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '')
    INTO v_cleaner_name FROM public.cleaners c WHERE c.id = v_cleaner_id;
  v_late := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_eta - v_b.scheduled_start_at)) / 60)::int);

  WITH touched AS (
    UPDATE public.schedule_delay_events
      SET cleaner_responded_at = now(),
          cleaner_eta_at = p_eta,
          cleaner_response_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
          cleaner_response_via = p_via,
          reported_by = COALESCE(reported_by, p_actor),
          reported_by_name = COALESCE(reported_by_name, p_actor_name),
          last_evaluated_at = now(),
          detail = detail || jsonb_build_object('state', 'running_late', 'eta_at', p_eta)
      WHERE booking_id = p_booking_id
        AND event_type IN ('late_start','no_show')
        AND resolved_at IS NULL
      RETURNING id
  )
  SELECT count(*)::int INTO v_updated FROM touched;

  -- A no-show event that gets an ETA was never a no-show. Close it with the
  -- reason on the record; the late-start event carries the story from here.
  UPDATE public.schedule_delay_events
    SET resolved_at = now(),
        resolution = format('Not a no-show — cleaner reached us with an ETA of %s. Job is running late.',
                            to_char(p_eta AT TIME ZONE v_tz, 'FMHH12:MI AM'))
    WHERE booking_id = p_booking_id AND event_type = 'no_show' AND resolved_at IS NULL;

  UPDATE public.bookings
    SET running_late_eta_at = p_eta, updated_at = now()
    WHERE id = p_booking_id;

  -- The customer heads-up now has a real number in it.
  UPDATE public.booking_risk_messages m
    SET new_eta_at = p_eta,
        draft_body = public.build_delay_customer_message(v_b.first_name, p_eta),
        updated_at = now()
    FROM public.booking_risk_flags f
    WHERE f.id = m.risk_flag_id
      AND f.booking_id = p_booking_id
      AND m.status = 'pending';

  INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
  VALUES (
    'schedule.running_late', p_booking_id, v_b.job_id, v_cleaner_id, 'schedule-guard',
    format('📞 %s reached us on %s — ETA %s (~%s min late). Job is RUNNING LATE, not a no-show.%s',
           COALESCE(v_cleaner_name, 'The cleaner'), COALESCE(v_b.booking_ref, 'the job'),
           to_char(p_eta AT TIME ZONE v_tz, 'FMHH12:MI AM'), v_late,
           CASE WHEN NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL
             THEN format(' They said: "%s"', p_note) ELSE '' END),
    jsonb_build_object('eta_at', p_eta, 'minutes_late', v_late, 'via', p_via,
                       'events_updated', v_updated)
  );

  RETURN jsonb_build_object('ok', true, 'etaAt', p_eta, 'minutesLate', v_late,
                            'bookingRef', v_b.booking_ref);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cleaner_eta(uuid, timestamptz, text, text, uuid, text)
  TO authenticated, service_role;

/**
 * A cleaner tells us in advance they can't make a job.
 *
 * Deliberately NOT a no-show: it triggers the same coverage flow immediately
 * (more time is better coverage odds), is logged as a cancellation with the
 * notice period on the record, and does not open a reliability case. Short
 * notice still shows up in the reliability view — far more gently than a
 * no-show — because telling us early is precisely the behaviour we want.
 */
CREATE OR REPLACE FUNCTION public.record_cleaner_cancellation(
  p_booking_id uuid,
  p_cleaner_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_via text DEFAULT 'admin',
  p_actor uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.schedule_guard_settings();
  v_b record;
  v_cleaner_id uuid;
  v_cleaner_name text;
  v_notice int;
  v_short_hours int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'short_notice_cancel_hours', '')::int, 24));
  v_short boolean;
  v_event_id uuid;
  v_request_id uuid;
  v_notice_label text;
BEGIN
  SELECT * INTO v_b FROM public.booking_projection_v1 WHERE booking_id = p_booking_id;
  IF v_b.booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking not found.');
  END IF;

  v_cleaner_id := COALESCE(p_cleaner_id, (public.booking_crew_ids(p_booking_id))[1]);
  IF v_cleaner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nobody is assigned to this job.');
  END IF;
  SELECT NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '')
    INTO v_cleaner_name FROM public.cleaners c WHERE c.id = v_cleaner_id;

  v_notice := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_b.scheduled_start_at - now())) / 60)::int);
  v_short := v_notice < v_short_hours * 60;
  v_notice_label := CASE
    WHEN v_notice >= 1440 THEN format('%s day(s) notice', ROUND(v_notice / 1440.0, 1))
    WHEN v_notice >= 60 THEN format('%s hr notice', ROUND(v_notice / 60.0, 1))
    ELSE format('%s min notice', v_notice)
  END;

  INSERT INTO public.schedule_delay_events (
    booking_id, job_id, cleaner_id, event_type, source, scheduled_start_at,
    projected_end_at, notice_minutes, cancellation_reason, cleaner_responded_at,
    cleaner_response_via, reported_by, reported_by_name, detail
  ) VALUES (
    p_booking_id, v_b.job_id, v_cleaner_id, 'cleaner_cancellation', 'manual',
    v_b.scheduled_start_at, v_b.projected_end_at, v_notice,
    NULLIF(btrim(COALESCE(p_reason, '')), ''), now(), p_via, p_actor, p_actor_name,
    jsonb_build_object('short_notice', v_short, 'notice_label', v_notice_label,
                       'short_notice_threshold_hours', v_short_hours)
  )
  ON CONFLICT (booking_id, event_type) WHERE resolved_at IS NULL
  DO UPDATE SET notice_minutes = LEAST(public.schedule_delay_events.notice_minutes, EXCLUDED.notice_minutes),
                cancellation_reason = COALESCE(EXCLUDED.cancellation_reason, public.schedule_delay_events.cancellation_reason),
                last_evaluated_at = now()
  RETURNING id INTO v_event_id;

  -- The assignment leaves their portal, and their time-scoped access to this
  -- job's details goes with it.
  UPDATE public.job_assignments
    SET status = 'Withdrawn', responded_at = now()
    WHERE job_id = v_b.job_id AND cleaner_id = v_cleaner_id
      AND lower(replace(status, '_', ' ')) IN ('offered','accepted','confirmed','assigned','broadcast');

  IF (SELECT cleaner_id FROM public.bookings WHERE id = p_booking_id) = v_cleaner_id THEN
    UPDATE public.bookings SET cleaner_id = NULL, updated_at = now() WHERE id = p_booking_id;
  END IF;

  -- More time = better odds. Source coverage the moment we hear.
  v_request_id := public.open_coverage_request(
    p_booking_id, 'cleaner_cancellation', v_event_id, NULL, p_actor, p_actor_name,
    format('%s cancelled with %s%s', COALESCE(v_cleaner_name, 'The assigned cleaner'), v_notice_label,
           CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
             THEN format(': %s', p_reason) ELSE '' END));

  INSERT INTO public.coverage_notifications (
    booking_id, coverage_request_id, delay_event_id, cleaner_id,
    audience, kind, channels, body
  ) VALUES (
    p_booking_id, v_request_id, v_event_id, v_cleaner_id, 'va', 'cancellation_alert', ARRAY['discord'],
    format('%s cancelled %s with %s. Coverage is sourcing now. Logged as a cancellation, not a no-show.',
           COALESCE(v_cleaner_name, 'A cleaner'), COALESCE(v_b.booking_ref, 'a job'), v_notice_label)
  );

  INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
  VALUES (
    'schedule.cleaner_cancelled', p_booking_id, v_b.job_id, v_cleaner_id, 'schedule-guard',
    format('🔁 %s cancelled %s with %s%s. Coverage is sourcing. Logged as a CANCELLATION, not a no-show — %s',
           COALESCE(v_cleaner_name, 'A cleaner'), COALESCE(v_b.booking_ref, 'a job'), v_notice_label,
           CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
             THEN format(' (%s)', p_reason) ELSE '' END,
           CASE WHEN v_short THEN format('inside the %s-hour short-notice threshold, which counts far less than a no-show.', v_short_hours)
                ELSE 'well ahead of time, which is exactly what we ask for.' END),
    jsonb_build_object('delay_event_id', v_event_id, 'coverage_request_id', v_request_id,
                       'notice_minutes', v_notice, 'short_notice', v_short,
                       'reason', NULLIF(btrim(COALESCE(p_reason, '')), ''))
  );

  RETURN jsonb_build_object('ok', true, 'delayEventId', v_event_id,
                            'coverageRequestId', v_request_id,
                            'noticeMinutes', v_notice, 'shortNotice', v_short,
                            'noticeLabel', v_notice_label);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cleaner_cancellation(uuid, uuid, text, text, uuid, text)
  TO authenticated, service_role;

-- ─── 13. Detection: contact before conclusion ───────────────────────────────

/**
 * Watches today's active jobs against their projections and keeps the board
 * honest. Runs every few minutes on pg_cron; safe to run by hand.
 *
 * The late-start ladder — nothing is concluded before somebody is contacted:
 *
 *   +cleaner_nudge_minutes  automatic nudge to the cleaner (SMS + push) with a
 *                           one-tap "here's my ETA" link. Most misses are a
 *                           dead phone, and a nudge at minute 10 saves the job.
 *   +late_start_minutes     VA alerted with one-tap call/text links; the job
 *                           itself is marked at risk and the customer heads-up
 *                           is drafted.
 *   +no_show_minutes        declared a no-show: QC reliability case, coverage
 *                           sourced, customer contact first.
 *
 * A cleaner who replies with an ETA at any point is RUNNING LATE and is never
 * declared a no-show, however long the clock runs.
 *
 * Also: overruns, closing what recovered, expiring coverage offers, and
 * escalating silence — an at-risk customer sitting in silence is precisely the
 * failure this exists to prevent.
 */
CREATE OR REPLACE FUNCTION public.sweep_schedule_risk()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.schedule_guard_settings();
  v_tz text := public.schedule_guard_timezone();
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE v_tz)::date;
  v_nudge_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'cleaner_nudge_minutes', '')::int, 10));
  v_late_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'late_start_minutes', '')::int, 15));
  v_noshow_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'no_show_minutes', '')::int, 30));
  v_grace_min int := GREATEST(0, COALESCE(NULLIF(v_cfg ->> 'overrun_grace_minutes', '')::int, 10));
  v_ack_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'risk_ack_escalate_minutes', '')::int, 20));
  v_msg_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'customer_message_escalate_minutes', '')::int, 20));
  v_auto_cover boolean := COALESCE(v_cfg ->> 'coverage_auto_source', 'true') = 'true';
  v_first_min int;
  v_row record;
  v_event record;
  v_event_id uuid;
  v_crew uuid[];
  v_cleaner record;
  v_minutes int;
  v_ladder_min int;
  v_ladder_from timestamptz;
  v_missed_eta timestamptz;
  v_issue_id uuid;
  v_token text;
  v_request_id uuid;
  v_nudged int := 0;
  v_va_alerted int := 0;
  v_no_shows int := 0;
  v_running_late int := 0;
  v_overruns int := 0;
  v_resolved int := 0;
  v_escalated_risk int := 0;
  v_escalated_msg int := 0;
  v_at_risk_total int := 0;
BEGIN
  -- The ladder starts at whichever rung comes first, so an admin who sets the
  -- nudge later than the alert still gets a coherent sequence.
  v_first_min := LEAST(v_nudge_min, v_late_min);

  FOR v_row IN
    SELECT p.*
    FROM public.booking_projection_v1 p
    WHERE p.service_date = v_today
      AND p.scheduled_start_at IS NOT NULL
      AND public.schedule_live_booking_status(p.status)
      AND p.check_in_time IS NULL
      AND p.en_route_at IS NULL
      AND lower(COALESCE(p.status, '')) NOT IN ('in_progress','pending_review')
      AND v_now >= p.scheduled_start_at + (v_first_min || ' minutes')::interval
      AND array_length(public.booking_crew_ids(p.booking_id), 1) >= 1
    ORDER BY p.scheduled_start_at
  LOOP
    v_crew := public.booking_crew_ids(v_row.booking_id);
    v_minutes := FLOOR(EXTRACT(EPOCH FROM (v_now - v_row.scheduled_start_at)) / 60)::int;
    SELECT c.id,
           NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS name,
           c.phone
      INTO v_cleaner FROM public.cleaners c WHERE c.id = v_crew[1];

    -- One live late-start event carries the whole story: nudge, VA alert, and
    -- either an ETA or the no-show declaration.
    v_token := encode(gen_random_bytes(16), 'hex');
    INSERT INTO public.schedule_delay_events (
      booking_id, job_id, cleaner_id, event_type, source,
      scheduled_start_at, projected_end_at, minutes_late, response_token
    ) VALUES (
      v_row.booking_id, v_row.job_id, v_crew[1], 'late_start', 'sweep',
      v_row.scheduled_start_at, v_row.projected_end_at, v_minutes, v_token
    )
    ON CONFLICT (booking_id, event_type) WHERE resolved_at IS NULL
    DO UPDATE SET minutes_late = EXCLUDED.minutes_late,
                  last_evaluated_at = now(),
                  response_token = COALESCE(public.schedule_delay_events.response_token, EXCLUDED.response_token)
    RETURNING * INTO v_event;
    v_event_id := v_event.id;
    IF v_event_id IS NULL THEN CONTINUE; END IF;

    -- ── A live ETA: running late, not a no-show. ───────────────────────────
    -- A promise we can pass to the customer buys the cleaner the time they
    -- asked for. Once that promise is blown with still no status, the ladder
    -- restarts from the ETA they missed rather than the original window — so
    -- they get nudged again before anything is concluded a second time.
    IF v_event.cleaner_eta_at IS NOT NULL THEN
      IF v_now < v_event.cleaner_eta_at + (v_nudge_min || ' minutes')::interval THEN
        v_running_late := v_running_late + 1;
        v_at_risk_total := v_at_risk_total + public.evaluate_schedule_cascade(v_event_id);
        CONTINUE;
      END IF;

      v_missed_eta := v_event.cleaner_eta_at;
      UPDATE public.schedule_delay_events
        SET cleaner_eta_at = NULL,
            nudge_sent_at = NULL,
            va_alerted_at = NULL,
            detail = detail || jsonb_build_object('state', 'eta_missed', 'missed_eta_at', v_missed_eta)
        WHERE id = v_event_id;
      v_event.cleaner_eta_at := NULL;
      v_event.nudge_sent_at := NULL;
      v_event.va_alerted_at := NULL;
      v_event.detail := v_event.detail || jsonb_build_object('missed_eta_at', v_missed_eta);
    END IF;

    -- The thresholds are measured from the last promise we were given, so a
    -- missed ETA restarts the ladder instead of jumping straight to a
    -- declaration on a clock that has been running for an hour.
    v_ladder_from := GREATEST(
      v_row.scheduled_start_at,
      COALESCE((v_event.detail ->> 'missed_eta_at')::timestamptz, v_row.scheduled_start_at)
    );
    v_ladder_min := FLOOR(EXTRACT(EPOCH FROM (v_now - v_ladder_from)) / 60)::int;

    -- ── +10: the nudge. Try the person before concluding anything. ─────────
    IF v_ladder_min >= v_nudge_min AND v_event.nudge_sent_at IS NULL
       AND v_event.cleaner_eta_at IS NULL THEN
      v_nudged := v_nudged + 1;
      UPDATE public.schedule_delay_events
        SET nudge_sent_at = now(), nudge_count = nudge_count + 1
        WHERE id = v_event_id;

      INSERT INTO public.coverage_notifications (
        booking_id, delay_event_id, cleaner_id, audience, kind, channels, to_phone, title, body
      ) VALUES (
        v_row.booking_id, v_event_id, v_crew[1], 'cleaner', 'nudge', ARRAY['sms','push'],
        v_cleaner.phone, 'Are you on the way?',
        format('Novara: are you on the way to %s (%s, %s)? Your window opened at %s. '
               'Tap to send your ETA or update your status: {{ETA_URL}} — if something''s come up, tell us now and we''ll cover it.',
               COALESCE(v_row.first_name, 'your client'),
               COALESCE(v_row.address, 'the job'), COALESCE(v_row.city, ''),
               to_char(v_row.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'))
      );
    END IF;

    -- ── +15: the VA, with the job marked at risk. ─────────────────────────
    IF v_ladder_min >= v_late_min AND v_event.va_alerted_at IS NULL THEN
      v_va_alerted := v_va_alerted + 1;
      UPDATE public.schedule_delay_events SET va_alerted_at = now() WHERE id = v_event_id;

      INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
      VALUES ('schedule.late_start', v_row.booking_id, v_row.job_id, v_crew[1], 'schedule-guard',
        format('🕒 %s: no en-route or check-in %s min past the %s window (%s). We nudged %s at +%s min and got nothing back — '
               'call them now: tel:%s · sms:%s. No-show is declared at +%s min unless they answer with an ETA.',
               v_row.booking_ref, v_minutes,
               to_char(v_row.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
               v_row.service_date, COALESCE(v_cleaner.name, 'the crew'), v_nudge_min,
               COALESCE(v_cleaner.phone, 'unknown'), COALESCE(v_cleaner.phone, 'unknown'),
               v_noshow_min),
        jsonb_build_object('delay_event_id', v_event_id, 'minutes_late', v_minutes,
                           'cleaner_phone', v_cleaner.phone,
                           'nudged_at', v_event.nudge_sent_at,
                           'eta_link_token', COALESCE(v_event.response_token, v_token),
                           'no_show_at_minutes', v_noshow_min));

      INSERT INTO public.coverage_notifications (
        booking_id, delay_event_id, cleaner_id, audience, kind, channels, body
      ) VALUES (
        v_row.booking_id, v_event_id, v_crew[1], 'va', 'va_alert', ARRAY['discord'],
        format('%s is %s min late with no status and no answer to the nudge. Reach %s on %s. At-risk board has the details.',
               v_row.booking_ref, v_minutes, COALESCE(v_cleaner.name, 'the crew'),
               COALESCE(v_cleaner.phone, 'their file'))
      );
    END IF;

    IF v_ladder_min >= v_late_min THEN
      v_at_risk_total := v_at_risk_total + public.evaluate_schedule_cascade(v_event_id);
    END IF;

    -- ── +30: unreachable. Now, and only now, it is a no-show. ─────────────
    IF v_ladder_min >= v_noshow_min THEN
      INSERT INTO public.schedule_delay_events (
        booking_id, job_id, cleaner_id, event_type, source,
        scheduled_start_at, projected_end_at, minutes_late, no_show_declared_at
      ) VALUES (
        v_row.booking_id, v_row.job_id, v_crew[1], 'no_show', 'sweep',
        v_row.scheduled_start_at, v_row.projected_end_at, v_minutes, now()
      )
      ON CONFLICT (booking_id, event_type) WHERE resolved_at IS NULL
      DO UPDATE SET minutes_late = EXCLUDED.minutes_late, last_evaluated_at = now()
      RETURNING id INTO v_event_id;

      IF v_event_id IS NOT NULL
         AND (SELECT qc_issue_id FROM public.schedule_delay_events WHERE id = v_event_id) IS NULL THEN
        v_no_shows := v_no_shows + 1;

        -- 3. The QC reliability case, with the contact timeline attached. The
        -- system opens it; a human decides the consequence.
        v_issue_id := public.open_no_show_qc_case(v_row.booking_id, v_crew[1], v_minutes);
        UPDATE public.schedule_delay_events SET qc_issue_id = v_issue_id WHERE id = v_event_id;

        IF v_issue_id IS NOT NULL THEN
          INSERT INTO public.qc_issue_events (issue_id, action, note, actor_name, data)
          SELECT v_issue_id, 'note',
                 format(
'Contact timeline before the declaration — %s
• Window opened %s.
• Automatic nudge to the cleaner at +%s min: %s.
• VA alerted at +%s min: %s.
• No en-route, no check-in and no ETA reply by +%s min → declared a no-show at %s.
A reply with an ETA at any point would have made this a running-late job instead.',
                   COALESCE(v_cleaner.name, 'the assigned cleaner'),
                   to_char(v_row.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
                   v_nudge_min,
                   COALESCE(to_char(e.nudge_sent_at AT TIME ZONE v_tz, 'FMHH12:MI AM'), 'not sent'),
                   v_late_min,
                   COALESCE(to_char(e.va_alerted_at AT TIME ZONE v_tz, 'FMHH12:MI AM'), 'not sent'),
                   v_noshow_min,
                   to_char(v_now AT TIME ZONE v_tz, 'FMHH12:MI AM'))
                 , 'Schedule guard',
                 jsonb_build_object('delay_event_id', v_event_id, 'minutes_late', v_minutes,
                                    'nudge_sent_at', e.nudge_sent_at, 'va_alerted_at', e.va_alerted_at,
                                    'nudge_count', e.nudge_count)
          FROM public.schedule_delay_events e
          WHERE e.booking_id = v_row.booking_id AND e.event_type = 'late_start'
          ORDER BY e.detected_at DESC LIMIT 1;
        END IF;

        -- 1. Customer contact first: flag THIS booking, not only the ones
        -- behind it. A no-show customer must hear from us fastest of all.
        INSERT INTO public.booking_risk_flags (
          booking_id, delay_event_id, upstream_booking_id, cleaner_id,
          scheduled_start_at, projected_arrival_at, delay_minutes, position_in_chain, reason
        ) VALUES (
          v_row.booking_id, v_event_id, v_row.booking_id, v_crew[1],
          v_row.scheduled_start_at, v_now + interval '90 minutes', v_minutes, 0,
          format('No-show on %s — nudged at +%s min, VA alerted at +%s min, still nothing %s min past the window. Contact the customer now and cover the job.',
                 v_row.booking_ref, v_nudge_min, v_late_min, v_minutes)
        )
        ON CONFLICT (booking_id, delay_event_id) DO UPDATE
          SET delay_minutes = EXCLUDED.delay_minutes, reason = EXCLUDED.reason, updated_at = now();

        INSERT INTO public.booking_risk_messages (risk_flag_id, booking_id, channel, new_eta_at, draft_body)
        SELECT f.id, v_row.booking_id,
               CASE WHEN NULLIF(btrim(COALESCE(v_row.phone, '')), '') IS NULL THEN 'email' ELSE 'sms' END,
               v_now + interval '90 minutes',
               public.build_delay_customer_message(v_row.first_name, v_now + interval '90 minutes')
        FROM public.booking_risk_flags f
        WHERE f.booking_id = v_row.booking_id AND f.delay_event_id = v_event_id
          AND NOT EXISTS (SELECT 1 FROM public.booking_risk_messages m WHERE m.risk_flag_id = f.id);

        -- 2. Coverage, immediately. Urgent windows skip the offer cycle.
        IF v_auto_cover THEN
          v_request_id := public.open_coverage_request(
            v_row.booking_id, 'no_show', v_event_id,
            (SELECT f.id FROM public.booking_risk_flags f
              WHERE f.booking_id = v_row.booking_id AND f.delay_event_id = v_event_id LIMIT 1),
            NULL, 'Schedule guard',
            format('No-show declared %s min past the window after a nudge and a VA alert went unanswered.', v_minutes));

          IF v_request_id IS NOT NULL THEN
            PERFORM public.issue_coverage_offers(v_request_id);
          END IF;
        END IF;

        INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
        VALUES ('schedule.no_show', v_row.booking_id, v_row.job_id, v_crew[1], 'schedule-guard',
          format('🚨 NO-SHOW on %s — %s was nudged at +%s min, the VA was alerted at +%s min, and nothing came back %s min past the window. '
                 'Customer heads-up is drafted, coverage is sourcing, and a QC reliability case is open for a human call. '
                 'Pay for work already completed elsewhere is untouched.',
                 v_row.booking_ref, COALESCE(v_cleaner.name, 'the cleaner'), v_nudge_min, v_late_min, v_minutes),
          jsonb_build_object('delay_event_id', v_event_id, 'qc_issue_id', v_issue_id,
                             'coverage_request_id', v_request_id, 'minutes_late', v_minutes));
      END IF;

      IF v_event_id IS NOT NULL THEN
        v_at_risk_total := v_at_risk_total + public.evaluate_schedule_cascade(v_event_id);
      END IF;
    END IF;
  END LOOP;

  -- ── Overruns: started, past projection, still not done ───────────────────
  FOR v_row IN
    SELECT p.*
    FROM public.booking_projection_v1 p
    WHERE p.service_date BETWEEN v_today - 1 AND v_today
      AND p.check_in_time IS NOT NULL
      AND p.check_out_time IS NULL
      AND public.schedule_live_booking_status(p.status)
      AND lower(COALESCE(p.status, '')) NOT IN ('pending_review')
      AND p.live_projected_end_at IS NOT NULL
      AND v_now >= p.live_projected_end_at + (v_grace_min || ' minutes')::interval
      AND array_length(public.booking_crew_ids(p.booking_id), 1) >= 1
    ORDER BY p.live_projected_end_at
  LOOP
    v_crew := public.booking_crew_ids(v_row.booking_id);
    v_minutes := FLOOR(EXTRACT(EPOCH FROM (v_now - v_row.live_projected_end_at)) / 60)::int;

    INSERT INTO public.schedule_delay_events (
      booking_id, job_id, cleaner_id, event_type, source,
      scheduled_start_at, projected_end_at, minutes_over
    ) VALUES (
      v_row.booking_id, v_row.job_id, v_crew[1], 'overrun', 'sweep',
      v_row.scheduled_start_at, v_row.live_projected_end_at, v_minutes
    )
    ON CONFLICT (booking_id, event_type) WHERE resolved_at IS NULL
    DO UPDATE SET minutes_over = EXCLUDED.minutes_over,
                  projected_end_at = EXCLUDED.projected_end_at,
                  last_evaluated_at = now()
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.booking_id = v_row.booking_id AND e.event_type = 'schedule.overrun'
          AND e.occurred_at > v_now - interval '4 hours'
      ) THEN
        v_overruns := v_overruns + 1;
        INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
        VALUES ('schedule.overrun', v_row.booking_id, v_row.job_id, v_crew[1], 'schedule-guard',
          format('⏳ %s is ~%s min past its projected finish and still open. Re-checking the crew''s remaining day.',
                 v_row.booking_ref, v_minutes),
          jsonb_build_object('delay_event_id', v_event_id, 'minutes_over', v_minutes));
      END IF;
      v_at_risk_total := v_at_risk_total + public.evaluate_schedule_cascade(v_event_id);
    END IF;
  END LOOP;

  -- ── Close what recovered ─────────────────────────────────────────────────
  WITH closed AS (
    UPDATE public.schedule_delay_events e
      SET resolved_at = now(),
          resolution = CASE
            WHEN e.event_type IN ('late_start','no_show') THEN 'Crew started — late-start window closed.'
            ELSE 'Job closed out.'
          END
      FROM public.booking_projection_v1 p
      WHERE p.booking_id = e.booking_id
        AND e.resolved_at IS NULL
        AND (
          (e.event_type IN ('late_start','no_show')
            AND (p.check_in_time IS NOT NULL OR p.en_route_at IS NOT NULL
                 OR NOT public.schedule_live_booking_status(p.status)))
          OR (e.event_type IN ('overrun','field_flag')
            AND (p.check_out_time IS NOT NULL OR NOT public.schedule_live_booking_status(p.status)
                 OR lower(COALESCE(p.status, '')) IN ('pending_review')))
          OR (e.event_type = 'cleaner_cancellation'
            AND NOT public.schedule_live_booking_status(p.status))
        )
      RETURNING e.id
  )
  SELECT count(*) INTO v_resolved FROM closed;

  UPDATE public.booking_risk_flags f
    SET status = 'resolved', resolved_at = now(),
        resolution = COALESCE(f.resolution, 'Crew arrived or the booking closed out.')
    FROM public.booking_projection_v1 p
    WHERE p.booking_id = f.booking_id
      AND f.status IN ('open','acknowledged')
      AND (p.check_in_time IS NOT NULL OR NOT public.schedule_live_booking_status(p.status));

  -- Nothing left to send once the risk is gone and no human ever touched it.
  UPDATE public.booking_risk_messages m
    SET status = 'dismissed', dismissed_at = now(),
        dismiss_reason = 'Risk cleared before the heads-up was needed.'
    FROM public.booking_risk_flags f
    WHERE f.id = m.risk_flag_id
      AND m.status = 'pending'
      AND f.status = 'resolved';

  -- A crew that turned up closes the coverage search with it.
  UPDATE public.coverage_requests r
    SET status = 'cancelled', updated_at = now(),
        notes = COALESCE(r.notes, 'Original crew checked in — coverage no longer needed.')
    FROM public.booking_projection_v1 p
    WHERE p.booking_id = r.booking_id
      AND r.status IN ('sourcing','offered')
      AND (p.check_in_time IS NOT NULL OR NOT public.schedule_live_booking_status(p.status));

  UPDATE public.coverage_offers o
    SET status = 'withdrawn', responded_at = now()
    FROM public.coverage_requests r
    WHERE r.id = o.coverage_request_id
      AND o.status = 'offered'
      AND r.status NOT IN ('sourcing','offered');

  -- ── Escalate silence ─────────────────────────────────────────────────────
  WITH stale AS (
    UPDATE public.booking_risk_flags f
      SET escalated_at = now()
      WHERE f.status = 'open' AND f.escalated_at IS NULL
        AND f.created_at <= v_now - (v_ack_min || ' minutes')::interval
      RETURNING f.id, f.booking_id, f.reason, f.delay_minutes
  ), logged AS (
    INSERT INTO public.events (event_type, booking_id, source, summary, data)
    SELECT 'schedule.risk_unacknowledged', s.booking_id, 'schedule-guard',
           format('🔔 ESCALATION — an at-risk booking has sat unacknowledged for %s min. %s',
                  v_ack_min, s.reason),
           jsonb_build_object('risk_flag_id', s.id, 'delay_minutes', s.delay_minutes)
    FROM stale s
    RETURNING 1
  )
  SELECT count(*) INTO v_escalated_risk FROM logged;

  WITH stale AS (
    UPDATE public.booking_risk_messages m
      SET escalated_at = now()
      WHERE m.status = 'pending' AND m.escalated_at IS NULL
        AND m.prepared_at <= v_now - (v_msg_min || ' minutes')::interval
      RETURNING m.id, m.booking_id, m.new_eta_at
  ), logged AS (
    INSERT INTO public.events (event_type, booking_id, source, summary, data)
    SELECT 'schedule.customer_message_unsent', s.booking_id, 'schedule-guard',
           format('🔕 ESCALATION — the heads-up for %s has been sitting unsent for %s min. '
                  'The customer still does not know we are running late.',
                  COALESCE((SELECT booking_ref FROM public.booking_projection_v1 WHERE booking_id = s.booking_id), 'a booking'),
                  v_msg_min),
           jsonb_build_object('risk_message_id', s.id, 'new_eta_at', s.new_eta_at)
    FROM stale s
    RETURNING 1
  )
  SELECT count(*) INTO v_escalated_msg FROM logged;

  RETURN jsonb_build_object(
    'ran_at', v_now,
    'operating_date', v_today,
    'cleaners_nudged', v_nudged,
    'va_alerts', v_va_alerted,
    'running_late', v_running_late,
    'no_shows', v_no_shows,
    'overruns', v_overruns,
    'downstream_at_risk', v_at_risk_total,
    'events_resolved', v_resolved,
    'escalated_risk_flags', v_escalated_risk,
    'escalated_messages', v_escalated_msg
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sweep_schedule_risk() TO service_role;

-- ─── 14. The coverage cycle ─────────────────────────────────────────────────

/**
 * Keeps the offer cycle turning without anybody watching it:
 *
 *   * closes offer windows that have run out (and tells the cleaner);
 *   * rolls a request with nothing live on to the next candidate(s);
 *   * marks a request UNCOVERED once the candidates or the clock run out.
 *
 * Urgent requests are rolled too, only faster and wider — nobody should have
 * to be watching a screen for a job to keep looking for cover.
 */
CREATE OR REPLACE FUNCTION public.run_coverage_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_expired int := 0;
  v_rolled int := 0;
  v_offers int := 0;
  v_uncovered int := 0;
  v_r record;
  v_issued int;
BEGIN
  WITH gone AS (
    UPDATE public.coverage_offers
      SET status = 'expired', responded_at = v_now
      WHERE status = 'offered' AND expires_at <= v_now
      RETURNING id, booking_id, coverage_request_id, cleaner_id, cleaner_phone, cleaner_name
  ), told AS (
    INSERT INTO public.coverage_notifications (
      booking_id, coverage_request_id, coverage_offer_id, cleaner_id,
      audience, kind, channels, to_phone, body
    )
    SELECT g.booking_id, g.coverage_request_id, g.id, g.cleaner_id,
           'cleaner', 'offer_expired', ARRAY['sms'], g.cleaner_phone,
           'Novara: that coverage offer has expired and moved on to the next cleaner. No impact on your score.'
    FROM gone g
    RETURNING 1
  )
  SELECT count(*)::int INTO v_expired FROM told;

  FOR v_r IN
    SELECT r.*
    FROM public.coverage_requests r
    WHERE r.status IN ('sourcing','offered')
      AND NOT EXISTS (
        SELECT 1 FROM public.coverage_offers o
        WHERE o.coverage_request_id = r.id AND o.status IN ('offered','accepted')
      )
    ORDER BY r.is_urgent DESC, r.give_up_at NULLS LAST
  LOOP
    -- Out of time: this is uncovered, and it is ours. Urgent requests get the
    -- longer fuse set when they opened, so a human still had the window to
    -- direct-assign before the clock reached here.
    IF v_r.give_up_at IS NOT NULL AND v_r.give_up_at <= v_now THEN
      PERFORM public.mark_coverage_uncovered(v_r.id, NULL, NULL, 'Coverage cycle');
      v_uncovered := v_uncovered + 1;
      CONTINUE;
    END IF;

    IF v_r.round >= v_r.max_rounds THEN
      PERFORM public.mark_coverage_uncovered(
        v_r.id,
        format('All %s offer round(s) went unanswered or were declined.', v_r.max_rounds),
        NULL, 'Coverage cycle');
      v_uncovered := v_uncovered + 1;
      CONTINUE;
    END IF;

    v_issued := public.issue_coverage_offers(v_r.id);
    IF v_issued = 0 THEN
      PERFORM public.mark_coverage_uncovered(
        v_r.id,
        'Every ranked candidate has been offered the job and none accepted — nobody left who clears the window, the zone and their stated limits.',
        NULL, 'Coverage cycle');
      v_uncovered := v_uncovered + 1;
    ELSE
      v_rolled := v_rolled + 1;
      v_offers := v_offers + v_issued;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ran_at', v_now,
    'offers_expired', v_expired,
    'requests_rolled', v_rolled,
    'offers_sent', v_offers,
    'marked_uncovered', v_uncovered
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_coverage_cycle() TO service_role;

-- ─── 15. Reporting views ────────────────────────────────────────────────────

-- Coverage health per day: is there a bench, and which days are exposed?
-- STR turnovers are called out because a guest check-in deadline is the least
-- forgiving thing on the schedule — an uncovered STR day is a different
-- severity from an uncovered Tuesday.
CREATE OR REPLACE VIEW public.coverage_health_v1 AS
WITH days AS (
  SELECT DISTINCT p.service_date
  FROM public.booking_projection_v1 p
  WHERE p.service_date BETWEEN (now() AT TIME ZONE public.schedule_guard_timezone())::date - 7
                           AND (now() AT TIME ZONE public.schedule_guard_timezone())::date + 30
    AND public.schedule_live_booking_status(p.status)
  UNION
  SELECT DISTINCT b.on_call_date FROM public.daily_backup_cleaners b
  WHERE b.active
    AND b.on_call_date BETWEEN (now() AT TIME ZONE public.schedule_guard_timezone())::date - 7
                           AND (now() AT TIME ZONE public.schedule_guard_timezone())::date + 30
)
SELECT
  d.service_date,
  (SELECT count(*)::int FROM public.booking_projection_v1 p
    WHERE p.service_date = d.service_date AND public.schedule_live_booking_status(p.status)) AS jobs,
  (SELECT count(*)::int FROM public.booking_projection_v1 p
    WHERE p.service_date = d.service_date AND public.schedule_live_booking_status(p.status)
      AND public.booking_is_str_turnover(p.booking_id))                                     AS str_turnovers,
  (SELECT count(*)::int FROM public.daily_backup_cleaners b
    WHERE b.on_call_date = d.service_date AND b.active)                                     AS backups,
  (SELECT count(*)::int FROM public.daily_backup_cleaners b
    WHERE b.on_call_date = d.service_date AND b.active AND b.activated_at IS NOT NULL)       AS backups_activated,
  (SELECT count(*)::int FROM public.coverage_requests r
    JOIN public.bookings b2 ON b2.id = r.booking_id
    WHERE b2.service_date = d.service_date AND r.status = 'uncovered')                       AS uncovered_jobs,
  (SELECT count(*)::int FROM public.coverage_requests r
    JOIN public.bookings b3 ON b3.id = r.booking_id
    WHERE b3.service_date = d.service_date AND r.status IN ('sourcing','offered'))           AS coverage_open,
  -- A day with jobs and no bench is one oversleep away from a lost customer.
  (
    (SELECT count(*) FROM public.booking_projection_v1 p
      WHERE p.service_date = d.service_date AND public.schedule_live_booking_status(p.status)) > 0
    AND (SELECT count(*) FROM public.daily_backup_cleaners b
      WHERE b.on_call_date = d.service_date AND b.active
        AND b.activated_at IS NULL) = 0
  )                                                                                          AS uncovered_day,
  (
    (SELECT count(*) FROM public.booking_projection_v1 p
      WHERE p.service_date = d.service_date AND public.schedule_live_booking_status(p.status)
        AND public.booking_is_str_turnover(p.booking_id)) > 0
    AND (SELECT count(*) FROM public.daily_backup_cleaners b
      WHERE b.on_call_date = d.service_date AND b.active AND b.activated_at IS NULL) = 0
  )                                                                                          AS str_day_exposed
FROM days d
ORDER BY d.service_date;

COMMENT ON VIEW public.coverage_health_v1 IS
  'Per-day bench depth: jobs on the books, how many are STR turnovers, how many backups are designated and still available, and whether the day is uncovered. Days carrying STR turnovers with no bench are flagged separately — a guest check-in deadline is the least forgiving job we run.';

-- The coverage board: every live and recent search, with its offers.
CREATE OR REPLACE VIEW public.coverage_board_v1 AS
SELECT
  r.id                          AS coverage_request_id,
  r.status,
  r.trigger,
  r.trigger_detail,
  r.mode,
  r.round,
  r.max_rounds,
  r.offer_window_minutes,
  r.offers_per_round,
  r.is_urgent,
  r.urgency_reason,
  r.is_str_turnover,
  r.hard_deadline_at,
  r.scheduled_start_at,
  r.candidate_count,
  r.candidates_snapshot,
  r.give_up_at,
  r.from_cleaner_id,
  r.from_cleaner_name,
  r.covered_by_cleaner_id,
  r.covered_by_name,
  r.covered_at,
  r.covered_via,
  r.was_designated_backup,
  r.uncovered_at,
  r.uncovered_reason,
  r.goodwill_credit_cents,
  r.goodwill_applied_at,
  r.reschedule_offered_at,
  r.opened_by_name,
  r.notes,
  r.created_at,
  r.delay_event_id,
  r.risk_flag_id,
  p.booking_id,
  p.booking_ref,
  p.service_date,
  p.time_slot,
  p.service_type,
  p.status                      AS booking_status,
  p.first_name,
  p.last_name,
  p.phone,
  p.address,
  p.city,
  p.zip_code,
  p.job_id,
  e.event_type                  AS delay_event_type,
  e.minutes_late,
  e.notice_minutes,
  e.cleaner_eta_at,
  e.nudge_sent_at,
  e.va_alerted_at,
  e.qc_issue_id,
  COALESCE(o.offers, '[]'::jsonb) AS offers,
  o.live_offers,
  o.next_expiry_at
FROM public.coverage_requests r
JOIN public.booking_projection_v1 p ON p.booking_id = r.booking_id
LEFT JOIN public.schedule_delay_events e ON e.id = r.delay_event_id
LEFT JOIN LATERAL (
  SELECT
    jsonb_agg(jsonb_build_object(
      'id', x.id,
      'cleaner_id', x.cleaner_id,
      'cleaner_name', x.cleaner_name,
      'cleaner_phone', x.cleaner_phone,
      'rank_position', x.rank_position,
      'rank_reason', x.rank_reason,
      'round', x.round,
      'was_designated_backup', x.was_designated_backup,
      'status', x.status,
      'offered_at', x.offered_at,
      'expires_at', x.expires_at,
      'responded_at', x.responded_at,
      'decline_reason', x.decline_reason,
      'notified_via', x.notified_via,
      'counts_against_reliability', x.counts_against_reliability
    ) ORDER BY x.rank_position)                                     AS offers,
    count(*) FILTER (WHERE x.status = 'offered')::int               AS live_offers,
    min(x.expires_at) FILTER (WHERE x.status = 'offered')           AS next_expiry_at
  FROM public.coverage_offers x
  WHERE x.coverage_request_id = r.id
) o ON true;

COMMENT ON VIEW public.coverage_board_v1 IS
  'Every coverage search with its full offer trail: what triggered it, who was offered in what order and why, who declined, who accepted or was direct-assigned, and whether it ended covered or uncovered.';

-- The person pattern. Repeat no-shows and short-notice cancellations, with the
-- notice period visible, because the difference between them is the behaviour
-- we are trying to encourage.
CREATE OR REPLACE VIEW public.cleaner_reliability_v1 AS
SELECT
  c.id                                                              AS cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.novara_score,
  c.overall_score,
  count(*) FILTER (WHERE e.event_type = 'no_show'
    AND e.detected_at > now() - interval '90 days')::int            AS no_shows_90d,
  count(*) FILTER (WHERE e.event_type = 'no_show'
    AND e.detected_at > now() - interval '30 days')::int            AS no_shows_30d,
  count(*) FILTER (WHERE e.event_type = 'cleaner_cancellation'
    AND e.detected_at > now() - interval '90 days')::int            AS cancellations_90d,
  count(*) FILTER (WHERE e.event_type = 'cleaner_cancellation'
    AND e.detected_at > now() - interval '90 days'
    AND e.notice_minutes < COALESCE(NULLIF(public.schedule_guard_settings() ->> 'short_notice_cancel_hours', '')::int, 24) * 60
    )::int                                                          AS short_notice_cancellations_90d,
  ROUND(avg(e.notice_minutes) FILTER (WHERE e.event_type = 'cleaner_cancellation'
    AND e.detected_at > now() - interval '90 days'))                AS avg_cancellation_notice_minutes,
  -- The good half of the story: they were late but they told us.
  count(*) FILTER (WHERE e.event_type = 'late_start' AND e.cleaner_eta_at IS NOT NULL
    AND e.detected_at > now() - interval '90 days')::int            AS late_but_reachable_90d,
  count(*) FILTER (WHERE e.event_type = 'late_start' AND e.cleaner_eta_at IS NULL
    AND e.nudge_sent_at IS NOT NULL
    AND e.detected_at > now() - interval '90 days')::int            AS nudges_unanswered_90d,
  max(e.detected_at) FILTER (WHERE e.event_type = 'no_show')        AS last_no_show_at,
  max(e.detected_at) FILTER (WHERE e.event_type = 'cleaner_cancellation') AS last_cancellation_at,
  -- Declines are counted for visibility ONLY. They are never a penalty:
  -- passing on backup cover is the honest answer we asked for.
  (SELECT count(*)::int FROM public.coverage_offers o
    WHERE o.cleaner_id = c.id AND o.status = 'declined'
      AND o.created_at > now() - interval '90 days')                AS coverage_offers_declined_90d,
  (SELECT count(*)::int FROM public.coverage_offers o
    WHERE o.cleaner_id = c.id AND o.status = 'accepted'
      AND o.created_at > now() - interval '90 days')                AS coverage_offers_accepted_90d,
  (SELECT count(*)::int FROM public.daily_backup_cleaners b
    WHERE b.cleaner_id = c.id AND b.on_call_date > (now() - interval '90 days')::date) AS days_on_call_90d
FROM public.cleaners c
LEFT JOIN public.schedule_delay_events e
  ON e.cleaner_id = c.id AND e.detected_at > now() - interval '90 days'
GROUP BY c.id, c.first_name, c.last_name, c.novara_score, c.overall_score;

COMMENT ON VIEW public.cleaner_reliability_v1 IS
  'Per-cleaner reliability pattern over 90 days: no-shows, cancellations WITH the notice period, jobs where they were late but reachable, and nudges that went unanswered. Coverage-offer declines are shown for context only and are never a penalty — only accepting and then abandoning a job is.';

-- The bench pattern. Repeat uncovered jobs are a coverage gap, and the days
-- and job types that keep failing are the actual finding.
CREATE OR REPLACE VIEW public.coverage_gap_v1 AS
SELECT
  b.service_date,
  to_char(b.service_date, 'FMDay')                                  AS weekday,
  public.booking_client_type(b.booking_type, b.partner_details)      AS client_type,
  public.normalize_service_key(b.service_type)                      AS service_type,
  count(*)::int                                                     AS uncovered_jobs,
  count(*) FILTER (WHERE r.is_str_turnover)::int                    AS uncovered_str_turnovers,
  count(*) FILTER (WHERE r.trigger = 'no_show')::int                AS from_no_show,
  count(*) FILTER (WHERE r.trigger = 'cleaner_cancellation')::int    AS from_cancellation,
  ROUND(avg(r.candidate_count), 1)                                  AS avg_candidates_available,
  sum(r.goodwill_credit_cents)::int                                 AS goodwill_cents,
  (SELECT count(*)::int FROM public.daily_backup_cleaners d
    WHERE d.on_call_date = b.service_date AND d.active)              AS backups_that_day,
  max(r.uncovered_at)                                               AS last_uncovered_at
FROM public.coverage_requests r
JOIN public.bookings b ON b.id = r.booking_id
WHERE r.status = 'uncovered'
GROUP BY
  b.service_date,
  public.booking_client_type(b.booking_type, b.partner_details),
  public.normalize_service_key(b.service_type)
ORDER BY b.service_date DESC;

COMMENT ON VIEW public.coverage_gap_v1 IS
  'Uncovered jobs grouped by day, client type and service type, with how many candidates existed and how many backups were on call. A recurring pattern here is a bench-depth problem to hire against — not a cleaner to discipline.';

-- ─── 16. Alert routing ──────────────────────────────────────────────────────
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('schedule.running_late',        'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.cleaner_cancelled',   'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coverage.requested',           'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coverage.offers_sent',         'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coverage.declined',            'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coverage.covered',             'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coverage.direct_assigned',     'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coverage.uncovered',           'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('coverage.goodwill_applied',    'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- ─── 17. Cron ───────────────────────────────────────────────────────────────
-- The sweep stays pure SQL (no edge hop, no shared secret). The coverage
-- runner has to reach the SMS/push transports, so it goes through pg_net —
-- every minute, because a 10-minute accept window can't be measured by a
-- five-minute job without losing a fifth of it.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_service_role text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'coverage-runner';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('coverage-runner'); END IF;

  PERFORM cron.schedule(
    'coverage-runner',
    '* * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/coverage-runner',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      v_service_role
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping coverage-runner cron scheduling: %', SQLERRM;
END $$;
