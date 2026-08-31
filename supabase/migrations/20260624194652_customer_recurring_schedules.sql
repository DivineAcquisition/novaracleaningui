-- ─── Customer recurring cleaning schedules ──────────────────────────────────
-- Memberships only ever auto-booked the FIRST clean; subsequent bi-weekly /
-- weekly / monthly cleans had to be booked by hand. This adds a customer-side
-- recurring engine (parallel to the host/partner `recurring_schedules`) so a
-- confirmed booking is generated automatically each cycle, always assigned to
-- the customer's previous/preferred cleaner, and synced to GHL + Airtable +
-- Google Calendar via the normal booking pipeline.

create table if not exists public.customer_recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  -- Who
  customer_id text,                         -- Stripe customer id (optional)
  email text not null,
  first_name text,
  last_name text,
  phone text,
  -- Where
  address text,
  city text,
  state text,
  zip_code text,
  -- What
  home_size_id text,
  service_type text not null default 'standard',
  add_ons text[] not null default '{}',
  membership_plan text,                      -- 'weekly' | 'biweekly' | 'monthly' | null
  uses_credit boolean not null default false,
  price_cents integer,                       -- per-clean total estimate
  -- Cadence
  cadence text not null default 'biweekly'
    check (cadence in ('weekly', 'biweekly', 'monthly')),
  preferred_time_slot text,                  -- e.g. "9:00 AM - 10:00 AM"
  -- "Always assign the previous cleaner unless the customer requests a new
  -- one" — this pins the cleaner; null falls back to the customer's most
  -- recent completed booking cleaner at generation time.
  preferred_cleaner_id uuid references public.cleaners(id) on delete set null,
  -- Scheduling state
  next_service_date date,                    -- date of the next clean to create
  last_generated_date date,                  -- idempotency guard
  lead_days integer not null default 10,     -- generate when within N days
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_recurring_email_idx on public.customer_recurring_schedules (email);
create index if not exists customer_recurring_active_idx on public.customer_recurring_schedules (active, next_service_date);

-- Link generated bookings back to their schedule (also used for idempotency).
alter table public.bookings
  add column if not exists recurring_schedule_id uuid references public.customer_recurring_schedules(id) on delete set null;
create index if not exists bookings_recurring_schedule_idx on public.bookings (recurring_schedule_id, service_date);

alter table public.customer_recurring_schedules enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='customer_recurring_schedules' and policyname='crs_admin_all') then
    create policy crs_admin_all on public.customer_recurring_schedules for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='customer_recurring_schedules' and policyname='crs_self_read') then
    create policy crs_self_read on public.customer_recurring_schedules for select to authenticated
      using (email = (select email from auth.users where id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='customer_recurring_schedules' and policyname='crs_service_role') then
    create policy crs_service_role on public.customer_recurring_schedules for all to service_role using (true) with check (true);
  end if;
end$$;
