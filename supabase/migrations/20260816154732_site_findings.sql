-- Pest (light) / mold (minor) site findings — QC entry type, not a parallel system.
--
-- Confirmed-minor findings are billable in-scope work. They reuse qc_issues
-- (new issue_type), the pricing engine (Focused Clean area rate or Heavy
-- condition), booking photo arrays (dispute packet), and customer email/SMS.
-- Active infestation, bed bugs, or mold past the size/porosity threshold still
-- go through the existing stop-and-report field_report path.

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.qc_issues.details IS
  'Structured payload for typed issues. site_finding carries finding type, location, size confirmation, before/after photo URLs, pricing path + amounts, and recurrence — the same record the dispute packet and customer notice read from.';

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
    'site_finding'
  ));

CREATE INDEX IF NOT EXISTS qc_issues_site_finding_idx
  ON public.qc_issues (issue_type, created_at DESC)
  WHERE issue_type = 'site_finding';

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'site_finding_notice_templates',
  jsonb_build_object(
    'email_subject', 'A quick update on today''s clean',
    'email_body_priced',
      'Hi {name}, during today''s visit our team found {finding} in {location} and handled it as part of the clean. This reflects a {adjustment} adjustment to today''s total, bringing it to {new_total}. Before and after photos are on file.{recurrence} Thanks!',
    'email_body_info',
      'Hi {name}, during today''s visit our team found {finding} in {location} and handled it as part of the clean. Today''s total is unchanged. Before and after photos are on file.{recurrence} Thanks!',
    'sms_priced',
      'Hi {name}, quick note — we found {finding_sms} in {location} during today''s clean and handled it. This added {delta} to today''s total ({new_total} final). Photos on file. Thanks!',
    'sms_info',
      'Hi {name}, quick note — we found {finding_sms} in {location} during today''s clean and handled it. No change to today''s total. Photos on file. Thanks!',
    'mold_recurrence_sentence',
      ' If you notice this returning in the same spot, it can sometimes point to a moisture issue worth having looked at.'
  ),
  'Customer email/SMS copy for pest (light) and mold (minor) site findings. Placeholders: {name} {finding} {finding_sms} {location} {adjustment} {delta} {new_total} {recurrence}. Auto-filled from the QC record — never a generic description.'
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    value = COALESCE(public.app_settings.value, '{}'::jsonb) || EXCLUDED.value;
