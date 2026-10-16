-- Hiring applications now record the compliance answers and the exact
-- wording the applicant agreed to. submission.consentRecord keeps the same
-- payload if these columns are not present yet; the apply route falls back
-- to that jsonb.

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

comment on column public.cleaner_applicants.age_18 is
  'Applicant confirmed they are 18 or older. The form does not collect a birth date.';
comment on column public.cleaner_applicants.valid_drivers_license is
  'Applicant confirmed a valid driver''s license, in addition to having their own car.';
comment on column public.cleaner_applicants.auto_insured is
  'Applicant confirmed the car they drive to jobs is insured.';
comment on column public.cleaner_applicants.sms_consent is
  'Applicant agreed to occasional texts and calls about the application, with STOP to opt out.';
comment on column public.cleaner_applicants.answers_accurate is
  'Applicant attested that the application answers are true and complete.';
comment on column public.cleaner_applicants.consent_version is
  'Version of the consent wording shown on the application.';
comment on column public.cleaner_applicants.consent_accepted_at is
  'When the applicant submitted the agreed wording.';
comment on column public.cleaner_applicants.consent_ip is
  'Client IP captured with the consent record.';
comment on column public.cleaner_applicants.consent_user_agent is
  'User agent captured with the consent record.';
comment on column public.cleaner_applicants.consent_record is
  'Versioned consent record: flags, exact texts, timestamp, IP, and user agent.';
