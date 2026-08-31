-- ─── Partner Turnover Portal — realtime ──────────────────────────────────
--
-- Enable Postgres change streaming on the host-facing tables so the portal
-- dashboard can update live (assignment, confirmation, completion) without a
-- manual refresh. RLS still scopes what each host actually receives.

do $$
begin
  begin
    alter publication supabase_realtime add table public.turnover_requests;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.properties;
  exception when duplicate_object then null;
  end;
end $$;
