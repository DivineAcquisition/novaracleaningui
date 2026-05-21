-- Fix: the Phase-3 RPCs used lowercase status values for job_assignments
-- ('assigned','accepted','en_route','in_progress','completed') but the
-- existing dispatch system (dispatch-job, respond-to-offer, job-check-in)
-- writes Capitalized values ('Offered','Accepted','Confirmed','In Progress',
-- 'Completed','Declined'). Without this fix the scorecard/calendar/
-- payroll/earnings RPCs would return zero rows for every existing cleaner.
--
-- Patch every affected RPC to use lower(status) comparisons so they
-- work both with legacy capitalized data and any future lowercase
-- migrations. The new edge functions (cleaner-admin-action,
-- update-job-status, cleaner-schedule-exception) were also redeployed
-- at v2 with matching capitalized values for their write paths.

CREATE OR REPLACE FUNCTION public.get_cleaner_scorecard(_cleaner_id UUID)
RETURNS JSONB LANGUAGE PLPGSQL STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c RECORD; jobs_completed INT; cancel_count INT; total_assigned INT;
  cancel_rate NUMERIC; months_service NUMERIC; open_flags INT;
BEGIN
  SELECT * INTO c FROM public.cleaners WHERE id = _cleaner_id;
  IF c IS NULL THEN RETURN NULL; END IF;
  SELECT COUNT(*) INTO jobs_completed FROM public.job_assignments WHERE cleaner_id = _cleaner_id AND lower(status) = 'completed';
  SELECT COUNT(*) INTO total_assigned FROM public.job_assignments WHERE cleaner_id = _cleaner_id;
  SELECT COUNT(*) INTO cancel_count FROM public.job_assignments WHERE cleaner_id = _cleaner_id AND lower(status) IN ('declined','withdrawn','cancelled','needs reassignment');
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

-- (similar lowercase->lower(status) fixes for get_cleaner_earnings,
-- get_cleaner_calendar, get_cleaner_availability, cleaner_payroll_report
-- were applied via the same MCP transaction; full DDL in supabase project
-- migration history)
