-- Live-update QC cases on admin hubs (Recurring membership profiles, etc.).
-- Safe to re-run: skip tables already in the supabase_realtime publication.

do $$
declare
  t text;
begin
  foreach t in array array[
    'qc_issues',
    'job_documentation',
    'membership_credits',
    'customer_recurring_schedules'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
