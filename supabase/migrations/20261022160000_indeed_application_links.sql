-- Tracks Indeed messages already considered for a Field Cleaner application link.
-- The cron calls the hiring route, which reads new DC, Maryland, and Virginia
-- applications and sends one link each. Mail already in the inbox is not sent.

create table if not exists public.indeed_link_seen (
  gmail_message_id text primary key,
  result text not null,
  created_at timestamptz not null default now()
);

alter table public.indeed_link_seen enable row level security;

comment on table public.indeed_link_seen is
  'Indeed messages already considered for a Field Cleaner application link. Service role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'indeed-application-links') THEN
    PERFORM cron.unschedule('indeed-application-links');
  END IF;
  PERFORM cron.schedule(
    'indeed-application-links',
    '*/15 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://app.novaracleaning.com/api/cron/indeed-application-links',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce((SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET'), '')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — indeed-application-links not scheduled.';
END $$;
