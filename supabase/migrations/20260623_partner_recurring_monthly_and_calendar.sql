-- ─── Partner recurring: monthly cadence + iCal calendar token ────────────
--
-- Extends recurring_schedules so a host can repeat WEEKLY (days_of_week) or
-- MONTHLY (day_of_month). Adds a per-host calendar token so partners can
-- subscribe to a private iCal feed of their upcoming + scheduled cleans.

alter table public.recurring_schedules
  add column if not exists frequency text not null default 'weekly'
    check (frequency in ('weekly', 'monthly')),
  add column if not exists day_of_month int
    check (day_of_month is null or (day_of_month between 1 and 31)),
  add column if not exists last_generated_month text;  -- 'YYYY-MM' idempotency guard for monthly

-- Per-host calendar feed token (unguessable). Used by the partner-calendar
-- edge function to serve a private .ics feed without a login.
alter table public.hosts
  add column if not exists calendar_token text;

create unique index if not exists hosts_calendar_token_idx
  on public.hosts (calendar_token) where calendar_token is not null;

-- Backfill a token for every existing host.
update public.hosts
  set calendar_token = encode(gen_random_bytes(18), 'hex')
  where calendar_token is null;
