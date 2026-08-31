-- ─── Partner Turnover Portal — cleaner read access ───────────────────────
--
-- Cleaners need to see the turnovers assigned to them (and the related
-- property's address / access instructions / notes) from the cleaner app.
-- Writes still flow through the partner-turnover edge function, which checks
-- that the acting user owns the assignment.

do $$
begin
  -- A cleaner can read turnover_requests assigned to their cleaner row.
  if not exists (select 1 from pg_policies where tablename='turnover_requests' and policyname='tr_cleaner_read') then
    create policy tr_cleaner_read on public.turnover_requests for select to authenticated
      using (
        assigned_cleaner_id in (
          select id from public.cleaners where user_id = auth.uid()
        )
      );
  end if;

  -- ...and the property attached to any turnover assigned to them.
  if not exists (select 1 from pg_policies where tablename='properties' and policyname='properties_cleaner_read') then
    create policy properties_cleaner_read on public.properties for select to authenticated
      using (
        id in (
          select tr.property_id from public.turnover_requests tr
          join public.cleaners c on c.id = tr.assigned_cleaner_id
          where c.user_id = auth.uid()
        )
      );
  end if;
end $$;
