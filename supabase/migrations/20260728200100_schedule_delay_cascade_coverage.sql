-- ─── Delay detection, cascade walk, customer heads-up, backup coverage ────
--
-- The buffer (20260728200000) buys room. This is what happens when the day
-- goes wrong anyway.
--
--   1. schedule_delay_events — late start, overrun, no-show, and the cleaner's
--      own "this is way bigger than scoped" field flag, detected from signals
--      that already exist (job check-in, QC field reports) rather than a new
--      tracking system.
--   2. evaluate_schedule_cascade() — the moment a delay is detected, WALK the
--      crew's remaining day and mark every downstream booking at risk with a
--      computed new arrival ETA. No at-risk booking goes unidentified.
--   3. booking_risk_messages — a ready-to-send, editable heads-up to that
--      customer, prepared at DETECTION, offering the reschedule. The $160 we
--      lost was not lost to lateness; it was lost to silence. An unsent prompt
--      escalates to admin, because silence IS the failure mode.
--   4. daily_backup_cleaners + suggest_coverage_cleaners() — on-call
--      designation drawn from availability data, and ranked reassignment
--      candidates (backups first, then Novara Score / zone fit / schedule
--      slack) that never violate a cleaner's stated windows or zones.
--   5. No-show → an automatic QC reliability case against the cleaner, linked
--      to the job. The system opens the case; a HUMAN decides the consequence,
--      exactly like every other flag in this product. Pay for completed work
--      is never touched.
--   6. job_duration_actuals — projected vs actual on every completed job, so
--      the duration model (and therefore the buffers and the prices built on
--      it) gets corrected by reality instead of opinion.
--
-- Reuses: bookings/jobs/job_assignments, qc_issues + qc_issue_events (the
-- accountability ladder), cleaners.novara_score + constraints + availability,
-- events + discord_routes (VA/admin alerting), app_settings, pg_cron.

-- ─── 1. Delay events ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.schedule_delay_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('late_start','overrun','field_flag','no_show')),
  -- 'sweep' (the clock noticed), 'field_flag' (the crew told us), 'manual'.
  source text NOT NULL DEFAULT 'sweep',
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  scheduled_start_at timestamptz,
  projected_end_at timestamptz,
  -- Minutes past scheduled start with no en-route/start (late_start, no_show).
  minutes_late integer,
  -- Minutes the job is expected to run past its projection (overrun, and the
  -- immediate assumption on a scope field flag).
  minutes_over integer,
  -- The QC case behind this: the cleaner's field report, or the reliability
  -- case the no-show opened.
  qc_issue_id uuid REFERENCES public.qc_issues(id) ON DELETE SET NULL,
  downstream_at_risk integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One live event per kind per booking: an overrun that keeps growing UPDATES
-- rather than filling the board with duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS sde_open_unique_idx
  ON public.schedule_delay_events (booking_id, event_type)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS sde_detected_idx
  ON public.schedule_delay_events (detected_at DESC);
CREATE INDEX IF NOT EXISTS sde_cleaner_idx
  ON public.schedule_delay_events (cleaner_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS sde_open_idx
  ON public.schedule_delay_events (resolved_at) WHERE resolved_at IS NULL;

ALTER TABLE public.schedule_delay_events ENABLE ROW LEVEL SECURITY;

-- ─── 2. At-risk downstream bookings ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_risk_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The booking that is now at risk (the one the customer is waiting on).
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  delay_event_id uuid NOT NULL REFERENCES public.schedule_delay_events(id) ON DELETE CASCADE,
  -- The job that caused it, and the crew both share.
  upstream_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  scheduled_start_at timestamptz,
  projected_arrival_at timestamptz,
  delay_minutes integer NOT NULL DEFAULT 0,
  position_in_chain integer NOT NULL DEFAULT 1,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','resolved','dismissed','reassigned')),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledged_by_name text,
  resolved_at timestamptz,
  resolution text,
  -- Stamped when an unacknowledged risk was pushed up to admin.
  escalated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, delay_event_id)
);

CREATE INDEX IF NOT EXISTS brf_open_idx
  ON public.booking_risk_flags (status, scheduled_start_at)
  WHERE status IN ('open','acknowledged');
CREATE INDEX IF NOT EXISTS brf_booking_idx
  ON public.booking_risk_flags (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brf_event_idx
  ON public.booking_risk_flags (delay_event_id);

ALTER TABLE public.booking_risk_flags ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_booking_risk_flags ON public.booking_risk_flags;
CREATE TRIGGER set_timestamp_booking_risk_flags
  BEFORE UPDATE ON public.booking_risk_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 3. The customer heads-up ───────────────────────────────────────────────
-- Prepared at detection, not when the customer starts calling. Never
-- auto-sent by default: a human taps send (admin may enable auto-send for the
-- initial heads-up). The body is editable — what actually went out is archived.

CREATE TABLE IF NOT EXISTS public.booking_risk_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_flag_id uuid NOT NULL REFERENCES public.booking_risk_flags(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email','both')),
  new_eta_at timestamptz,
  -- What the system prepared, and what the human actually sent.
  draft_body text NOT NULL,
  sent_body text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','dismissed','failed')),
  auto_sent boolean NOT NULL DEFAULT false,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  sent_by uuid,
  sent_by_name text,
  dismissed_at timestamptz,
  dismissed_by uuid,
  dismissed_by_name text,
  dismiss_reason text,
  send_error text,
  -- Stamped when nobody sent or dismissed it in time and admin was pulled in.
  escalated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brm_pending_idx
  ON public.booking_risk_messages (status, prepared_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS brm_booking_idx
  ON public.booking_risk_messages (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brm_flag_idx
  ON public.booking_risk_messages (risk_flag_id);

ALTER TABLE public.booking_risk_messages ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_booking_risk_messages ON public.booking_risk_messages;
CREATE TRIGGER set_timestamp_booking_risk_messages
  BEFORE UPDATE ON public.booking_risk_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 4. Backup / on-call coverage ───────────────────────────────────────────
-- Ordinary contractors who indicated they're available that day. No new pay
-- mechanics: if a backup is activated they are simply assigned the job and
-- paid normally per their tier.

CREATE TABLE IF NOT EXISTS public.daily_backup_cleaners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  on_call_date date NOT NULL,
  -- Optional narrowing: which zips/zones this backup is covering that day.
  zips text[] NOT NULL DEFAULT '{}',
  -- Lower sorts first when more than one backup is on call.
  priority integer NOT NULL DEFAULT 100,
  notes text,
  active boolean NOT NULL DEFAULT true,
  activated_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  activated_at timestamptz,
  designated_by uuid,
  designated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cleaner_id, on_call_date)
);

CREATE INDEX IF NOT EXISTS dbc_date_idx
  ON public.daily_backup_cleaners (on_call_date, priority) WHERE active;

ALTER TABLE public.daily_backup_cleaners ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_daily_backup_cleaners ON public.daily_backup_cleaners;
CREATE TRIGGER set_timestamp_daily_backup_cleaners
  BEFORE UPDATE ON public.daily_backup_cleaners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Every coverage move, tied to the delay that forced it.
CREATE TABLE IF NOT EXISTS public.booking_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  from_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  from_cleaner_name text,
  to_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  to_cleaner_name text,
  delay_event_id uuid REFERENCES public.schedule_delay_events(id) ON DELETE SET NULL,
  risk_flag_id uuid REFERENCES public.booking_risk_flags(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  was_designated_backup boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bra_booking_idx
  ON public.booking_reassignments (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bra_created_idx
  ON public.booking_reassignments (created_at DESC);

ALTER TABLE public.booking_reassignments ENABLE ROW LEVEL SECURITY;

-- ─── 5. Learning loop: projected vs actual ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.job_duration_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  service_date date,
  -- Normalized model coordinates, snapshotted so a later reclassification
  -- can't silently rewrite history.
  service_type text NOT NULL,
  home_size_id text,
  condition_level text,
  projected_hours numeric(6,2) NOT NULL CHECK (projected_hours > 0),
  actual_hours numeric(6,2) NOT NULL CHECK (actual_hours > 0),
  variance_hours numeric(6,2) GENERATED ALWAYS AS (actual_hours - projected_hours) STORED,
  variance_pct numeric(7,2) GENERATED ALWAYS AS
    (ROUND((actual_hours - projected_hours) / projected_hours * 100, 2)) STORED,
  scheduled_start_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  -- Minutes past the arrival window the crew actually started: the reliability
  -- half of the signal, kept separate from the duration half.
  started_late_minutes integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jda_model_idx
  ON public.job_duration_actuals (service_type, home_size_id);
CREATE INDEX IF NOT EXISTS jda_cleaner_idx
  ON public.job_duration_actuals (cleaner_id, service_date DESC);
CREATE INDEX IF NOT EXISTS jda_recorded_idx
  ON public.job_duration_actuals (recorded_at DESC);

ALTER TABLE public.job_duration_actuals ENABLE ROW LEVEL SECURITY;

-- ─── 6. RLS: admin/VA read, service role writes ─────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'schedule_delay_events','booking_risk_flags','booking_risk_messages',
    'daily_backup_cleaners','booking_reassignments','job_duration_actuals'
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

-- ─── 7. Crew resolution + the customer message draft ────────────────────────

/** Every cleaner committed to a booking (lead + support), from either source. */
CREATE OR REPLACE FUNCTION public.booking_crew_ids(p_booking_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY(
    SELECT DISTINCT cid FROM (
      SELECT b.cleaner_id AS cid FROM public.bookings b WHERE b.id = p_booking_id
      UNION
      SELECT ja.cleaner_id
      FROM public.job_assignments ja
      JOIN public.bookings b2 ON b2.job_id = ja.job_id
      WHERE b2.id = p_booking_id
        AND public.schedule_committed_assignment_status(ja.status)
    ) q
    WHERE cid IS NOT NULL
  );
$$;

/**
 * The heads-up, prefilled. Names the new window and offers the reschedule —
 * offering the out is what preserves the customer on the days that can't be
 * saved.
 */
CREATE OR REPLACE FUNCTION public.build_delay_customer_message(
  p_first_name text,
  p_eta timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := public.schedule_guard_timezone();
  v_name text := COALESCE(NULLIF(btrim(COALESCE(p_first_name, '')), ''), 'there');
  v_window text;
BEGIN
  v_window := CASE
    WHEN p_eta IS NULL THEN 'later than planned'
    ELSE format('%s–%s',
      to_char(p_eta AT TIME ZONE v_tz, 'FMHH12:MI AM'),
      to_char((p_eta + interval '60 minutes') AT TIME ZONE v_tz, 'FMHH12:MI AM'))
  END;

  RETURN format(
    'Hi %s, it''s NovaraCleaning — a heads up that our team is running behind today. '
    'Your arrival window is now looking like %s. If that no longer works, reply here and '
    'we''ll reschedule to a time that does — we appreciate your patience!',
    v_name, v_window
  );
END;
$$;

-- ─── 8. The cascade walk ────────────────────────────────────────────────────

/**
 * A detected delay ALWAYS walks the crew's downstream schedule for the day.
 *
 * Each remaining booking's arrival is recomputed from when the crew can
 * realistically be free (previous projected end + drive time), every booking
 * that now slips is flagged at risk with its new ETA, and a ready-to-send
 * customer heads-up is prepared for it on the spot. Re-running is safe and
 * expected: as an overrun grows the ETAs and the drafts move with it.
 *
 * Returns the number of downstream bookings currently at risk.
 */
CREATE OR REPLACE FUNCTION public.evaluate_schedule_cascade(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg jsonb := public.schedule_guard_settings();
  v_tz text := public.schedule_guard_timezone();
  v_event record;
  v_up record;
  v_crew uuid[];
  v_now timestamptz := now();
  v_upstream_free timestamptz;
  v_delay_minutes int;
  v_row record;
  v_travel int;
  v_arrival timestamptz;
  v_late int;
  v_position int := 0;
  v_at_risk int := 0;
  v_flag_id uuid;
  v_existing_flag uuid;
  v_prev_status text;
  v_should_alert boolean;
  v_reason text;
  v_prev_lat numeric;
  v_prev_lng numeric;
  v_auto_send boolean := COALESCE(v_cfg ->> 'auto_send_initial_heads_up', 'false') = 'true';
BEGIN
  SELECT * INTO v_event FROM public.schedule_delay_events WHERE id = p_event_id;
  IF v_event.id IS NULL OR v_event.resolved_at IS NOT NULL THEN RETURN 0; END IF;

  SELECT * INTO v_up FROM public.booking_projection_v1 WHERE booking_id = v_event.booking_id;
  IF v_up.booking_id IS NULL OR v_up.scheduled_start_at IS NULL THEN RETURN 0; END IF;

  v_crew := public.booking_crew_ids(v_event.booking_id);
  IF array_length(v_crew, 1) IS NULL THEN RETURN 0; END IF;

  -- When is this crew realistically free?
  --   late start / no-show → the whole job shifts by however late they are
  --     (an unstarted job can't finish before now + its full duration);
  --   overrun            → it is already past projection and still running;
  --   field flag         → the crew told us it is bigger than scoped, so add
  --                        the assumed overrun immediately, without waiting
  --                        for the clock to prove it.
  v_upstream_free := CASE v_event.event_type
    WHEN 'late_start' THEN GREATEST(v_now, v_up.scheduled_start_at)
                             + (v_up.projected_duration_hours || ' hours')::interval
    WHEN 'no_show'    THEN GREATEST(v_now, v_up.scheduled_start_at)
                             + (v_up.projected_duration_hours || ' hours')::interval
    WHEN 'overrun'    THEN GREATEST(v_now, v_up.live_projected_end_at)
                             + (COALESCE(v_event.minutes_over, 0) || ' minutes')::interval
    WHEN 'field_flag' THEN COALESCE(v_up.live_projected_end_at, v_up.projected_end_at)
                             + (COALESCE(v_event.minutes_over,
                                 COALESCE(NULLIF(v_cfg ->> 'field_flag_overrun_minutes', '')::int, 45))
                                || ' minutes')::interval
  END;

  v_delay_minutes := GREATEST(0, FLOOR(
    EXTRACT(EPOCH FROM (v_upstream_free - COALESCE(v_up.projected_end_at, v_up.scheduled_start_at))) / 60
  )::int);

  v_prev_lat := v_up.lat;
  v_prev_lng := v_up.lng;

  FOR v_row IN
    SELECT p.*
    FROM public.booking_projection_v1 p
    WHERE p.service_date = v_up.service_date
      AND p.booking_id <> v_up.booking_id
      AND p.scheduled_start_at IS NOT NULL
      AND p.scheduled_start_at >= v_up.scheduled_start_at
      AND public.schedule_live_booking_status(p.status)
      AND p.check_in_time IS NULL
      AND public.booking_crew_ids(p.booking_id) && v_crew
    ORDER BY p.scheduled_start_at
  LOOP
    v_position := v_position + 1;
    v_travel := public.travel_minutes_between(v_prev_lat, v_prev_lng, v_row.lat, v_row.lng);
    v_arrival := GREATEST(
      v_row.scheduled_start_at,
      v_upstream_free + (COALESCE(v_travel, 0) || ' minutes')::interval
    );
    v_late := FLOOR(EXTRACT(EPOCH FROM (v_arrival - v_row.scheduled_start_at)) / 60)::int;

    -- The crew is busy until this one finishes, whether or not it slipped.
    v_upstream_free := v_arrival + (v_row.projected_duration_hours || ' hours')::interval;
    v_prev_lat := v_row.lat;
    v_prev_lng := v_row.lng;

    IF v_late <= 0 THEN
      -- The buffer absorbed it. Close any risk flag this event had raised.
      UPDATE public.booking_risk_flags
        SET status = 'resolved', resolved_at = now(),
            resolution = 'Recovered — projected arrival is back inside the booked window.'
        WHERE booking_id = v_row.booking_id AND delay_event_id = p_event_id
          AND status IN ('open','acknowledged');
      CONTINUE;
    END IF;

    v_at_risk := v_at_risk + 1;
    v_reason := format(
      '%s running ~%s min over → %s (%s, %s) at risk — projected arrival now ~%s.',
      v_up.booking_ref,
      GREATEST(v_delay_minutes, COALESCE(v_event.minutes_over, v_event.minutes_late, 0)),
      v_row.booking_ref,
      to_char(v_row.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
      COALESCE(NULLIF(btrim(COALESCE(v_row.first_name, '') || ' ' || COALESCE(v_row.last_name, '')), ''), 'client'),
      to_char(v_arrival AT TIME ZONE v_tz, 'FMHH12:MI AM')
    );

    -- One live flag per at-risk booking per upstream cause. A late start that
    -- later becomes a no-show, or an overrun that keeps growing, MOVES the
    -- existing flag — it never stacks a second one, because a second flag
    -- means a second drafted text and a customer hearing from us twice.
    SELECT id, status INTO v_existing_flag, v_prev_status
    FROM public.booking_risk_flags
    WHERE booking_id = v_row.booking_id
      AND upstream_booking_id = v_up.booking_id
      AND (delay_event_id = p_event_id OR status IN ('open','acknowledged'))
    ORDER BY (delay_event_id = p_event_id) DESC, created_at DESC
    LIMIT 1;

    v_should_alert := v_existing_flag IS NULL OR v_prev_status IN ('resolved','dismissed');

    IF v_existing_flag IS NULL THEN
      INSERT INTO public.booking_risk_flags (
        booking_id, delay_event_id, upstream_booking_id, cleaner_id,
        scheduled_start_at, projected_arrival_at, delay_minutes, position_in_chain, reason
      ) VALUES (
        v_row.booking_id, p_event_id, v_up.booking_id, v_crew[1],
        v_row.scheduled_start_at, v_arrival, v_late, v_position, v_reason
      )
      RETURNING id INTO v_flag_id;
    ELSE
      UPDATE public.booking_risk_flags
        SET delay_event_id = p_event_id,
            projected_arrival_at = v_arrival,
            delay_minutes = v_late,
            reason = v_reason,
            position_in_chain = v_position,
            cleaner_id = COALESCE(v_crew[1], cleaner_id),
            -- A recovered-then-slipped-again booking is at risk again.
            status = CASE WHEN status IN ('resolved','dismissed') THEN 'open' ELSE status END,
            resolved_at = CASE WHEN status IN ('resolved','dismissed') THEN NULL ELSE resolved_at END,
            updated_at = now()
        WHERE id = v_existing_flag
      RETURNING id INTO v_flag_id;
    END IF;

    -- Prepare the heads-up the moment the risk is detected. If one is already
    -- pending, keep the row (a VA may be editing it) and just move the ETA and
    -- the untouched draft forward.
    IF NOT EXISTS (
      SELECT 1 FROM public.booking_risk_messages m
      WHERE m.risk_flag_id = v_flag_id AND m.status IN ('sent','dismissed')
    ) THEN
      INSERT INTO public.booking_risk_messages (risk_flag_id, booking_id, channel, new_eta_at, draft_body)
      SELECT v_flag_id, v_row.booking_id,
             CASE WHEN NULLIF(btrim(COALESCE(v_row.phone, '')), '') IS NULL THEN 'email' ELSE 'sms' END,
             v_arrival,
             public.build_delay_customer_message(v_row.first_name, v_arrival)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.booking_risk_messages m2 WHERE m2.risk_flag_id = v_flag_id
      );

      UPDATE public.booking_risk_messages
        SET new_eta_at = v_arrival,
            draft_body = public.build_delay_customer_message(v_row.first_name, v_arrival),
            updated_at = now()
        WHERE risk_flag_id = v_flag_id AND status = 'pending'
          AND draft_body = public.build_delay_customer_message(v_row.first_name, new_eta_at);
    END IF;

    -- Alert the VA through the existing notification channel, once per flag.
    IF v_should_alert THEN
      INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
      VALUES (
        'booking.at_risk', v_row.booking_id, v_row.job_id, v_crew[1], 'schedule-guard',
        format('⏱ %s%sHeads-up text is drafted and waiting in Needs Attention.',
               v_reason, chr(10)),
        jsonb_build_object(
          'risk_flag_id', v_flag_id,
          'delay_event_id', p_event_id,
          'delay_event_type', v_event.event_type,
          'upstream_booking_id', v_up.booking_id,
          'projected_arrival_at', v_arrival,
          'delay_minutes', v_late
        )
      );
    END IF;

    IF v_auto_send THEN
      -- Opt-in only, and only ever for the FIRST heads-up on a flag: the
      -- reschedule conversation that follows is always a human's.
      UPDATE public.booking_risk_messages
        SET status = 'sent', sent_at = now(), auto_sent = true,
            sent_body = draft_body, sent_by_name = 'Auto (initial heads-up)'
        WHERE risk_flag_id = v_flag_id AND status = 'pending';
    END IF;
  END LOOP;

  UPDATE public.schedule_delay_events
    SET downstream_at_risk = v_at_risk,
        last_evaluated_at = now(),
        detail = detail || jsonb_build_object(
          'crew_free_at', v_upstream_free,
          'delay_minutes', v_delay_minutes,
          'walked', v_position
        )
    WHERE id = p_event_id;

  RETURN v_at_risk;
END;
$$;

-- ─── 9. Field flag → immediate cascade ──────────────────────────────────────
-- A cleaner's "this is way bigger than scoped" report is an overrun predictor.
-- It is acted on the instant it lands, without waiting for the clock.

CREATE OR REPLACE FUNCTION public.cascade_on_field_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking record;
  v_assumed int;
  v_event_id uuid;
BEGIN
  IF NEW.reported_via <> 'cleaner_field' THEN RETURN NEW; END IF;
  IF NEW.booking_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_booking FROM public.booking_projection_v1 WHERE booking_id = NEW.booking_id;
  IF v_booking.booking_id IS NULL OR v_booking.scheduled_start_at IS NULL THEN RETURN NEW; END IF;
  IF NOT public.schedule_live_booking_status(v_booking.status) THEN RETURN NEW; END IF;
  -- Only today's (or a future) job can still cascade.
  IF v_booking.service_date < (now() AT TIME ZONE public.schedule_guard_timezone())::date THEN RETURN NEW; END IF;

  v_assumed := COALESCE(
    NULLIF(public.schedule_guard_settings() ->> 'field_flag_overrun_minutes', '')::int, 45);

  INSERT INTO public.schedule_delay_events (
    booking_id, job_id, cleaner_id, event_type, source, scheduled_start_at,
    projected_end_at, minutes_over, qc_issue_id, detail
  ) VALUES (
    NEW.booking_id, v_booking.job_id, NEW.cleaner_id, 'field_flag', 'field_flag',
    v_booking.scheduled_start_at, v_booking.live_projected_end_at, v_assumed, NEW.id,
    jsonb_build_object('qc_issue_type', NEW.issue_type, 'severity', NEW.severity,
                       'title', NEW.title, 'reported_by', NEW.reported_by_name)
  )
  ON CONFLICT (booking_id, event_type) WHERE resolved_at IS NULL
  DO UPDATE SET minutes_over = GREATEST(public.schedule_delay_events.minutes_over, EXCLUDED.minutes_over),
                last_evaluated_at = now(),
                qc_issue_id = COALESCE(public.schedule_delay_events.qc_issue_id, EXCLUDED.qc_issue_id)
  RETURNING id INTO v_event_id;

  INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
  VALUES (
    'schedule.field_flag_cascade', NEW.booking_id, v_booking.job_id, NEW.cleaner_id, 'schedule-guard',
    format('🧾 %s flagged bigger than scoped on %s — treating it as ~%s min over and re-checking the crew''s remaining day now.',
           COALESCE(NEW.cleaner_name, 'The crew'), v_booking.booking_ref, v_assumed),
    jsonb_build_object('qc_issue_id', NEW.id, 'delay_event_id', v_event_id, 'assumed_overrun_minutes', v_assumed)
  );

  PERFORM public.evaluate_schedule_cascade(v_event_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cascade_on_field_flag_trg ON public.qc_issues;
CREATE TRIGGER cascade_on_field_flag_trg
  AFTER INSERT ON public.qc_issues
  FOR EACH ROW EXECUTE FUNCTION public.cascade_on_field_flag();

-- ─── 10. No-show → automatic QC reliability case ────────────────────────────
-- The system opens the case and links it to the job so it feeds the existing
-- accountability ladder (coaching → strike → suspension) and the Novara Score.
-- It does NOT decide the consequence — a human does, from the QC console.

CREATE OR REPLACE FUNCTION public.open_no_show_qc_case(
  p_booking_id uuid,
  p_cleaner_id uuid,
  p_minutes_late integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_b record;
  v_bjson jsonb;
  v_client_type text := 'residential';
  v_cleaner_name text;
  v_issue_id uuid;
  v_involved jsonb := '[]'::jsonb;
  v_title text;
  v_description text;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF v_b.id IS NULL THEN RETURN NULL; END IF;

  -- One system-opened reliability case per booking, ever.
  SELECT id INTO v_issue_id FROM public.qc_issues
    WHERE booking_id = p_booking_id AND issue_type = 'no_show' AND reported_via = 'system'
    LIMIT 1;
  IF v_issue_id IS NOT NULL THEN RETURN v_issue_id; END IF;

  v_bjson := to_jsonb(v_b);
  v_client_type := CASE lower(COALESCE(v_bjson ->> 'booking_type', ''))
    WHEN 'commercial' THEN 'commercial'
    WHEN 'office' THEN 'office'
    WHEN 'str' THEN 'str'
    WHEN 'turnover' THEN 'str'
    ELSE 'residential'
  END;

  SELECT TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
    INTO v_cleaner_name
  FROM public.cleaners c WHERE c.id = p_cleaner_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.cleaner_id, 'name', x.name, 'role', x.role) ORDER BY x.role NULLS LAST), '[]'::jsonb)
    INTO v_involved
  FROM (
    SELECT ja.cleaner_id, ja.role,
           TRIM(COALESCE(c2.first_name, '') || ' ' || COALESCE(c2.last_name, '')) AS name
    FROM public.job_assignments ja
    LEFT JOIN public.cleaners c2 ON c2.id = ja.cleaner_id
    WHERE ja.job_id = v_b.job_id AND public.schedule_committed_assignment_status(ja.status)
  ) x;

  v_title := format('No-show: no start %s min past the arrival window', COALESCE(p_minutes_late, 0));
  v_description := format(
    'Opened automatically by the schedule guard. %s had not marked en route or checked in %s minutes after the '
    'booked arrival window opened on %s (%s), and was unresponsive. The customer heads-up and coverage '
    'suggestions were raised at the same time. Consequence is a human decision — review and act from the '
    'accountability ladder.',
    COALESCE(NULLIF(v_cleaner_name, ''), 'The assigned cleaner'),
    COALESCE(p_minutes_late, 0),
    COALESCE(v_b.service_date::text, 'the service date'),
    COALESCE(v_b.time_slot, v_b.arrival_window, 'window unknown')
  );

  INSERT INTO public.qc_issues (
    booking_id, job_id, client_type, cleaner_id, cleaner_name, cleaners,
    client_name, client_email, booking_ref, issue_type, severity, status,
    title, description, reported_via, reported_by, reported_by_name
  ) VALUES (
    p_booking_id, v_b.job_id, v_client_type, p_cleaner_id, NULLIF(v_cleaner_name, ''),
    CASE WHEN v_involved = '[]'::jsonb AND p_cleaner_id IS NOT NULL
      THEN jsonb_build_array(jsonb_build_object('id', p_cleaner_id, 'name', NULLIF(v_cleaner_name, ''), 'role', NULL))
      ELSE v_involved END,
    NULLIF(TRIM(COALESCE(v_b.first_name, '') || ' ' || COALESCE(v_b.last_name, '')), ''),
    v_b.email,
    public.booking_ref_label(v_b.booking_number, v_b.id),
    'no_show', 'high', 'open',
    v_title, v_description, 'system', NULL, 'Schedule guard'
  )
  RETURNING id INTO v_issue_id;

  INSERT INTO public.qc_issue_events (issue_id, action, to_status, note, actor_id, actor_name, data)
  VALUES (v_issue_id, 'created', 'open', v_description, NULL, 'Schedule guard',
          jsonb_build_object('issue_type', 'no_show', 'severity', 'high', 'via', 'system',
                             'minutes_late', p_minutes_late));

  RETURN v_issue_id;
END;
$$;

-- ─── 11. The sweep ──────────────────────────────────────────────────────────

/**
 * Watches today's active jobs against their projections and keeps the board
 * honest. Runs every few minutes on pg_cron; safe to run by hand.
 *
 *   late start → no en-route/check-in by late_start_minutes past the window
 *   no-show    → still nothing by the firmer no_show_minutes threshold
 *   overrun    → checked in, past the projected end, still not complete
 *
 * Every new or grown event re-walks the crew's downstream schedule. Then it
 * closes what has recovered and escalates what nobody has touched: an at-risk
 * customer sitting in silence is precisely the failure this exists to prevent.
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
  v_late_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'late_start_minutes', '')::int, 15));
  v_noshow_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'no_show_minutes', '')::int, 30));
  v_grace_min int := GREATEST(0, COALESCE(NULLIF(v_cfg ->> 'overrun_grace_minutes', '')::int, 10));
  v_ack_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'risk_ack_escalate_minutes', '')::int, 20));
  v_msg_min int := GREATEST(1, COALESCE(NULLIF(v_cfg ->> 'customer_message_escalate_minutes', '')::int, 20));
  v_row record;
  v_event_id uuid;
  v_crew uuid[];
  v_cleaner_name text;
  v_minutes int;
  v_issue_id uuid;
  v_late_started int := 0;
  v_no_shows int := 0;
  v_overruns int := 0;
  v_resolved int := 0;
  v_escalated_risk int := 0;
  v_escalated_msg int := 0;
  v_at_risk_total int := 0;
BEGIN
  -- ── Late starts and no-shows ──────────────────────────────────────────────
  FOR v_row IN
    SELECT p.*
    FROM public.booking_projection_v1 p
    WHERE p.service_date = v_today
      AND p.scheduled_start_at IS NOT NULL
      AND public.schedule_live_booking_status(p.status)
      AND p.check_in_time IS NULL
      AND p.en_route_at IS NULL
      AND lower(COALESCE(p.status, '')) NOT IN ('in_progress','pending_review')
      AND v_now >= p.scheduled_start_at + (v_late_min || ' minutes')::interval
      AND array_length(public.booking_crew_ids(p.booking_id), 1) >= 1
    ORDER BY p.scheduled_start_at
  LOOP
    v_crew := public.booking_crew_ids(v_row.booking_id);
    v_minutes := FLOOR(EXTRACT(EPOCH FROM (v_now - v_row.scheduled_start_at)) / 60)::int;
    SELECT NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '')
      INTO v_cleaner_name FROM public.cleaners c WHERE c.id = v_crew[1];

    -- Late start first, so the 15-minute alert always precedes the 30-minute
    -- no-show on the record even when the sweep first sees the job late.
    INSERT INTO public.schedule_delay_events (
      booking_id, job_id, cleaner_id, event_type, source,
      scheduled_start_at, projected_end_at, minutes_late
    ) VALUES (
      v_row.booking_id, v_row.job_id, v_crew[1], 'late_start', 'sweep',
      v_row.scheduled_start_at, v_row.projected_end_at, v_minutes
    )
    ON CONFLICT (booking_id, event_type) WHERE resolved_at IS NULL
    DO UPDATE SET minutes_late = EXCLUDED.minutes_late, last_evaluated_at = now()
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.booking_id = v_row.booking_id AND e.event_type = 'schedule.late_start'
          AND e.occurred_at > v_now - interval '12 hours'
      ) THEN
        v_late_started := v_late_started + 1;
        INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
        VALUES ('schedule.late_start', v_row.booking_id, v_row.job_id, v_crew[1], 'schedule-guard',
          format('🕒 %s has no en-route or check-in %s min past its %s window (%s, %s). Checking the crew''s remaining day for knock-on risk.',
                 v_row.booking_ref, v_minutes,
                 to_char(v_row.scheduled_start_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
                 v_row.service_date,
                 COALESCE(v_cleaner_name, 'crew unnamed')),
          jsonb_build_object('delay_event_id', v_event_id, 'minutes_late', v_minutes));
      END IF;
      v_at_risk_total := v_at_risk_total + public.evaluate_schedule_cascade(v_event_id);
    END IF;

    -- ── No-show: the firmer threshold ──────────────────────────────────────
    IF v_minutes >= v_noshow_min THEN
      INSERT INTO public.schedule_delay_events (
        booking_id, job_id, cleaner_id, event_type, source,
        scheduled_start_at, projected_end_at, minutes_late
      ) VALUES (
        v_row.booking_id, v_row.job_id, v_crew[1], 'no_show', 'sweep',
        v_row.scheduled_start_at, v_row.projected_end_at, v_minutes
      )
      ON CONFLICT (booking_id, event_type) WHERE resolved_at IS NULL
      DO UPDATE SET minutes_late = EXCLUDED.minutes_late, last_evaluated_at = now()
      RETURNING id INTO v_event_id;

      IF v_event_id IS NOT NULL AND (SELECT qc_issue_id FROM public.schedule_delay_events WHERE id = v_event_id) IS NULL THEN
        v_no_shows := v_no_shows + 1;
        v_issue_id := public.open_no_show_qc_case(v_row.booking_id, v_crew[1], v_minutes);
        UPDATE public.schedule_delay_events SET qc_issue_id = v_issue_id WHERE id = v_event_id;

        INSERT INTO public.events (event_type, booking_id, job_id, cleaner_id, source, summary, data)
        VALUES ('schedule.no_show', v_row.booking_id, v_row.job_id, v_crew[1], 'schedule-guard',
          format('🚨 NO-SHOW on %s — nothing %s min past the window. Customer heads-up is drafted, coverage suggestions are ready, and a QC reliability case is open for a human call.',
                 v_row.booking_ref, v_minutes),
          jsonb_build_object('delay_event_id', v_event_id, 'qc_issue_id', v_issue_id,
                             'minutes_late', v_minutes));

        -- A no-show customer must hear from us fastest of all: flag this
        -- booking itself, not only the ones behind it.
        INSERT INTO public.booking_risk_flags (
          booking_id, delay_event_id, upstream_booking_id, cleaner_id,
          scheduled_start_at, projected_arrival_at, delay_minutes, position_in_chain, reason
        ) VALUES (
          v_row.booking_id, v_event_id, v_row.booking_id, v_crew[1],
          v_row.scheduled_start_at, v_now + interval '90 minutes', v_minutes, 0,
          format('No-show on %s — nobody has started %s min past the window. Contact the customer now and cover the job.',
                 v_row.booking_ref, v_minutes)
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
    'late_starts', v_late_started,
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

-- ─── 12. Coverage suggestions ───────────────────────────────────────────────

/**
 * Who can cover this booking?
 *
 * Designated backups for the day come first, then everyone else ranked by
 * Novara Score, zone fit, and how much slack their day actually has.
 *
 * HARD filters — never suggested, no matter how good the score:
 *   * not active / not approved / not taking work / suspended
 *   * a schedule exception on that date (day off, sick, vacation)
 *   * the day is not one they work
 *   * stated cutoffs: "can't work after 3pm" is never offered an evening job
 *   * outside their zips and beyond their travel radius
 *   * already at their max jobs for the day
 *
 * A candidate whose own schedule leaves no buffer is still listed — ops
 * sometimes has no better option — but ranked last and clearly marked, so
 * fixing one cascade never quietly starts another.
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
  v_weekday text;
  v_current uuid[];
BEGIN
  SELECT * INTO v_b FROM public.booking_projection_v1 WHERE booking_id = p_booking_id;
  IF v_b.booking_id IS NULL THEN RETURN; END IF;

  v_start := v_b.scheduled_start_at;
  IF v_start IS NULL THEN RETURN; END IF;
  v_end := v_b.projected_end_at;
  v_start_local := (v_start AT TIME ZONE v_tz)::time;
  v_end_local := (v_end AT TIME ZONE v_tz)::time;
  v_weekday := lower(left(to_char(v_b.service_date, 'FMDay'), 3));
  v_current := public.booking_crew_ids(p_booking_id);

  RETURN QUERY
  WITH candidates AS (
    SELECT
      c.id,
      TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cname,
      c.phone, c.email, c.novara_score, c.overall_score, c.home_lat, c.home_lng,
      c.home_zip, c.service_zip_codes, c.max_travel_miles, c.max_jobs_per_day,
      c.preferred_work_days, c.constraints,
      bk.id AS backup_id, bk.priority AS backup_priority,
      public.geo_distance_miles(c.home_lat, c.home_lng, v_b.lat, v_b.lng) AS miles
    FROM public.cleaners c
    LEFT JOIN public.daily_backup_cleaners bk
      ON bk.cleaner_id = c.id AND bk.on_call_date = v_b.service_date AND bk.active
    WHERE c.status = 'active'
      AND COALESCE(c.approved, false)
      AND COALESCE(c.available_for_bookings, true)
      AND NOT (c.id = ANY (v_current))
      -- Day off / sick / vacation on that date.
      AND NOT EXISTS (
        SELECT 1 FROM public.cleaner_schedule_exceptions e
        WHERE e.cleaner_id = c.id AND e.exception_date = v_b.service_date
      )
      -- A day they actually work (when they've stated their days).
      AND (
        c.preferred_work_days IS NULL
        OR cardinality(c.preferred_work_days) = 0
        OR EXISTS (
          SELECT 1 FROM unnest(c.preferred_work_days) d
          WHERE lower(left(btrim(d), 3)) = v_weekday
        )
      )
      -- Stated hard cutoffs. "Can't work after 3pm" never sees an evening job.
      AND (
        NULLIF(c.constraints ->> 'no_work_after', '') IS NULL
        OR v_end_local <= (c.constraints ->> 'no_work_after')::time
      )
      AND (
        NULLIF(c.constraints ->> 'no_work_before', '') IS NULL
        OR v_start_local >= (c.constraints ->> 'no_work_before')::time
      )
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
  loaded AS (
    SELECT
      cd.*,
      (SELECT count(*)::int
         FROM public.booking_projection_v1 p
        WHERE p.service_date = v_b.service_date
          AND p.booking_id <> p_booking_id
          AND public.schedule_live_booking_status(p.status)
          AND cd.id = ANY (public.booking_crew_ids(p.booking_id))) AS day_jobs,
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
          AND cd.id = ANY (public.booking_crew_ids(p.booking_id))) AS nearest_gap
    FROM candidates cd
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

-- ─── 13. Recording actuals ──────────────────────────────────────────────────

/**
 * Projected vs actual on a finished job — the raw material for correcting the
 * duration model. Separately records how late the crew actually started,
 * because a chronically late CLEANER and a chronically under-projected SERVICE
 * TYPE are different problems with different fixes.
 */
CREATE OR REPLACE FUNCTION public.record_job_duration_actual(p_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p record;
  v_b record;
  v_start timestamptz;
  v_end timestamptz;
  v_hours numeric;
  v_id uuid;
BEGIN
  SELECT * INTO v_p FROM public.booking_projection_v1 WHERE booking_id = p_booking_id;
  IF v_p.booking_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;

  v_start := COALESCE(v_p.check_in_time, v_b.check_in_time);
  v_end := COALESCE(
    v_p.check_out_time,
    v_b.check_out_time,
    (to_jsonb(v_b) ->> 'cleaner_marked_complete_at')::timestamptz,
    v_b.completed_at
  );

  -- Without both real timestamps there is no measurement to learn from.
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN RETURN NULL; END IF;

  v_hours := ROUND(EXTRACT(EPOCH FROM (v_end - v_start)) / 3600.0, 2);
  -- Guard against a forgotten checkout turning into a 14-hour "actual" that
  -- would poison the model.
  IF v_hours <= 0 OR v_hours > 14 THEN RETURN NULL; END IF;

  INSERT INTO public.job_duration_actuals (
    booking_id, job_id, cleaner_id, service_date, service_type, home_size_id,
    condition_level, projected_hours, actual_hours, scheduled_start_at,
    actual_start_at, actual_end_at, started_late_minutes
  ) VALUES (
    p_booking_id, v_p.job_id, v_b.cleaner_id, v_p.service_date,
    public.normalize_service_key(v_p.service_type), v_p.home_size_id, v_p.condition_level,
    GREATEST(0.25, v_p.projected_duration_hours), v_hours, v_p.scheduled_start_at,
    v_start, v_end,
    CASE WHEN v_p.scheduled_start_at IS NULL THEN NULL
      ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_start - v_p.scheduled_start_at)) / 60)::int) END
  )
  ON CONFLICT (booking_id) DO UPDATE
    SET actual_hours = EXCLUDED.actual_hours,
        actual_end_at = EXCLUDED.actual_end_at,
        actual_start_at = EXCLUDED.actual_start_at,
        projected_hours = EXCLUDED.projected_hours,
        started_late_minutes = EXCLUDED.started_late_minutes,
        recorded_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_duration_actual_on_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  IF NEW.check_out_time IS NULL OR NEW.check_in_time IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.check_out_time IS NOT DISTINCT FROM NEW.check_out_time THEN RETURN NEW; END IF;

  FOR v_booking_id IN SELECT id FROM public.bookings WHERE job_id = NEW.id LOOP
    PERFORM public.record_job_duration_actual(v_booking_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_duration_actual_on_job_trg ON public.jobs;
CREATE TRIGGER record_duration_actual_on_job_trg
  AFTER UPDATE OF check_out_time ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.record_duration_actual_on_job();

CREATE OR REPLACE FUNCTION public.record_duration_actual_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(COALESCE(NEW.status, '')) NOT IN ('completed','pending_review') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  PERFORM public.record_job_duration_actual(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_duration_actual_on_booking_trg ON public.bookings;
CREATE TRIGGER record_duration_actual_on_booking_trg
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.record_duration_actual_on_booking();

-- ─── 14. Reporting views ────────────────────────────────────────────────────

-- "2,000–2,499 deep cleans run 18% over projection" — the math problem.
CREATE OR REPLACE VIEW public.schedule_duration_variance_v1 AS
SELECT
  a.service_type,
  a.home_size_id,
  count(*)::int                                  AS samples,
  ROUND(avg(a.projected_hours), 2)               AS avg_projected_hours,
  ROUND(avg(a.actual_hours), 2)                  AS avg_actual_hours,
  ROUND(avg(a.variance_pct), 1)                  AS avg_variance_pct,
  ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY a.variance_pct)::numeric, 1) AS median_variance_pct,
  count(*) FILTER (WHERE a.variance_pct > 10)::int AS runs_over_count,
  max(a.recorded_at)                             AS last_recorded_at,
  sda.base_hours,
  sda.learned_multiplier,
  -- What the multiplier WOULD become if the measured average were adopted.
  ROUND(GREATEST(0.5, LEAST(2.5,
    COALESCE(sda.learned_multiplier, 1.0) * (1 + avg(a.variance_pct) / 100.0))), 3) AS suggested_multiplier,
  (count(*) >= COALESCE(NULLIF(public.schedule_guard_settings() ->> 'variance_min_samples', '')::int, 5)
    AND abs(avg(a.variance_pct)) >= 10)          AS chronic
FROM public.job_duration_actuals a
LEFT JOIN public.service_duration_assumptions sda
  ON sda.service_type = a.service_type AND sda.home_size_id = a.home_size_id
GROUP BY a.service_type, a.home_size_id, sda.base_hours, sda.learned_multiplier;

COMMENT ON VIEW public.schedule_duration_variance_v1 IS
  'Chronic projected-vs-actual variance by service type × sqft band. A consistently over-running band is a scoping/pricing signal: correct the duration assumption and the buffers and prices built on it follow.';

-- The other half of the diagnosis: the person problem.
CREATE OR REPLACE VIEW public.schedule_late_start_offenders_v1 AS
SELECT
  c.id                                            AS cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.novara_score,
  count(a.id)::int                                AS measured_jobs,
  count(a.id) FILTER (WHERE a.started_late_minutes >= 15)::int AS late_starts,
  ROUND(
    count(a.id) FILTER (WHERE a.started_late_minutes >= 15)::numeric
    / GREATEST(1, count(a.id)) * 100, 1)          AS late_start_rate_pct,
  ROUND(avg(a.started_late_minutes), 1)           AS avg_late_minutes,
  (SELECT count(*)::int FROM public.schedule_delay_events e
    WHERE e.cleaner_id = c.id AND e.event_type = 'no_show'
      AND e.detected_at > now() - interval '90 days') AS no_shows_90d,
  (SELECT count(*)::int FROM public.schedule_delay_events e
    WHERE e.cleaner_id = c.id AND e.event_type = 'late_start'
      AND e.detected_at > now() - interval '90 days') AS late_events_90d
FROM public.cleaners c
JOIN public.job_duration_actuals a
  ON a.cleaner_id = c.id AND a.service_date > (now() - interval '90 days')::date
GROUP BY c.id, c.first_name, c.last_name, c.novara_score;

COMMENT ON VIEW public.schedule_late_start_offenders_v1 IS
  'Chronic late starts per cleaner over 90 days — a reliability signal that feeds the Novara Score, kept deliberately separate from service-type duration variance so a person problem is never mistaken for a math problem.';

-- The Needs Attention board.
CREATE OR REPLACE VIEW public.schedule_risk_board_v1 AS
SELECT
  f.id                        AS risk_flag_id,
  f.status,
  f.reason,
  f.delay_minutes,
  f.position_in_chain,
  f.scheduled_start_at,
  f.projected_arrival_at,
  f.acknowledged_at,
  f.acknowledged_by_name,
  f.escalated_at,
  f.created_at,
  f.resolved_at,
  f.resolution,
  p.booking_id,
  p.booking_ref,
  p.service_date,
  p.time_slot,
  p.service_type,
  p.home_size_id,
  p.status                    AS booking_status,
  p.first_name,
  p.last_name,
  p.phone,
  p.email,
  p.address,
  p.city,
  p.zip_code,
  p.job_id,
  e.id                        AS delay_event_id,
  e.event_type                AS delay_event_type,
  e.minutes_late,
  e.minutes_over,
  e.detected_at               AS delay_detected_at,
  e.qc_issue_id,
  up.booking_id               AS upstream_booking_id,
  up.booking_ref              AS upstream_booking_ref,
  up.projected_end_at         AS upstream_projected_end_at,
  f.cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.phone                     AS cleaner_phone,
  m.id                        AS message_id,
  m.status                    AS message_status,
  m.channel                   AS message_channel,
  m.draft_body,
  m.sent_body,
  m.new_eta_at,
  m.sent_at,
  m.sent_by_name,
  m.escalated_at              AS message_escalated_at,
  m.prepared_at               AS message_prepared_at
FROM public.booking_risk_flags f
JOIN public.booking_projection_v1 p ON p.booking_id = f.booking_id
JOIN public.schedule_delay_events e ON e.id = f.delay_event_id
LEFT JOIN public.booking_projection_v1 up ON up.booking_id = f.upstream_booking_id
LEFT JOIN public.cleaners c ON c.id = f.cleaner_id
LEFT JOIN LATERAL (
  SELECT * FROM public.booking_risk_messages mm
  WHERE mm.risk_flag_id = f.id
  ORDER BY CASE mm.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, mm.created_at DESC
  LIMIT 1
) m ON true;

COMMENT ON VIEW public.schedule_risk_board_v1 IS
  'Needs Attention: every at-risk booking with the delay that caused it, the computed new ETA, the crew, and the state of the customer heads-up.';

-- ─── 15. Alert routing ──────────────────────────────────────────────────────
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('schedule.late_start',               'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.overrun',                  'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.field_flag_cascade',       'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.no_show',                  'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('booking.at_risk',                   'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('booking.at_risk_customer_notified', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.risk_unacknowledged',      'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.customer_message_unsent',  'DISCORD_WEBHOOK_FLAG',     ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('booking.coverage_reassigned',       'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.backup_designated',        'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('schedule.duration_model_corrected', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- ─── 16. Cron: the sweep ────────────────────────────────────────────────────
-- Pure SQL, so there is no edge-function hop and no shared secret to rotate.
-- Every five minutes: a 15-minute late-start threshold can't be measured by an
-- hourly job.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'schedule-risk-sweep';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('schedule-risk-sweep'); END IF;
  PERFORM cron.schedule(
    'schedule-risk-sweep',
    '*/5 * * * *',
    $cron$ SELECT public.sweep_schedule_risk(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping schedule-risk-sweep cron scheduling: %', SQLERRM;
END $$;
