-- ─── Partner Turnover Portal (partner.novaracleaning.com) ────────────────
--
-- Self-serve portal for Airbnb / short-term-rental hosts to register
-- properties and request per-turnover cleanings. Reuses the existing
-- `cleaners` table (no duplicate cleaner records), SMS sender, Discord
-- notifier, and Stripe account. New tables only.
--
-- Pricing, payment, and assignment are all enforced server-side (see the
-- partner-turnover edge function). Host writes go through that function
-- (service role); hosts can READ their own rows via RLS but cannot write
-- directly — this is how we prevent hosts from self-pricing a property.

-- ─── Hosts ───────────────────────────────────────────────────────────────
create table if not exists public.hosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,                       -- auth.users id (login)
  name text,
  email text,
  phone text,
  stripe_customer_id text,
  status text not null default 'active' check (status in ('active', 'paused', 'blocked')),
  created_at timestamptz not null default now()
);
create index if not exists hosts_user_id_idx on public.hosts (user_id);
create index if not exists hosts_email_idx on public.hosts (lower(email));

-- ─── Properties ──────────────────────────────────────────────────────────
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts(id) on delete cascade,
  nickname text,
  address text,
  access_instructions text,
  bedrooms int,
  bathrooms numeric,
  sqft int,
  laundry_included boolean not null default false,
  restock_included boolean not null default false,
  -- Per-turnover price set by ADMIN. NULL = "pending pricing" → not bookable.
  turnover_price numeric,
  special_notes text,
  created_at timestamptz not null default now()
);
create index if not exists properties_host_idx on public.properties (host_id);

-- ─── Turnover requests ─────────────────────────────────────────────────────
create table if not exists public.turnover_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  host_id uuid not null references public.hosts(id),
  requested_date date not null,
  window_start time,
  window_end time,
  price numeric not null default 0,           -- locked from property at request time
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','assigned','cleaner_confirmed','in_progress','completed','cancelled','unassigned_alert')),
  assigned_cleaner_id uuid references public.cleaners(id),
  assignment_type text check (assignment_type in ('preferred','auto','manual')),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  paid_at timestamptz,
  completed_at timestamptz,
  assigned_at timestamptz,
  assigned_by uuid,                            -- admin user id on manual override
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists turnover_requests_host_idx on public.turnover_requests (host_id);
create index if not exists turnover_requests_property_idx on public.turnover_requests (property_id);
create index if not exists turnover_requests_status_idx on public.turnover_requests (status);
create index if not exists turnover_requests_cleaner_idx on public.turnover_requests (assigned_cleaner_id);
create index if not exists turnover_requests_session_idx on public.turnover_requests (stripe_checkout_session_id);

-- ─── Turnover crew (assignment preferences) ────────────────────────────────
create table if not exists public.turnover_crew (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid not null references public.cleaners(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,  -- set = preferred for THIS property
  is_turnover_crew boolean not null default true,
  priority int not null default 100,           -- lower = tried first
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists turnover_crew_cleaner_idx on public.turnover_crew (cleaner_id);
create index if not exists turnover_crew_property_idx on public.turnover_crew (property_id);

-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Hosts read their own data; admin/va see everything; the service role
-- (edge function) does all writes. No direct host writes → no self-pricing.
alter table public.hosts enable row level security;
alter table public.properties enable row level security;
alter table public.turnover_requests enable row level security;
alter table public.turnover_crew enable row level security;

do $$
begin
  -- hosts
  if not exists (select 1 from pg_policies where tablename='hosts' and policyname='hosts_self_read') then
    create policy hosts_self_read on public.hosts for select to authenticated
      using (user_id = auth.uid() or public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='hosts' and policyname='hosts_admin_all') then
    create policy hosts_admin_all on public.hosts for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='hosts' and policyname='hosts_service_role') then
    create policy hosts_service_role on public.hosts for all to service_role using (true) with check (true);
  end if;

  -- properties
  if not exists (select 1 from pg_policies where tablename='properties' and policyname='properties_self_read') then
    create policy properties_self_read on public.properties for select to authenticated
      using (host_id in (select id from public.hosts where user_id = auth.uid()) or public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='properties' and policyname='properties_admin_all') then
    create policy properties_admin_all on public.properties for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='properties' and policyname='properties_service_role') then
    create policy properties_service_role on public.properties for all to service_role using (true) with check (true);
  end if;

  -- turnover_requests
  if not exists (select 1 from pg_policies where tablename='turnover_requests' and policyname='tr_self_read') then
    create policy tr_self_read on public.turnover_requests for select to authenticated
      using (host_id in (select id from public.hosts where user_id = auth.uid()) or public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='turnover_requests' and policyname='tr_admin_all') then
    create policy tr_admin_all on public.turnover_requests for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='turnover_requests' and policyname='tr_service_role') then
    create policy tr_service_role on public.turnover_requests for all to service_role using (true) with check (true);
  end if;

  -- turnover_crew (admin/va + service role only)
  if not exists (select 1 from pg_policies where tablename='turnover_crew' and policyname='crew_admin_all') then
    create policy crew_admin_all on public.turnover_crew for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='turnover_crew' and policyname='crew_service_role') then
    create policy crew_service_role on public.turnover_crew for all to service_role using (true) with check (true);
  end if;
end $$;
