-- Public hiring applications now collect two things the Applicants table
-- did not store on the row itself:
--   • willing_to_get_supplies / supplies_on_hand — required yes, then a
--     follow-up listing what they already own
--   • government_id_path — private copy of the photo ID (Airtable keeps the
--     attachment; this bucket is the durable file the admin hub opens)

alter table public.cleaner_applicants
  add column if not exists willing_to_get_supplies boolean,
  add column if not exists supplies_on_hand text,
  add column if not exists government_id_path text;

comment on column public.cleaner_applicants.willing_to_get_supplies is
  'Applicant is willing to get the supplies a job requires. Public applications must be yes.';
comment on column public.cleaner_applicants.supplies_on_hand is
  'Supplies the applicant already has. Collected only when willing_to_get_supplies is true.';
comment on column public.cleaner_applicants.government_id_path is
  'Private applicant-ids bucket path for the government-issued photo ID uploaded with the application.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'applicant-ids',
  'applicant-ids',
  false,
  4000000,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
