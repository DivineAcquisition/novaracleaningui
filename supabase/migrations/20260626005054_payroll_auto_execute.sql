-- ─── Cleaner Payout Automation: Review → Approve → Auto-Execute ─────────────
--
-- Extends the existing manual payroll subsystem (payroll_runs) with the
-- columns + scheduling needed for the one-click "Approve & Pay" executor and
-- the weekly auto-draft. Intentionally additive — the live booking→payout flow
-- and the existing manual payroll actions keep working unchanged.
--
-- Status lifecycle (payroll_runs.status, plain text):
--   draft → approved → processing → paid → (cleared via webhook) | failed | hold
--   `sent`/`cleared` from the legacy manual flow remain valid.

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS processing_at      timestamptz,   -- execution lock claimed
  ADD COLUMN IF NOT EXISTS executed_at        timestamptz,   -- transfer fired
  ADD COLUMN IF NOT EXISTS executed_by        uuid,          -- admin who clicked Approve & Pay
  ADD COLUMN IF NOT EXISTS airtable_synced_at timestamptz;   -- last Ops-base write-back

-- ─── Secrets / config (no-op if already present; never overwrite a value) ───
INSERT INTO public.app_secrets (key, value, description) VALUES
  ('STRIPE_ENV', 'test',
    'Guard for payroll-execute: "test" or "live". Must match the STRIPE_SECRET_KEY mode or execution halts before any transfer.'),
  ('PAYROLL_OPS_AIRTABLE_BASE_ID', 'appoUuFQZQfCyKGlw',
    'Airtable base "NVC | Client & Revenue Ops" — payroll run write-back target.'),
  ('PAYROLL_OPS_AIRTABLE_RUNS_TABLE', 'tblGr8Cu8avwvV3xy',
    'Airtable "Payroll Runs" table id in the Ops base.')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  value = CASE
    WHEN public.app_secrets.value IS NULL OR public.app_secrets.value = '' THEN EXCLUDED.value
    ELSE public.app_secrets.value
  END;

-- ─── Weekly auto-draft cron → payroll-draft Edge Function ──────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_supabase_url text;
  v_service_role text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payroll-draft-weekly') THEN
    PERFORM cron.unschedule('payroll-draft-weekly');
  END IF;

  -- Monday 11:00 UTC ≈ 6/7am ET — drafts the prior Mon–Sun period.
  PERFORM cron.schedule(
    'payroll-draft-weekly',
    '0 11 * * 1',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/payroll-draft',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      v_service_role
    )
  );
END $$;

NOTIFY pgrst, 'reload schema';
