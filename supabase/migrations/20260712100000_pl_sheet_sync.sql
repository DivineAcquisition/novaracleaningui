-- ─── P&L data capture + daily Google Sheet sync ──────────────────────────────
--
-- Four data sets feed the branded P&L workbook. Supabase is the system of
-- record; a daily sync mirrors rows into the sheet (one-way).
--   1. Jobs        → derived from bookings/turnovers (no new table)
--   2. Expenses    → pl_expenses        (VA form in admin workspace)
--   3. Ad Spend    → pl_ad_spend       (founder/manager manual entry)
--   4. EOD Report  → pl_eod_reports    (VA daily form)
--
-- Enum columns are CHECK-constrained to the sheet's canonical dropdown values
-- (formulas match on literal text). Money is stored in cents; the sync emits
-- dollars. Every row has a stable id + timestamps for the idempotent mirror.

CREATE TABLE IF NOT EXISTS public.pl_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  type text NOT NULL CHECK (type IN ('Promised','Reimbursement','One-off Expense','Other')),
  who text NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL DEFAULT 'Promised' CHECK (status IN ('Promised','Approved','Paid','Denied')),
  paid_date date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_expenses_date_idx ON public.pl_expenses (date DESC);

CREATE TABLE IF NOT EXISTS public.pl_ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('Facebook','LSA','Google','Instagram','Other')),
  spend_cents integer NOT NULL CHECK (spend_cents >= 0),
  leads_calls integer,
  booked_jobs integer,
  campaign_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_ad_spend_date_idx ON public.pl_ad_spend (date DESC);

CREATE TABLE IF NOT EXISTS public.pl_eod_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  va_name text NOT NULL,
  inbound_leads integer NOT NULL DEFAULT 0,
  bookings_closed integer NOT NULL DEFAULT 0,
  outbound_calls integer NOT NULL DEFAULT 0,
  apps_reviewed integer NOT NULL DEFAULT 0,
  phone_screens integer NOT NULL DEFAULT 0,
  complaints_issues integer NOT NULL DEFAULT 0,
  revenue_booked_cents integer NOT NULL DEFAULT 0,
  blockers_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_eod_date_idx ON public.pl_eod_reports (date DESC);
-- One EOD report per VA per day (repeat submissions update in the UI).
CREATE UNIQUE INDEX IF NOT EXISTS pl_eod_va_day_uniq ON public.pl_eod_reports (date, lower(va_name));

-- RLS: admin + VA manage; service role full (sync).
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pl_expenses','pl_ad_spend','pl_eod_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname=t||'_admin_all') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()))',
        t||'_admin_all', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname=t||'_service_role') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t||'_service_role', t);
    END IF;
  END LOOP;
END $do$;

-- updated_at touch
CREATE OR REPLACE FUNCTION public.touch_pl_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;
DROP TRIGGER IF EXISTS trg_touch_pl_expenses ON public.pl_expenses;
CREATE TRIGGER trg_touch_pl_expenses BEFORE UPDATE ON public.pl_expenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_pl_updated_at();
DROP TRIGGER IF EXISTS trg_touch_pl_ad_spend ON public.pl_ad_spend;
CREATE TRIGGER trg_touch_pl_ad_spend BEFORE UPDATE ON public.pl_ad_spend
  FOR EACH ROW EXECUTE FUNCTION public.touch_pl_updated_at();
DROP TRIGGER IF EXISTS trg_touch_pl_eod ON public.pl_eod_reports;
CREATE TRIGGER trg_touch_pl_eod BEFORE UPDATE ON public.pl_eod_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_pl_updated_at();

-- ─── Config slots ─────────────────────────────────────────────────────────────
INSERT INTO public.app_secrets (key, value, description) VALUES
  ('PL_SHEET_ID', '',
   'Google Spreadsheet id of the branded P&L workbook (tabs: Daily Log, Expenses & Reimb, Ad Spend, EOD). The Google service account (or impersonated user) must have edit access.'),
  ('PL_SYNC_SINCE', '2026-06-01',
   'Earliest date (YYYY-MM-DD) of jobs/rows mirrored into the P&L sheet.')
ON CONFLICT (key) DO NOTHING;

-- ─── Cron: daily mirror at 09:30 UTC (early morning ET) ──────────────────────
DO $do$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_service_role text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_service_role FROM public.app_secrets WHERE key = 'SUPABASE_SERVICE_ROLE_KEY';

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'pl-sheet-sync';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('pl-sheet-sync'); END IF;
  PERFORM cron.schedule(
    'pl-sheet-sync',
    '30 9 * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/pl-sheet-sync',
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
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping pl-sheet-sync scheduling: %', SQLERRM;
END $do$;
