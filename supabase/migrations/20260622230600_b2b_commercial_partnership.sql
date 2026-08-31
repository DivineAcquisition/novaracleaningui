-- ─── B2B: Commercial / Office / Partnership infrastructure ───────────────
--
-- Adds first-class support for non-residential bookings:
--   • business_accounts — commercial clients, offices, and partnership
--     accounts (property managers, realtors, Airbnb hosts, etc.) with a
--     negotiated default rate, billing terms, and recurring cadence.
--   • bookings columns to tag a booking as residential vs commercial/office/
--     partnership, link it to a business account, and carry the bespoke
--     commercial quote + recurring cadence.
--
-- Residential bookings are unaffected (booking_type defaults to
-- 'residential').

create table if not exists public.business_accounts (
  id uuid primary key default gen_random_uuid(),
  account_type text not null default 'commercial'
    check (account_type in ('commercial', 'office', 'partnership')),
  business_name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip_code text,
  facility_type text,
  square_footage integer,
  -- on_receipt | net_15 | net_30 | custom
  billing_terms text default 'on_receipt',
  -- negotiated per-visit (or per-month) rate in cents
  default_rate_cents integer,
  -- one-time | weekly | biweekly | monthly | quarterly | custom
  recurring_frequency text,
  notes text,
  status text not null default 'active',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_accounts_type_idx on public.business_accounts (account_type);
create index if not exists business_accounts_name_idx on public.business_accounts (lower(business_name));
create index if not exists business_accounts_email_idx on public.business_accounts (lower(email));

-- ─── bookings: B2B columns ──────────────────────────────────────────────
alter table public.bookings
  add column if not exists booking_type text not null default 'residential',
  add column if not exists business_account_id uuid references public.business_accounts(id),
  add column if not exists business_name text,
  add column if not exists facility_type text,
  add column if not exists square_footage integer,
  add column if not exists custom_quote_cents integer,
  add column if not exists is_recurring boolean not null default false,
  add column if not exists recurring_frequency text;

create index if not exists bookings_booking_type_idx on public.bookings (booking_type);
create index if not exists bookings_business_account_idx on public.bookings (business_account_id);

-- ─── RLS: business_accounts ─────────────────────────────────────────────
alter table public.business_accounts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_accounts'
      and policyname = 'admin_va_manage_business_accounts'
  ) then
    create policy admin_va_manage_business_accounts
      on public.business_accounts for all to authenticated
      using (public.is_admin_or_va(auth.uid()))
      with check (public.is_admin_or_va(auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_accounts'
      and policyname = 'service_role_business_accounts'
  ) then
    create policy service_role_business_accounts
      on public.business_accounts for all to service_role
      using (true) with check (true);
  end if;
end $$;
