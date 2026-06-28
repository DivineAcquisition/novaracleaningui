-- ─── Cleaner crews + day-of (30-min) reminder plumbing ──────────────────────
--
-- Two related pieces of ops infrastructure:
--
--   1. Crews / groups. Cleaners can be organised into a named crew with a lead.
--      This powers (a) admin grouping and (b) the contractor portal "hand the
--      clean to someone in my crew" action — a lead can re-assign one of their
--      jobs to another cleaner in the same crew without ops involvement.
--
--   2. A day-of reminder stamp on bookings so the new send-day-of-reminders
--      sweep (which texts the customer AND the assigned cleaner ~30 minutes
--      before the arrival window starts) is idempotent and never double-texts.

-- ─── crews ──────────────────────────────────────────────────────────────────
create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lead_cleaner_id uuid references public.cleaners(id) on delete set null,
  color text,                       -- optional hex for admin UI chips
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each cleaner belongs to at most one crew.
alter table public.cleaners
  add column if not exists crew_id uuid references public.crews(id) on delete set null;
create index if not exists cleaners_crew_idx on public.cleaners (crew_id);

alter table public.crews enable row level security;

do $$
begin
  -- Admin / VA: full control.
  if not exists (select 1 from pg_policies where tablename='crews' and policyname='crews_admin_all') then
    create policy crews_admin_all on public.crews for all to authenticated
      using (public.is_admin_or_va(auth.uid())) with check (public.is_admin_or_va(auth.uid()));
  end if;
  -- Service role: full control (edge functions).
  if not exists (select 1 from pg_policies where tablename='crews' and policyname='crews_service_role') then
    create policy crews_service_role on public.crews for all to service_role using (true) with check (true);
  end if;
  -- Any authenticated user may READ crews (the contractor portal lists the
  -- cleaner's crewmates; no sensitive data lives on the crew row itself).
  if not exists (select 1 from pg_policies where tablename='crews' and policyname='crews_read') then
    create policy crews_read on public.crews for select to authenticated using (true);
  end if;
end$$;

drop trigger if exists update_crews_updated_at on public.crews;
create trigger update_crews_updated_at
  before update on public.crews
  for each row execute function public.update_updated_at_column();

-- ─── day-of reminder stamp ───────────────────────────────────────────────────
alter table public.bookings
  add column if not exists day_of_reminder_sent_at timestamptz;

notify pgrst, 'reload schema';
