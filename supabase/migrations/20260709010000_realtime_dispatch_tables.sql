-- ─── Realtime for dispatch / ops tables ─────────────────────────────────
--
-- The contractor portal (and the admin Dispatch console) subscribe to
-- postgres_changes on job_assignments / bookings / jobs / job_checklists,
-- but the supabase_realtime publication only ever contained
-- availability_slots + events — so none of those subscriptions fired and
-- the portal looked "dead" while dispatching was happening.
--
-- postgres_changes respects RLS, so cleaners only receive events for rows
-- they can already SELECT (their own assignments / bookings).

do $$
declare
  t text;
begin
  foreach t in array array[
    'job_assignments',
    'jobs',
    'bookings',
    'job_checklists',
    'job_addon_requests'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null; -- already in the publication
      when undefined_table then null;  -- table absent on this env
    end;
  end loop;
end $$;
