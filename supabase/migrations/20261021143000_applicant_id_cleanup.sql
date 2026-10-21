-- Daily deletion of application photo IDs after the retention period in settings.
-- The route refuses the call unless x-cron-secret matches CRON_SECRET.

alter table public.cleaner_applicants
  add column if not exists government_id_deleted_at timestamptz;

comment on column public.cleaner_applicants.government_id_deleted_at is
  'When the application-stage photo ID was deleted. The path is cleared at the same time.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'applicant-id-cleanup') THEN
    PERFORM cron.unschedule('applicant-id-cleanup');
  END IF;
  PERFORM cron.schedule(
    'applicant-id-cleanup',
    '15 8 * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://app.novaracleaning.com/api/cron/applicant-id-cleanup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce((SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET'), '')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — applicant-id-cleanup not scheduled.';
END $$;
