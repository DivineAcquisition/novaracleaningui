-- Payment options + sync fields for partner turnovers (applied live 2026-06-24).
alter table public.turnover_requests
  add column if not exists before_photos jsonb not null default '[]'::jsonb,
  add column if not exists after_photos jsonb not null default '[]'::jsonb,
  add column if not exists cleaner_confirmed_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists host_rating integer,
  add column if not exists host_review text,
  add column if not exists rated_at timestamptz,
  add column if not exists reschedule_count integer not null default 0,
  add column if not exists last_rescheduled_at timestamptz,
  add column if not exists ghl_contact_id text,
  add column if not exists ghl_opportunity_id text,
  add column if not exists payment_option text not null default 'full',
  add column if not exists deposit_cents integer,
  add column if not exists balance_cents integer,
  add column if not exists deposit_payment_intent_id text,
  add column if not exists balance_payment_intent_id text,
  add column if not exists balance_charged_at timestamptz,
  add column if not exists card_on_file boolean not null default false,
  add column if not exists cleaner_payout_cents integer,
  add column if not exists google_calendar_event_id text,
  add column if not exists ghl_appointment_id text,
  add column if not exists ghl_appointment_calendar_id text,
  add column if not exists airtable_job_synced_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'turnover_requests_payment_option_chk') then
    alter table public.turnover_requests
      add constraint turnover_requests_payment_option_chk
      check (payment_option in ('full','split','pay_after'));
  end if;
end $$;

alter table public.hosts
  add column if not exists default_payment_method_id text,
  add column if not exists ghl_contact_id text,
  add column if not exists calendar_token text;

update public.hosts set calendar_token = encode(gen_random_bytes(18),'hex') where calendar_token is null;
create unique index if not exists hosts_calendar_token_idx on public.hosts (calendar_token);
