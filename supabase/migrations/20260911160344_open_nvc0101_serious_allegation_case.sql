-- Idempotent insert of the NVC-0101 serious-allegation case.
-- Source booking, photos, GHL, comms, and contractor rows are not updated.
-- Safe to re-run: no-ops if the case or the booking is missing.

INSERT INTO public.qc_issues (
  booking_id, job_id, documentation_id, client_type,
  cleaner_id, cleaner_name, cleaners,
  client_name, client_email, booking_ref,
  issue_type, severity, status,
  title, description, reported_via, reported_by_name,
  details
)
SELECT
  b.id,
  b.job_id,
  d.id,
  'residential',
  c.id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')),
  jsonb_build_array(jsonb_build_object(
    'id', c.id,
    'name', TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')),
    'role', 'Lead'
  )),
  TRIM(COALESCE(b.first_name, '') || ' ' || COALESCE(b.last_name, '')),
  b.email,
  'NVC-0101',
  'serious_allegation',
  'critical',
  'investigating',
  'Serious allegation: pet injury during scheduled clean, plus service quality complaints',
  $desc$Client alleged the contractor injured her pet (Kevin) during the scheduled clean on 2026-09-09 at 12793 Jones Lane, Waldorf, MD 20602, alongside multiple service quality complaints. The contractor denies the allegation. No neutral witnesses. Veterinary records expected. This case is evidence assembly only. It is not a finding. Opening it applies no Novara Score penalty and no accountability action.$desc$,
  'admin',
  'Malik Sannie',
  jsonb_build_object(
    'allegation_not_finding', true,
    'no_auto_score_penalty', true,
    'no_auto_accountability', true,
    'no_auto_suspension', true,
    'insurance_notification_is_prompt_only', true,
    'source_records_retrieved_only', true,
    'job_snapshot', jsonb_build_object(
      'booking_id', b.id,
      'booking_number', b.booking_number,
      'status', b.status,
      'cancel_reason', b.cancel_reason,
      'service_date', b.service_date,
      'time_slot', b.time_slot,
      'arrival_window', b.arrival_window,
      'delay_minutes', b.delay_minutes,
      'service_type', b.service_type,
      'add_ons', to_jsonb(b.add_ons),
      'pets', b.pets,
      'address', concat_ws(', ', b.address, b.city, b.state, b.zip_code),
      'assigned_contractor_id', c.id,
      'check_in_time', b.check_in_time,
      'completed_at', b.completed_at,
      'cancelled_at', b.cancelled_at,
      'before_photo_count', cardinality(b.before_photos),
      'after_photo_count', cardinality(b.after_photos)
    ),
    'contractor_snapshot_at_open', jsonb_build_object(
      'id', c.id,
      'status', c.status,
      'novara_score', c.novara_score,
      'quality_score', c.quality_score,
      'overall_score', c.overall_score
    )
  )
FROM public.bookings b
JOIN public.cleaners c ON c.id = b.cleaner_id
LEFT JOIN public.job_documentation d ON d.booking_id = b.id
WHERE b.id = '085d3e27-c421-4b1d-9280-c2eafe31d983'
  AND NOT EXISTS (
    SELECT 1 FROM public.qc_issues q
    WHERE q.booking_id = b.id AND q.issue_type = 'serious_allegation'
  );

INSERT INTO public.qc_issue_events (issue_id, action, to_status, note, actor_name, data)
SELECT q.id, 'created', q.status,
  'Case opened for evidence assembly. Allegation is not a finding. No Score penalty. No accountability action. No automatic suspension.',
  'Malik Sannie',
  jsonb_build_object(
    'issue_type', 'serious_allegation',
    'severity', 'critical',
    'via', 'admin',
    'allegation_not_finding', true,
    'no_auto_score_penalty', true,
    'no_auto_accountability', true
  )
FROM public.qc_issues q
WHERE q.booking_id = '085d3e27-c421-4b1d-9280-c2eafe31d983'
  AND q.issue_type = 'serious_allegation'
  AND NOT EXISTS (
    SELECT 1 FROM public.qc_issue_events e
    WHERE e.issue_id = q.id AND e.action = 'created'
  );
