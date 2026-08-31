-- ─── Partner portal — created_at read indexes ───────────────────────────
--
-- The admin Turnover Ops screen and the host dashboard load the most-recent
-- rows first (`order by created_at desc`, often limited). Stress testing at
-- 5k hosts / 10k properties / 15k turnovers showed those reads falling back
-- to a seq scan + top-N sort. These descending indexes turn them into index
-- scans (admin "latest 500" went ~4.9ms → ~0.5ms).

create index if not exists turnover_requests_created_at_idx on public.turnover_requests (created_at desc);
create index if not exists properties_created_at_idx on public.properties (created_at desc);
create index if not exists host_onboarding_created_at_idx on public.host_onboarding_submissions (created_at desc);
