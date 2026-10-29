-- The hiring form already writes these consent answers. The live
-- applicant table was missing them, so activation could not load the row.

alter table public.cleaner_applicants
  add column if not exists age_18 boolean,
  add column if not exists valid_drivers_license boolean,
  add column if not exists auto_insured boolean,
  add column if not exists sms_consent boolean,
  add column if not exists answers_accurate boolean,
  add column if not exists consent_version text,
  add column if not exists consent_accepted_at timestamptz,
  add column if not exists consent_ip text,
  add column if not exists consent_user_agent text,
  add column if not exists consent_record jsonb;
