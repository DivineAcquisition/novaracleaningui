-- ─── Partner Turnover Portal — enhancements ──────────────────────────────
--
-- Adds the columns needed for the reliability + lifecycle enhancements:
--   • cleaner_confirmed_at  — set when the assigned cleaner replies YES (SMS)
--   • started_at            — set on cleaner check-in (in_progress)
--   • completed_at          — already existed; kept here for older DBs
--   • before_photos / after_photos — JSON arrays of storage URLs
--   • host_rating / host_review / rated_at — host's post-clean feedback
--   • reschedule_count / last_rescheduled_at — host self-serve reschedules
--
-- Safe to run multiple times.

alter table public.turnover_requests
  add column if not exists cleaner_confirmed_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists before_photos jsonb not null default '[]'::jsonb,
  add column if not exists after_photos jsonb not null default '[]'::jsonb,
  add column if not exists host_rating int check (host_rating between 1 and 5),
  add column if not exists host_review text,
  add column if not exists rated_at timestamptz,
  add column if not exists reschedule_count int not null default 0,
  add column if not exists last_rescheduled_at timestamptz;

-- ─── Turnover photos storage bucket ──────────────────────────────────────
-- Cleaners upload before/after proof; hosts view it from their dashboard.
insert into storage.buckets (id, name, public)
values ('turnover-photos', 'turnover-photos', true)
on conflict (id) do nothing;

do $$
begin
  -- Public read (bucket is public; URLs are unguessable UUID paths).
  if not exists (select 1 from pg_policies where tablename='objects' and policyname='turnover_photos_public_read') then
    create policy turnover_photos_public_read on storage.objects for select
      using (bucket_id = 'turnover-photos');
  end if;
  -- Authenticated cleaners/admins upload (writes are also done server-side
  -- via the service role on the partner-turnover function).
  if not exists (select 1 from pg_policies where tablename='objects' and policyname='turnover_photos_auth_write') then
    create policy turnover_photos_auth_write on storage.objects for insert to authenticated
      with check (bucket_id = 'turnover-photos');
  end if;
end $$;
