-- ─── Phase 3 + 5 read APIs + Phase 4 event fan-out ──────────────────────
-- 100% additive. No existing table/column/trigger changes. Every new
-- object is a NEW function, view, or row-insert trigger that writes to
-- the events table. Existing dispatch/payroll/onboarding paths are
-- untouched.
--
-- Adds:
--   * Phase 3 read RPCs: scorecard, compliance, tier eligibility,
--     earnings, calendar, availability, zone capacity, by-zone listing
--   * Phase 5 report views: daily / weekly / monthly metrics, lead
--     funnel, recurring customers, payroll period, heatmap aggregates
--   * Phase 4 event fan-out: AFTER INSERT/UPDATE triggers on leads,
--     bookings, sms_logs, job_assignments that write a row to
--     public.events so the realtime activity feed lights up without
--     any application code changes

-- =====================================================================
-- PHASE 3 READ RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_cleaner_scorecard(_cleaner_id UUID)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c RECORD; jobs_completed INT; cancel_count INT; total_assigned INT;
  cancel_rate NUMERIC; months_service NUMERIC; open_flags INT;
BEGIN
  SELECT * INTO c FROM public.cleaners WHERE id = _cleaner_id;
  IF c IS NULL THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO jobs_completed FROM public.job_assignments WHERE cleaner_id = _cleaner_id AND status = 'completed';
  SELECT COUNT(*) INTO total_assigned FROM public.job_assignments WHERE cleaner_id = _cleaner_id;
  SELECT COUNT(*) INTO cancel_count FROM public.job_assignments WHERE cleaner_id = _cleaner_id AND status IN ('declined','withdrawn','cancelled');
  cancel_rate := CASE WHEN total_assigned > 0 THEN ROUND((cancel_count::NUMERIC / total_assigned) * 100, 1) ELSE 0 END;
  months_service := CASE
    WHEN c.start_date IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (now() - c.start_date::TIMESTAMPTZ)) / (60*60*24*30), 1)
    WHEN c.activated_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (now() - c.activated_at)) / (60*60*24*30), 1)
    ELSE NULL END;
  SELECT COUNT(*) INTO open_flags FROM public.cleaner_flags WHERE cleaner_id = _cleaner_id AND resolved = FALSE;
  RETURN jsonb_build_object(
    'cleaner_id', c.id, 'name', trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),
    'status', c.status, 'pay_tier', coalesce(c.pay_tier, 'foundation'),
    'pay_rate_hr', c.pay_rate_hr, 'platform_fee_pct', c.platform_fee_pct, 'net_rate_hr', c.net_rate_hr,
    'total_jobs_completed', jobs_completed, 'total_bookings', coalesce(c.total_bookings, 0),
    'average_rating', c.average_rating, 'total_ratings', c.total_ratings,
    'on_time_rate', c.on_time_rate, 'acceptance_rate', c.acceptance_rate,
    'cancellation_rate_pct', cancel_rate, 'no_show_count', coalesce(c.no_show_count, 0),
    'customer_complaint_count', coalesce(c.customer_complaint_count, 0),
    'months_of_service', months_service, 'workload_score', c.workload_score,
    'weighted_score', c.weighted_score, 'jobs_assigned_last_7d', coalesce(c.jobs_assigned_last_7d, 0),
    'open_flags', open_flags,
    'background_check_status', coalesce(c.background_check_status,'pending'),
    'background_check_expires_at', c.background_check_expires_at,
    'insurance_verified', coalesce(c.insurance_verified, false),
    'insurance_expires_at', c.insurance_expires_at, 'updated_at', c.updated_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_cleaner_compliance(_cleaner_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'cleaner_id', id,
    'background_check_status', coalesce(background_check_status, 'pending'),
    'background_check_date', background_check_date,
    'background_check_expires_at', background_check_expires_at,
    'background_check_days_left', CASE WHEN background_check_expires_at IS NOT NULL THEN (background_check_expires_at - CURRENT_DATE) ELSE NULL END,
    'background_check_flag', CASE
      WHEN background_check_expires_at IS NULL THEN 'unknown'
      WHEN background_check_expires_at < CURRENT_DATE THEN 'expired'
      WHEN background_check_expires_at <= CURRENT_DATE + 30 THEN 'expiring_soon'
      ELSE 'ok' END,
    'insurance_verified', coalesce(insurance_verified, false),
    'insurance_carrier', insurance_carrier, 'insurance_policy_number', insurance_policy_number,
    'insurance_expires_at', insurance_expires_at,
    'insurance_days_left', CASE WHEN insurance_expires_at IS NOT NULL THEN (insurance_expires_at - CURRENT_DATE) ELSE NULL END,
    'insurance_flag', CASE
      WHEN insurance_verified IS NOT TRUE THEN 'unverified'
      WHEN insurance_expires_at IS NULL THEN 'unknown'
      WHEN insurance_expires_at < CURRENT_DATE THEN 'expired'
      WHEN insurance_expires_at <= CURRENT_DATE + 30 THEN 'expiring_soon'
      ELSE 'ok' END
  )
  FROM public.cleaners WHERE id = _cleaner_id;
$$;

CREATE OR REPLACE FUNCTION public.check_tier_eligibility(_cleaner_id UUID)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD; jobs_completed INT; months_service NUMERIC;
BEGIN
  SELECT * INTO c FROM public.cleaners WHERE id = _cleaner_id;
  IF c IS NULL THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO jobs_completed FROM public.job_assignments WHERE cleaner_id = _cleaner_id AND status = 'completed';
  months_service := CASE
    WHEN c.start_date IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - c.start_date::TIMESTAMPTZ)) / (60*60*24*30)
    WHEN c.activated_at IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - c.activated_at)) / (60*60*24*30)
    ELSE 0 END;
  RETURN jsonb_build_object(
    'current_tier', coalesce(c.pay_tier, 'foundation'),
    'foundation_to_proven', jsonb_build_object(
      'months_tenure_required', 6, 'months_tenure_actual', round(months_service, 1), 'months_tenure_met', months_service >= 6,
      'jobs_required', 25, 'jobs_actual', jobs_completed, 'jobs_met', jobs_completed >= 25,
      'on_time_required_pct', 90, 'on_time_actual_pct', c.on_time_rate, 'on_time_met', (c.on_time_rate IS NOT NULL AND c.on_time_rate >= 90),
      'rating_required', 4.8, 'rating_actual', c.average_rating, 'rating_met', (c.average_rating IS NOT NULL AND c.average_rating >= 4.8),
      'eligible', (months_service >= 6 AND jobs_completed >= 25 AND coalesce(c.on_time_rate,0) >= 90 AND coalesce(c.average_rating,0) >= 4.8)
    ),
    'proven_to_elite', jsonb_build_object(
      'months_tenure_required', 12, 'months_tenure_actual', round(months_service, 1), 'months_tenure_met', months_service >= 12,
      'jobs_required', 50, 'jobs_actual', jobs_completed, 'jobs_met', jobs_completed >= 50,
      'on_time_required_pct', 95, 'on_time_actual_pct', c.on_time_rate, 'on_time_met', (c.on_time_rate IS NOT NULL AND c.on_time_rate >= 95),
      'rating_required', 4.8, 'rating_actual', c.average_rating, 'rating_met', (c.average_rating IS NOT NULL AND c.average_rating >= 4.8),
      'eligible', (months_service >= 12 AND jobs_completed >= 50 AND coalesce(c.on_time_rate,0) >= 95 AND coalesce(c.average_rating,0) >= 4.8)
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_cleaner_earnings(_cleaner_id UUID, _start DATE, _end DATE)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  daily JSONB; total_jobs INT := 0;
  total_gross_cents BIGINT := 0; total_fee_cents BIGINT := 0; total_net_cents BIGINT := 0;
BEGIN
  WITH per_day AS (
    SELECT
      coalesce(b.service_date, ja.assigned_at::DATE) AS day,
      COUNT(*) AS jobs,
      SUM(coalesce(ja.estimated_pay_cents, 0)) AS gross_cents,
      SUM(round(coalesce(ja.estimated_pay_cents,0) * coalesce(cl.platform_fee_pct, 0.10))::BIGINT) AS fee_cents,
      SUM(round(coalesce(ja.estimated_pay_cents,0) * (1 - coalesce(cl.platform_fee_pct, 0.10)))::BIGINT) AS net_cents
    FROM public.job_assignments ja
    LEFT JOIN public.jobs j ON j.id = ja.job_id
    LEFT JOIN public.bookings b ON b.job_id = ja.job_id
    JOIN public.cleaners cl ON cl.id = ja.cleaner_id
    WHERE ja.cleaner_id = _cleaner_id
      AND coalesce(b.service_date, ja.assigned_at::DATE) BETWEEN _start AND _end
      AND ja.status IN ('completed','assigned','accepted')
    GROUP BY 1 ORDER BY 1
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object('day', day, 'jobs', jobs, 'gross_cents', gross_cents, 'fee_cents', fee_cents, 'net_cents', net_cents)), '[]'::jsonb),
    coalesce(SUM(jobs), 0)::INT, coalesce(SUM(gross_cents), 0)::BIGINT,
    coalesce(SUM(fee_cents), 0)::BIGINT, coalesce(SUM(net_cents), 0)::BIGINT
  INTO daily, total_jobs, total_gross_cents, total_fee_cents, total_net_cents FROM per_day;

  RETURN jsonb_build_object(
    'cleaner_id', _cleaner_id, 'period_start', _start, 'period_end', _end,
    'totals', jsonb_build_object('jobs', total_jobs, 'gross_cents', total_gross_cents, 'fee_cents', total_fee_cents, 'net_cents', total_net_cents),
    'daily', daily
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_cleaner_calendar(_cleaner_id UUID, _start DATE, _end DATE)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  WITH days AS (SELECT (_start + g)::DATE AS day FROM generate_series(0, (_end - _start)) AS g),
  assigned AS (
    SELECT b.service_date AS day,
         jsonb_agg(jsonb_build_object(
           'booking_id', b.id, 'booking_number', b.booking_number,
           'service_type', b.service_type, 'time_slot', b.time_slot,
           'address', b.address, 'city', b.city,
           'estimated_hours', b.estimated_duration_hours,
           'estimated_pay_cents', ja.estimated_pay_cents
         ) ORDER BY b.time_slot) AS jobs,
         COUNT(*) AS job_count,
         COALESCE(SUM(b.estimated_duration_hours), 0)::NUMERIC AS total_hours,
         COALESCE(SUM(ja.estimated_pay_cents), 0)::BIGINT AS estimated_pay_cents
    FROM public.job_assignments ja
    JOIN public.bookings b ON b.job_id = ja.job_id
    WHERE ja.cleaner_id = _cleaner_id
      AND b.service_date BETWEEN _start AND _end
      AND ja.status IN ('assigned','accepted','en_route','in_progress','completed')
    GROUP BY b.service_date
  ),
  exceptions AS (
    SELECT exception_date AS day,
         jsonb_agg(jsonb_build_object('type', type, 'reason', reason, 'start_time', start_time, 'end_time', end_time)) AS exceptions
    FROM public.cleaner_schedule_exceptions
    WHERE cleaner_id = _cleaner_id AND exception_date BETWEEN _start AND _end
    GROUP BY exception_date
  )
  SELECT jsonb_agg(jsonb_build_object(
    'date', d.day, 'weekday', trim(to_char(d.day, 'Day')),
    'jobs', COALESCE(a.jobs, '[]'::jsonb),
    'job_count', COALESCE(a.job_count, 0),
    'total_hours', COALESCE(a.total_hours, 0),
    'estimated_pay_cents', COALESCE(a.estimated_pay_cents, 0),
    'exceptions', COALESCE(e.exceptions, '[]'::jsonb)
  ) ORDER BY d.day) INTO result
  FROM days d LEFT JOIN assigned a ON a.day = d.day LEFT JOIN exceptions e ON e.day = d.day;

  RETURN jsonb_build_object('cleaner_id', _cleaner_id, 'start', _start, 'end', _end, 'days', COALESCE(result, '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.get_cleaner_availability(_cleaner_id UUID, _date DATE)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD; exc RECORD; job_count INT; max_per_day INT; weekday_label TEXT;
BEGIN
  SELECT * INTO c FROM public.cleaners WHERE id = _cleaner_id;
  IF c IS NULL THEN RETURN NULL; END IF;
  max_per_day := COALESCE(c.max_jobs_per_day, 3);
  weekday_label := lower(trim(to_char(_date, 'Day')));
  SELECT * INTO exc FROM public.cleaner_schedule_exceptions WHERE cleaner_id = _cleaner_id AND exception_date = _date;
  SELECT COUNT(*) INTO job_count FROM public.job_assignments ja
    JOIN public.bookings b ON b.job_id = ja.job_id
    WHERE ja.cleaner_id = _cleaner_id AND b.service_date = _date
      AND ja.status IN ('assigned','accepted','en_route','in_progress','completed');
  RETURN jsonb_build_object(
    'cleaner_id', _cleaner_id, 'date', _date,
    'available', (
      exc IS NULL
      AND (c.preferred_work_days IS NULL OR weekday_label = ANY (c.preferred_work_days::text[])
        OR weekday_label = ANY (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday']))
      AND c.status = 'active' AND COALESCE(c.available_for_bookings, true) = true
    ),
    'exception', CASE WHEN exc IS NOT NULL THEN jsonb_build_object('type', exc.type, 'reason', exc.reason) ELSE NULL END,
    'jobs_assigned', job_count, 'max_jobs_per_day', max_per_day,
    'remaining_capacity', GREATEST(0, max_per_day - job_count),
    'weekday', weekday_label
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_zone_capacity(_zip TEXT, _date DATE)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE total_cleaners INT := 0; available_cleaners INT := 0; jobs_booked INT := 0; remaining INT := 0;
BEGIN
  SELECT COUNT(*) INTO total_cleaners FROM public.cleaners
    WHERE status = 'active' AND (_zip = ANY (service_zip_codes) OR home_zip = _zip);
  SELECT COUNT(*) INTO available_cleaners FROM public.cleaners c
    WHERE c.status = 'active' AND COALESCE(c.available_for_bookings, true) = true
      AND (_zip = ANY (c.service_zip_codes) OR c.home_zip = _zip)
      AND NOT EXISTS (SELECT 1 FROM public.cleaner_schedule_exceptions e WHERE e.cleaner_id = c.id AND e.exception_date = _date);
  SELECT COUNT(*) INTO jobs_booked FROM public.bookings
    WHERE zip_code = _zip AND service_date = _date AND status IN ('booked','confirmed','pending_details');
  remaining := GREATEST(0, available_cleaners * 3 - jobs_booked);
  RETURN jsonb_build_object(
    'zip', _zip, 'date', _date, 'active_cleaners_total', total_cleaners,
    'available_cleaners_today', available_cleaners, 'jobs_booked', jobs_booked,
    'estimated_capacity_remaining', remaining
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_cleaners_by_zone(_zip TEXT)
RETURNS TABLE (
  id UUID, first_name TEXT, last_name TEXT, status TEXT, pay_tier TEXT,
  average_rating NUMERIC, on_time_rate NUMERIC, jobs_assigned_last_7d INT,
  available_for_bookings BOOLEAN, home_zip TEXT, status_today TEXT
) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, first_name, last_name, status, coalesce(pay_tier,'foundation'),
     average_rating, on_time_rate, jobs_assigned_last_7d,
     available_for_bookings, home_zip, status_today
  FROM public.cleaners
  WHERE status = 'active' AND (_zip = ANY (service_zip_codes) OR home_zip = _zip)
  ORDER BY weighted_score DESC NULLS LAST, average_rating DESC NULLS LAST;
$$;

-- =====================================================================
-- PHASE 5 REPORTING VIEWS
-- =====================================================================

CREATE OR REPLACE VIEW public.daily_metrics_v1 AS
SELECT
  d::DATE AS day,
  (SELECT COUNT(*) FROM public.leads l WHERE l.created_at::DATE = d::DATE) AS new_leads,
  (SELECT COUNT(*) FROM public.sms_logs s WHERE s.created_at::DATE = d::DATE) AS sms_sent,
  (SELECT COUNT(*) FROM public.sms_inbound_log si WHERE si.created_at::DATE = d::DATE) AS sms_received,
  (SELECT COUNT(*) FROM public.bookings b WHERE b.created_at::DATE = d::DATE AND b.status IN ('booked','confirmed','pending_details')) AS bookings_created,
  (SELECT COUNT(*) FROM public.bookings b WHERE b.cancelled_at::DATE = d::DATE) AS bookings_cancelled,
  (SELECT COUNT(*) FROM public.bookings b WHERE b.completed_at::DATE = d::DATE) AS jobs_completed,
  (SELECT COALESCE(SUM(b.total_estimate_cents), 0) FROM public.bookings b WHERE b.completed_at::DATE = d::DATE) AS revenue_completed_cents,
  (SELECT COALESCE(SUM(b.total_estimate_cents), 0) FROM public.bookings b WHERE b.created_at::DATE = d::DATE AND b.status IN ('booked','confirmed','pending_details')) AS revenue_booked_cents
FROM generate_series(CURRENT_DATE - INTERVAL '365 days', CURRENT_DATE, INTERVAL '1 day') AS d;

CREATE OR REPLACE VIEW public.weekly_metrics_v1 AS
SELECT
  date_trunc('week', d.day)::DATE AS week_start,
  SUM(new_leads)::INT AS new_leads, SUM(sms_sent)::INT AS sms_sent, SUM(sms_received)::INT AS sms_received,
  SUM(bookings_created)::INT AS bookings_created, SUM(bookings_cancelled)::INT AS bookings_cancelled,
  SUM(jobs_completed)::INT AS jobs_completed,
  SUM(revenue_completed_cents)::BIGINT AS revenue_completed_cents,
  SUM(revenue_booked_cents)::BIGINT AS revenue_booked_cents
FROM public.daily_metrics_v1 d GROUP BY 1 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW public.monthly_metrics_v1 AS
SELECT
  date_trunc('month', d.day)::DATE AS month_start,
  SUM(new_leads)::INT AS new_leads, SUM(bookings_created)::INT AS bookings_created,
  SUM(bookings_cancelled)::INT AS bookings_cancelled, SUM(jobs_completed)::INT AS jobs_completed,
  SUM(revenue_completed_cents)::BIGINT AS revenue_completed_cents,
  SUM(revenue_booked_cents)::BIGINT AS revenue_booked_cents,
  ROUND(CASE WHEN SUM(new_leads) > 0 THEN SUM(bookings_created)::NUMERIC / SUM(new_leads) * 100 ELSE 0 END, 1) AS conversion_pct
FROM public.daily_metrics_v1 d GROUP BY 1 ORDER BY 1 DESC;

CREATE OR REPLACE VIEW public.lead_funnel_v1 AS
SELECT
  COALESCE(l.source, 'unknown') AS source,
  COUNT(*) AS leads_created,
  COUNT(*) FILTER (WHERE l.last_call_at IS NOT NULL OR l.speed_to_lead_sms_sent_at IS NOT NULL) AS leads_contacted,
  COUNT(*) FILTER (WHERE l.status IN ('replied','contacted','callback','booked')) AS leads_responded,
  COUNT(*) FILTER (WHERE l.status = 'booked') AS leads_booked,
  COUNT(*) FILTER (WHERE l.existing_customer_id IS NOT NULL) AS converted_to_customer,
  ROUND(CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE l.status = 'booked')::NUMERIC / COUNT(*) * 100 ELSE 0 END, 1) AS booking_conversion_pct
FROM public.leads l WHERE l.created_at > CURRENT_DATE - INTERVAL '180 days'
GROUP BY 1 ORDER BY leads_created DESC;

CREATE OR REPLACE VIEW public.recurring_customers_v1 AS
SELECT
  c.id AS customer_id, trim(c.first_name || ' ' || COALESCE(c.last_name, '')) AS name,
  c.email, c.phone, c.city, c.state, c.zip,
  COALESCE(c.membership_plan, 'none') AS membership_plan,
  c.membership_status, c.preferred_day_of_week, c.preferred_time_window,
  (SELECT COUNT(*) FROM public.bookings b WHERE b.customer_id::TEXT = c.id::TEXT AND b.status = 'completed') AS total_cleans,
  (SELECT MAX(b.service_date) FROM public.bookings b WHERE b.customer_id::TEXT = c.id::TEXT AND b.status = 'completed') AS last_clean_date,
  (SELECT MIN(b.service_date) FROM public.bookings b WHERE b.customer_id::TEXT = c.id::TEXT AND b.service_date > CURRENT_DATE AND b.status IN ('booked','confirmed')) AS next_clean_date,
  (SELECT COALESCE(SUM(b.total_estimate_cents),0) FROM public.bookings b WHERE b.customer_id::TEXT = c.id::TEXT AND b.status = 'completed') AS lifetime_revenue_cents,
  CASE
    WHEN c.membership_status = 'cancelled' THEN 'churned'
    WHEN c.membership_status = 'paused' THEN 'paused'
    WHEN (SELECT MAX(b.service_date) FROM public.bookings b WHERE b.customer_id::TEXT = c.id::TEXT AND b.status = 'completed') < CURRENT_DATE - INTERVAL '60 days' THEN 'at_risk'
    WHEN c.membership_status = 'active' THEN 'active' ELSE 'unknown'
  END AS health
FROM public.customers c
WHERE c.membership_plan IS NOT NULL
  OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id::TEXT = c.id::TEXT AND b.frequency != 'one-time')
ORDER BY total_cleans DESC NULLS LAST;

CREATE OR REPLACE FUNCTION public.cleaner_payroll_report(_period_start DATE, _period_end DATE)
RETURNS TABLE (
  cleaner_id UUID, cleaner_name TEXT, pay_tier TEXT, hourly_rate NUMERIC,
  jobs INT, total_hours NUMERIC, gross_cents BIGINT, platform_fee_cents BIGINT,
  net_cents BIGINT, by_day JSONB
) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH per_job AS (
    SELECT cl.id AS cleaner_id,
      trim(cl.first_name || ' ' || COALESCE(cl.last_name, '')) AS cleaner_name,
      COALESCE(cl.pay_tier, 'foundation') AS pay_tier,
      cl.pay_rate_hr, cl.platform_fee_pct,
      b.service_date AS day, ja.estimated_pay_cents,
      COALESCE(b.estimated_duration_hours, 0)::NUMERIC AS hours
    FROM public.job_assignments ja
    JOIN public.cleaners cl ON cl.id = ja.cleaner_id
    JOIN public.bookings b ON b.job_id = ja.job_id
    WHERE b.service_date BETWEEN _period_start AND _period_end
      AND ja.status IN ('completed','accepted','assigned','en_route','in_progress')
  )
  SELECT p.cleaner_id, MAX(p.cleaner_name), MAX(p.pay_tier), MAX(p.pay_rate_hr),
    COUNT(*)::INT AS jobs, SUM(p.hours)::NUMERIC AS total_hours,
    SUM(p.estimated_pay_cents)::BIGINT AS gross_cents,
    SUM(round(p.estimated_pay_cents * COALESCE(p.platform_fee_pct, 0.10))::BIGINT) AS platform_fee_cents,
    SUM(round(p.estimated_pay_cents * (1 - COALESCE(p.platform_fee_pct, 0.10)))::BIGINT) AS net_cents,
    jsonb_agg(jsonb_build_object('day', p.day, 'hours', p.hours, 'gross_cents', p.estimated_pay_cents) ORDER BY p.day) AS by_day
  FROM per_job p GROUP BY p.cleaner_id ORDER BY gross_cents DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.heatmap_leads_by_zip(_start DATE, _end DATE)
RETURNS TABLE (zip_code TEXT, lead_count INT, no_response_count INT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(zip_code, 'unknown') AS zip_code, COUNT(*)::INT AS lead_count,
    COUNT(*) FILTER (WHERE last_call_at IS NULL AND created_at < now() - INTERVAL '48 hours' AND status NOT IN ('booked'))::INT AS no_response_count
  FROM public.leads WHERE created_at::DATE BETWEEN _start AND _end
  GROUP BY 1 ORDER BY lead_count DESC;
$$;

CREATE OR REPLACE FUNCTION public.heatmap_bookings_by_zip(_start DATE, _end DATE)
RETURNS TABLE (zip_code TEXT, booking_count INT, revenue_cents BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(zip_code, 'unknown') AS zip_code, COUNT(*)::INT AS booking_count,
    COALESCE(SUM(total_estimate_cents), 0)::BIGINT AS revenue_cents
  FROM public.bookings
  WHERE created_at::DATE BETWEEN _start AND _end
   AND status IN ('booked','confirmed','completed','pending_details')
  GROUP BY 1 ORDER BY revenue_cents DESC;
$$;

CREATE OR REPLACE FUNCTION public.heatmap_cleaner_density()
RETURNS TABLE (zip_code TEXT, cleaner_count INT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH unnested AS (
    SELECT unnest(COALESCE(service_zip_codes, ARRAY[home_zip])) AS zip
    FROM public.cleaners WHERE status = 'active'
  )
  SELECT zip AS zip_code, COUNT(*)::INT AS cleaner_count
  FROM unnested WHERE zip IS NOT NULL
  GROUP BY zip ORDER BY cleaner_count DESC;
$$;

-- =====================================================================
-- PHASE 4 EVENT FAN-OUT TRIGGERS
-- Every booking / lead / SMS / status change auto-writes to public.events
-- so the realtime activity feed lights up without touching app code.
-- Triggers swallow exceptions so they cannot block the underlying op.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fan_out_booking_event() RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.events (event_type, booking_id, zone, source, summary, data)
      VALUES ('booking.created', NEW.id, NEW.state, 'pg_trigger',
        'Booking ' || COALESCE('NOV-' || lpad(NEW.booking_number::TEXT, 5, '0'), NEW.id::TEXT)
          || ' — ' || COALESCE(NEW.service_type, 'cleaning')
          || ' on ' || NEW.service_date || ' ' || COALESCE(NEW.time_slot, ''),
        jsonb_build_object(
          'status', NEW.status, 'service_date', NEW.service_date, 'time_slot', NEW.time_slot,
          'service_type', NEW.service_type, 'home_size_id', NEW.home_size_id,
          'total_estimate_cents', NEW.total_estimate_cents,
          'channel', NEW.booking_channel, 'source', NEW.booker_source
        ));
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.events (event_type, booking_id, zone, source, summary, data)
      VALUES ('booking.status_change', NEW.id, NEW.state, 'pg_trigger',
        'Booking ' || COALESCE('NOV-' || lpad(NEW.booking_number::TEXT, 5, '0'), NEW.id::TEXT)
          || ' — ' || COALESCE(OLD.status, '?') || ' → ' || COALESCE(NEW.status, '?'),
        jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_fan_out_events ON public.bookings;
CREATE TRIGGER bookings_fan_out_events
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.fan_out_booking_event();

CREATE OR REPLACE FUNCTION public.fan_out_lead_event() RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.events (event_type, lead_id, source, summary, data)
      VALUES ('lead.created', NEW.id, 'pg_trigger',
        'New ' || COALESCE(NEW.source, 'unknown') || ' lead — ' || COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''),
        jsonb_build_object('source', NEW.source, 'zip', NEW.zip_code, 'phone', NEW.phone, 'lead_score', NEW.lead_score));
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.events (event_type, lead_id, source, summary, data)
      VALUES ('lead.status_change', NEW.id, 'pg_trigger',
        'Lead ' || COALESCE(NEW.first_name, '') || ' — ' || COALESCE(OLD.status, '?') || ' → ' || COALESCE(NEW.status, '?'),
        jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_fan_out_events ON public.leads;
CREATE TRIGGER leads_fan_out_events
  AFTER INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fan_out_lead_event();

CREATE OR REPLACE FUNCTION public.fan_out_sms_event() RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.events (event_type, source, summary, data)
    VALUES (
      CASE WHEN NEW.delivery_status = 'inbound' THEN 'sms.received' ELSE 'sms.sent' END,
      'pg_trigger', LEFT(COALESCE(NEW.message, ''), 80),
      jsonb_build_object('to_phone', NEW.to_phone, 'type', NEW.type, 'status', NEW.status));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sms_logs_fan_out_events ON public.sms_logs;
CREATE TRIGGER sms_logs_fan_out_events
  AFTER INSERT ON public.sms_logs
  FOR EACH ROW EXECUTE FUNCTION public.fan_out_sms_event();

CREATE OR REPLACE FUNCTION public.fan_out_job_assignment_event() RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.events (event_type, job_id, cleaner_id, source, summary, data)
      VALUES ('job.status_change', NEW.job_id, NEW.cleaner_id, 'pg_trigger',
        'Job assignment — ' || COALESCE(OLD.status, '?') || ' → ' || COALESCE(NEW.status, '?'),
        jsonb_build_object('from', OLD.status, 'to', NEW.status, 'cleaner_id', NEW.cleaner_id, 'job_id', NEW.job_id));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS job_assignments_fan_out_events ON public.job_assignments;
CREATE TRIGGER job_assignments_fan_out_events
  AFTER UPDATE OF status ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fan_out_job_assignment_event();

COMMENT ON FUNCTION public.get_cleaner_scorecard IS 'Phase-3: full scorecard for a cleaner profile (read-only).';
COMMENT ON FUNCTION public.cleaner_payroll_report IS 'Phase-5: pay-period payroll aggregation. Read-only — does NOT execute payouts.';
COMMENT ON VIEW public.daily_metrics_v1 IS 'Phase-5: per-day funnel metrics for the last 365 days. Source for the admin Dashboard + reports.';
