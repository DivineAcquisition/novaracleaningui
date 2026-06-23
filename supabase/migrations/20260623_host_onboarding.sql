-- ─── STR Host Onboarding submissions ─────────────────────────────────────
--
-- Single source of truth for the host onboarding form. Captures the host,
-- their properties, and the click-wrap consent evidence (timestamp + IP +
-- user-agent), then fans out to GoHighLevel (CRM + contract) and Airtable
-- (ops). Lifecycle is enforced server-side so no one signs a blank-rate
-- schedule: submitted → pending_pricing → agreement_sent → signed.

create table if not exists public.host_onboarding_submissions (
  id uuid primary key default gen_random_uuid(),

  -- Host identity
  full_name text not null,
  email text not null,
  phone text not null,
  -- THE contract branch driver.
  entity_type text not null default 'individual'
    check (entity_type in ('individual', 'entity')),
  entity_name text,                         -- required when entity_type='entity'
  service_zone text,

  -- Properties captured at submit (rates are admin-set later, never here).
  -- Array of { nickname, address, bedrooms, bathrooms, sqft, linen, restock,
  --            access_type, access_instructions, staging_notes }
  properties jsonb not null default '[]'::jsonb,

  -- Click-wrap consent evidence trail.
  consent_agreement boolean not null default false,
  consent_timestamp timestamptz,
  consent_ip text,
  consent_user_agent text,

  -- Lifecycle (server-enforced sequencing).
  status text not null default 'submitted'
    check (status in ('submitted', 'pending_pricing', 'agreement_sent', 'signed', 'cancelled')),
  agreement_signed_at timestamptz,

  -- Downstream fan-out ids (for idempotent re-sync / patching).
  ghl_contact_id text,
  ghl_opportunity_id text,
  airtable_client_id text,
  airtable_property_ids jsonb not null default '[]'::jsonb,

  -- Partial-failure retry trail.
  sync_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists host_onboarding_email_idx on public.host_onboarding_submissions (lower(email));
create index if not exists host_onboarding_status_idx on public.host_onboarding_submissions (status);

-- Keep updated_at fresh.
create or replace function public.touch_host_onboarding_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_host_onboarding_touch on public.host_onboarding_submissions;
create trigger trg_host_onboarding_touch
  before update on public.host_onboarding_submissions
  for each row execute function public.touch_host_onboarding_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────
-- All writes flow through server-side routes (service role). Admin/VA can
-- read for the ops queue; the public can INSERT their own application so the
-- form works without a login (the server still re-validates everything).
alter table public.host_onboarding_submissions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='host_onboarding_submissions' and policyname='host_onb_service_role') then
    create policy host_onb_service_role on public.host_onboarding_submissions
      for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='host_onboarding_submissions' and policyname='host_onb_admin_read') then
    create policy host_onb_admin_read on public.host_onboarding_submissions
      for select to authenticated using (public.is_admin_or_va(auth.uid()));
  end if;
end $$;
