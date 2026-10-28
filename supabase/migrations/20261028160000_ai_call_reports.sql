-- One row per finished AI voice call so the report email is sent once.

create table if not exists public.ai_call_reports (
  conversation_id text primary key,
  call_control_id text,
  assistant_id text,
  agent_name text,
  outcome text,
  caller_phone text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec integer,
  email_status text not null default 'pending',
  email_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.ai_call_reports enable row level security;

comment on table public.ai_call_reports is
  'Finished AI voice calls already reported to the owner. Service role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-call-finished') THEN
    PERFORM cron.unschedule('ai-call-finished');
  END IF;
  PERFORM cron.schedule(
    'ai-call-finished',
    '*/2 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/ai-call-finished',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce((SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET'), '')
        ),
        body := '{"sweep":true}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — ai-call-finished not scheduled.';
END $$;
