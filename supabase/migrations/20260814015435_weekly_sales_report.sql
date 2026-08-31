-- Weekly Sales, Retention & Growth report.
--
-- One branded PDF per Mon–Sun window, generated on a schedule (default Monday
-- morning ET covering the prior week) or on demand. Numbers come from existing
-- tables; missing sources render as unavailable, never as a guessed zero.
-- PDFs land in storage + the Drive folder "NVC WeekLt Report & Forcast".

CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'generated', 'drive_pending', 'failed')),
  trigger text NOT NULL DEFAULT 'scheduled'
    CHECK (trigger IN ('scheduled', 'on_demand', 'retry')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  unavailable_sources text[] NOT NULL DEFAULT '{}',
  insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  watch_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  executive_summary text,
  insight_model text,
  insight_model_version text,
  pdf_path text,
  pdf_status text NOT NULL DEFAULT 'pending'
    CHECK (pdf_status IN ('pending', 'generated', 'drive_pending', 'failed')),
  pdf_attempts integer NOT NULL DEFAULT 0,
  pdf_last_error text,
  pdf_generated_at timestamptz,
  drive_file_id text,
  drive_url text,
  drive_folder_id text,
  airtable_record_id text,
  notified_at timestamptz,
  failure_notified_at timestamptz,
  generated_at timestamptz,
  generated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_start, period_end)
);

CREATE INDEX IF NOT EXISTS weekly_reports_period_idx
  ON public.weekly_reports (period_start DESC);

CREATE INDEX IF NOT EXISTS weekly_reports_status_idx
  ON public.weekly_reports (status, pdf_attempts);

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_reports_admin_all ON public.weekly_reports;
CREATE POLICY weekly_reports_admin_all ON public.weekly_reports
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS weekly_reports_service_role ON public.weekly_reports;
CREATE POLICY weekly_reports_service_role ON public.weekly_reports
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_weekly_reports_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_weekly_reports ON public.weekly_reports;
CREATE TRIGGER trg_touch_weekly_reports
  BEFORE UPDATE ON public.weekly_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_weekly_reports_updated_at();

-- Schedule + recipients. Drive folder id is also in app_secrets so the edge
-- function can resolve it the same way EOD/QC archives do.
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'weekly_report_settings',
  jsonb_build_object(
    'enabled', true,
    'timezone', 'America/New_York',
    'run_weekday', 1,
    'run_hour', 8,
    'recipients', jsonb_build_array('contact@novaracleaning.com', 'dispatch@novaracleaning.com'),
    'retention_weeks', NULL,
    'max_insights', 8,
    'drive_root_folder_id', '1ZyfiAEaqb63DDE3gYfzUsk688i35j4fK',
    'drive_folder_name', 'NVC WeekLt Report & Forcast'
  ),
  'Weekly Sales/Retention/Growth report: Monday 8am ET default, covering the prior Mon–Sun. Recipients get the PDF link; the report never auto-changes budgets or pricing.'
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    value = COALESCE(public.app_settings.value, '{}'::jsonb) || EXCLUDED.value;

INSERT INTO public.app_secrets (key, value, description)
VALUES (
  'AIRTABLE_WEEKLY_REPORTS_TABLE',
  'Weekly Reports',
  'Airtable table for weekly report PDFs. Merge field must be "Period Start" (date). Other fields: Period End, Status, Executive Summary, Insight Model, Drive URL, Generated At.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_secrets (key, value, description)
VALUES (
  'GDRIVE_WEEKLY_REPORT_ROOT_FOLDER_ID',
  '1ZyfiAEaqb63DDE3gYfzUsk688i35j4fK',
  'Google Drive folder "NVC WeekLt Report & Forcast". Dated PDFs go under {YYYY}/{YYYY-MM-DD} - Weekly Report.pdf. Impersonate GOOGLE_DRIVE_IMPERSONATE_EMAIL (contact@) which owns this folder.'
)
ON CONFLICT (key) DO UPDATE
SET value = CASE
      WHEN btrim(COALESCE(public.app_secrets.value, '')) = '' THEN EXCLUDED.value
      ELSE public.app_secrets.value
    END,
    description = EXCLUDED.description;

INSERT INTO storage.buckets (id, name, public)
VALUES ('weekly-reports', 'weekly-reports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read weekly reports" ON storage.objects;
CREATE POLICY "admins read weekly reports" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'weekly-reports' AND public.has_role(auth.uid(), 'admin'));

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES
  ('weekly.report.ready', 'DISCORD_WEBHOOK_URL', ARRAY['DISCORD_ROLE_OPERATIONS'], true),
  ('weekly.report.failed', 'DISCORD_WEBHOOK_URL', ARRAY['DISCORD_ROLE_OPERATIONS'], true)
ON CONFLICT (event_type) DO NOTHING;

-- Hourly tick: the function itself decides whether this is the configured
-- Monday-morning window, a retry of a failed/drive-pending report, or a no-op.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

INSERT INTO public.app_secrets (key, value, description)
VALUES ('CRON_SECRET', encode(gen_random_bytes(24), 'hex'), 'Shared secret for pg_cron → edge function calls.')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'weekly-report-generate';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('weekly-report-generate');
  END IF;

  PERFORM cron.schedule(
    'weekly-report-generate',
    '8 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/weekly-report-generate',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET')
          ),
          body := jsonb_build_object('source', 'pg_cron', 'action', 'tick')
        );
      $cron$,
      v_supabase_url
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping weekly-report-generate cron schedule: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
