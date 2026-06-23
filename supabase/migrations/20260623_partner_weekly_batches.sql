-- ─── Partner Weekly Schedule + Recurring (add-on) ────────────────────────
--
-- Builds on the partner turnover portal. A host can book a whole week of
-- turnovers in one batch (one payment) and/or set up repeating weekly
-- schedules that auto-generate + auto-charge. Reuses hosts, properties,
-- turnover_requests, the assignment engine, and notifications.
--
-- All pricing/totals are computed server-side from each property's current
-- turnover_price. Turnovers are only created as `paid` once their batch is
-- paid. Batches + recurring generation are idempotent.

-- ── BookingBatch: groups the turnovers paid together for one week ─────────
create table if not exists public.booking_batches (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts(id) on delete cascade,
  week_start date not null,                       -- Monday of the booked week
  source text not null default 'manual' check (source in ('manual','recurring')),
  recurring_schedule_id uuid,                     -- set for recurring-source batches
  turnover_count int not null default 0,
  total_amount numeric not null default 0,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','payment_failed','partially_assigned','complete')),
  created_at timestamptz not null default now()
);
create index if not exists booking_batches_host_idx on public.booking_batches (host_id);
create index if not exists booking_batches_week_idx on public.booking_batches (week_start);
create index if not exists booking_batches_session_idx on public.booking_batches (stripe_checkout_session_id);

-- ── RecurringSchedule: a repeating weekly pattern for one property ────────
create table if not exists public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  days_of_week int[] not null default '{}',       -- 0=Sun .. 6=Sat (JS getDay)
  window_start time,
  window_end time,
  price_snapshot numeric,                          -- informational; live price used at generation
  active boolean not null default true,
  paused_until date,                               -- skip generation up to this week
  last_generated_week date,                        -- prevents double-generation
  heads_up_week date,                              -- last week a pre-charge heads-up was sent
  created_at timestamptz not null default now()
);
create index if not exists recurring_schedules_host_idx on public.recurring_schedules (host_id);
create index if not exists recurring_schedules_active_idx on public.recurring_schedules (active);

-- ── Group batched turnovers ───────────────────────────────────────────────
alter table public.turnover_requests
  add column if not exists batch_id uuid references public.booking_batches(id) on delete set null;
create index if not exists turnover_requests_batch_idx on public.turnover_requests (batch_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.booking_batches enable row level security;
alter table public.recurring_schedules enable row level security;

do $$
begin
  -- booking_batches
  if not exists (select 1 from pg_policies where tablename='booking_batches' and policyname='bb_self_read') then
    create policy bb_self_read on public.booking_batches for select to authenticated
      using (host_id in (select id from public.hosts where user_id = auth.uid()) or public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='booking_batches' and policyname='bb_admin_all') then
    create policy bb_admin_all on public.booking_batches for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='booking_batches' and policyname='bb_service_role') then
    create policy bb_service_role on public.booking_batches for all to service_role using (true) with check (true);
  end if;

  -- recurring_schedules
  if not exists (select 1 from pg_policies where tablename='recurring_schedules' and policyname='rs_self_read') then
    create policy rs_self_read on public.recurring_schedules for select to authenticated
      using (host_id in (select id from public.hosts where user_id = auth.uid()) or public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='recurring_schedules' and policyname='rs_admin_all') then
    create policy rs_admin_all on public.recurring_schedules for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='recurring_schedules' and policyname='rs_service_role') then
    create policy rs_service_role on public.recurring_schedules for all to service_role using (true) with check (true);
  end if;
end $$;
