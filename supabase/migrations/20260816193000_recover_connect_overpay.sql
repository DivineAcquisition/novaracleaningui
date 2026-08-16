-- Watch Cat Peoples NVC-0014 $77 Connect overpay.
-- Bank-payout reversal po_1U59KZ... is pending. When those cents become
-- available on her Connect balance, recover-connect-overpay reverses
-- transfer tr_1TuHIA... onto the platform. Cron every 5 minutes; the
-- function no-ops once the row is recovered or failed.

CREATE TABLE IF NOT EXISTS public.connect_overpay_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid REFERENCES public.cleaners (id),
  cleaner_name text NOT NULL,
  stripe_account_id text NOT NULL,
  transfer_id text NOT NULL,
  original_payout_id text,
  payout_reversal_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  booking_label text,
  status text NOT NULL DEFAULT 'watching',
  last_payout_status text,
  last_available_cents integer,
  last_pending_cents integer,
  last_checked_at timestamptz,
  last_error text,
  stripe_reversal_id text,
  recovered_at timestamptz,
  payouts_paused boolean NOT NULL DEFAULT false,
  prior_payout_interval text,
  prior_payout_delay_days integer,
  armed_notified_at timestamptz,
  notify_email text NOT NULL DEFAULT 'contact@novaracleaning.com',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_overpay_recovery_status_chk
    CHECK (status IN ('watching', 'ready', 'recovering', 'recovered', 'failed')),
  CONSTRAINT connect_overpay_recovery_transfer_uid UNIQUE (transfer_id)
);

CREATE INDEX IF NOT EXISTS connect_overpay_recovery_open_idx
  ON public.connect_overpay_recovery (status)
  WHERE status IN ('watching', 'ready', 'recovering');

ALTER TABLE public.connect_overpay_recovery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read connect_overpay_recovery" ON public.connect_overpay_recovery;
CREATE POLICY "admins read connect_overpay_recovery"
  ON public.connect_overpay_recovery
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'va')
    )
  );

INSERT INTO public.connect_overpay_recovery (
  cleaner_id,
  cleaner_name,
  stripe_account_id,
  transfer_id,
  original_payout_id,
  payout_reversal_id,
  amount_cents,
  booking_label,
  status
) VALUES (
  '5204510b-105c-414d-83cf-bfd2801e465b',
  'Cat Peoples',
  'acct_1Tn1ixFQSo28Wyg8',
  'tr_1TuHIA2YP5iHN3RzbxV0xYZ0',
  'po_1Tv5NxFQSo28Wyg8qq0kXkQF',
  'po_1U59KZFQSo28Wyg8MmtDKIbT',
  7700,
  'NVC-0014 Jake Cianella',
  'watching'
)
ON CONFLICT (transfer_id) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'recover-connect-overpay';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('recover-connect-overpay');
  END IF;

  PERFORM cron.schedule(
    'recover-connect-overpay',
    '*/5 * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/recover-connect-overpay',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping recover-connect-overpay cron schedule: %', SQLERRM;
END $$;
