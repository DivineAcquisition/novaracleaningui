-- Catalog add-ons get a QC record (same hub as site findings / complaints).
-- Recurring/membership visits must not inherit a Deep job type from the first clean.

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_issue_type_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_issue_type_check
  CHECK (issue_type IN (
    'complaint',
    'reclean',
    'damage',
    'no_show',
    'late',
    'quality_flag',
    'payment',
    'other',
    'site_finding',
    'addon'
  ));

COMMENT ON COLUMN public.qc_issues.details IS
  'Structured payload for typed issues. site_finding: finding type, location, photos, pricing. addon: catalog add-on lines, amounts, charge status, photos — dispute-packet documentation, not a quality complaint.';

CREATE UNIQUE INDEX IF NOT EXISTS qc_issues_one_addon_doc_per_booking
  ON public.qc_issues (booking_id)
  WHERE issue_type = 'addon';

CREATE INDEX IF NOT EXISTS qc_issues_addon_idx
  ON public.qc_issues (issue_type, created_at DESC)
  WHERE issue_type = 'addon';

-- Calvin Beckett NVC-0016 (Aug 14 membership visit): booking is standard /
-- recurring but the job was left on deep from the original first-clean clone.
UPDATE public.jobs
SET service_type = 'standard'
WHERE id = '8095a1f3-3088-4571-b4bc-ab6bb456d0fa'
  AND service_type IS DISTINCT FROM 'standard';

INSERT INTO public.events (event_type, booking_id, job_id, source, summary, data)
SELECT
  'job.service_type_corrected',
  '41360491-6a66-470e-a34b-93515b8bffd4',
  '8095a1f3-3088-4571-b4bc-ab6bb456d0fa',
  'system',
  'NVC-0016 — job was left on Deep after this membership visit was converted to a Standard/maintenance clean. Job service type corrected to standard. The completed Deep checklist is left as historical (the crew actually worked that list). Future visits use the maintenance list.',
  jsonb_build_object('from', 'deep', 'to', 'standard', 'reason', 'membership_maintenance_visit')
WHERE NOT EXISTS (
  SELECT 1 FROM public.events
  WHERE event_type = 'job.service_type_corrected'
    AND job_id = '8095a1f3-3088-4571-b4bc-ab6bb456d0fa'
);

-- Backfill one addon QC documentation row per booking that already has add-ons.
INSERT INTO public.qc_issues (
  booking_id,
  job_id,
  client_type,
  cleaner_id,
  cleaner_name,
  cleaners,
  client_name,
  client_email,
  booking_ref,
  issue_type,
  severity,
  status,
  title,
  description,
  details,
  reported_via,
  reported_by_name,
  resolution_note,
  resolved_at,
  resolved_by_name
)
SELECT
  b.id,
  b.job_id,
  public.booking_client_type(b.booking_type, b.partner_details),
  NULL,
  NULL,
  '[]'::jsonb,
  NULLIF(trim(both from concat_ws(' ', b.first_name, b.last_name)), ''),
  b.email,
  CASE
    WHEN b.booking_number IS NOT NULL THEN 'NVC-' || lpad(b.booking_number::text, 4, '0')
    ELSE 'Job ' || left(b.id::text, 8)
  END,
  'addon',
  'low',
  'resolved',
  left('Add-ons: ' || array_to_string(b.add_ons, ', '), 200),
  'Catalog add-ons on this job. This QC record is the dispute-packet entry for extra services (not a quality complaint).' || E'\n\n' ||
    array_to_string(ARRAY(SELECT '• ' || x FROM unnest(b.add_ons) AS x), E'\n'),
  jsonb_build_object(
    'kind', 'addon',
    'addons', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', x,
        'label', x,
        'source', 'booked',
        'amount_cents', NULL,
        'charge_status', NULL,
        'charge_id', NULL,
        'added_at', b.created_at
      )), '[]'::jsonb)
      FROM unnest(b.add_ons) AS x
      WHERE x IS NOT NULL AND x <> '' AND x NOT LIKE 'site_finding_%'
    ),
    'total_cents', 0,
    'before_photo_urls', coalesce(to_jsonb(b.before_photos), '[]'::jsonb),
    'after_photo_urls', coalesce(to_jsonb(b.after_photos), '[]'::jsonb)
  ),
  'system',
  'Add-on documentation',
  'Documented on the QC record for the dispute packet — not a quality complaint.',
  now(),
  'System'
FROM public.bookings b
WHERE b.add_ons IS NOT NULL
  AND cardinality(b.add_ons) > 0
  AND EXISTS (
    SELECT 1 FROM unnest(b.add_ons) AS x
    WHERE x IS NOT NULL AND x <> '' AND x NOT LIKE 'site_finding_%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.qc_issues q
    WHERE q.booking_id = b.id AND q.issue_type = 'addon'
  );
