-- Contractor intake settings live in app_settings (key contractor_intake_settings).
-- Disclosures live in app_settings (key contractor_intake_wording) and stay
-- Draft pending legal review until an admin marks a version Reviewed.

alter table public.cleaners
  add column if not exists kit_confirmed boolean,
  add column if not exists background_cleared boolean,
  add column if not exists intake_flow text,
  add column if not exists intake_record jsonb,
  add column if not exists lead_status text,
  add column if not exists lead_track boolean default false,
  add column if not exists identity_image_delete_at timestamptz,
  add column if not exists identity_images_deleted_at timestamptz;

alter table public.cleaner_applicants
  add column if not exists intake_stage text,
  add column if not exists intake_decision jsonb,
  add column if not exists reapply_on date,
  add column if not exists email_consent boolean;

alter table public.bookings
  add column if not exists lead_job boolean default false,
  add column if not exists lead_walkthrough jsonb,
  add column if not exists trial_job boolean default false,
  add column if not exists trial_outcome text,
  add column if not exists trial_report jsonb;

comment on column public.cleaners.intake_flow is
  'automated when the application opened onboarding without a phone screening.';
comment on column public.cleaners.kit_confirmed is
  'False blocks job assignment. Null keeps the older onboarding path.';
comment on column public.bookings.lead_job is
  'Lead share and helper share are calculated separately. Solo jobs stay on the tier rate.';

create table if not exists public.contractor_data_requests (
  id uuid primary key default gen_random_uuid(),
  applicant_email text,
  cleaner_id uuid,
  kind text not null check (kind in ('see', 'correct', 'delete')),
  status text not null default 'open',
  due_on date,
  note text,
  created_at timestamptz not null default now()
);

alter table public.contractor_data_requests enable row level security;

CREATE OR REPLACE FUNCTION public.cleaner_ready_for_first_job(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c.completed_bookings, 0) > 0
      OR (
        COALESCE(c.kit_confirmed, true)
        AND COALESCE(c.background_cleared, true)
        AND COALESCE(c.ob_agreement_signed, false)
        AND COALESCE(c.phone_verified, false)
        AND (c.supply_checklist_submitted_at IS NOT NULL
          OR COALESCE(c.ob_supplies_checklist_viewed, false))
        AND (COALESCE(c.ob_dress_code_ack, false)
          OR COALESCE(c.ob_job_day_guides_ack, false))
        AND COALESCE(c.ob_job_day_guides_ack, false)
        AND c.w9_status = 'complete'
        AND COALESCE(c.ob_training_complete, false)
      )
  FROM public.cleaners c
  WHERE c.id = p_id
$$;
