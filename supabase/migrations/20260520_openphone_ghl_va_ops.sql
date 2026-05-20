-- ─── OpenPhone + GHL + VA outbound ops ─────────────────────────────────────
-- Schema for the speed-to-lead workflow: FB Lead Ads / LSA / website forms
-- feed `lead-intake`, OpenPhone calls feed `openphone-webhook`, and the
-- `escalate-stale-leads` cron flags HOT leads that weren't called within
-- 10 minutes. See docs/openphone_ghl_va_ops.md for the operator runbook.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'va';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'csr';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_va_user_id UUID,
  ADD COLUMN IF NOT EXISTS lead_score TEXT DEFAULT 'cold',
  ADD COLUMN IF NOT EXISTS call_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_call_outcome TEXT,
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_call BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT,
  ADD COLUMN IF NOT EXISTS openphone_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS speed_to_lead_sms_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_sms_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_status_score_idx ON public.leads(status, lead_score);
CREATE INDEX IF NOT EXISTS leads_assigned_va_idx ON public.leads(assigned_va_user_id) WHERE assigned_va_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_phone_idx ON public.leads(phone);
CREATE INDEX IF NOT EXISTS leads_next_action_idx ON public.leads(next_action_at) WHERE next_action_at IS NOT NULL;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS lead_score TEXT,
  ADD COLUMN IF NOT EXISTS do_not_call BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_called_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_call_outcome TEXT,
  ADD COLUMN IF NOT EXISTS last_booking_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.phone_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ghl_contact_id TEXT,
  openphone_call_id TEXT UNIQUE,
  openphone_conversation_id TEXT,
  direction TEXT,
  from_phone TEXT,
  to_phone TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  ai_summary TEXT,
  ai_sentiment TEXT,
  disposition TEXT,
  outcome_tag TEXT,
  va_user_id UUID,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_calls_lead_idx ON public.phone_calls(lead_id);
CREATE INDEX IF NOT EXISTS phone_calls_customer_idx ON public.phone_calls(customer_id);
CREATE INDEX IF NOT EXISTS phone_calls_started_idx ON public.phone_calls(started_at DESC);
CREATE INDEX IF NOT EXISTS phone_calls_disposition_idx ON public.phone_calls(disposition);

CREATE TABLE IF NOT EXISTS public.va_assignments (
  va_user_id UUID PRIMARY KEY,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  on_shift BOOLEAN NOT NULL DEFAULT false,
  total_leads_assigned INTEGER NOT NULL DEFAULT 0,
  last_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_secrets (key, value) VALUES
  ('OPENPHONE_API_KEY', ''),
  ('OPENPHONE_WEBHOOK_SECRET', '')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.increment_lead_call_attempts(_lead_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.leads
  SET call_attempts = COALESCE(call_attempts, 0) + 1,
      updated_at    = now()
  WHERE id = _lead_id;
$$;

-- Schedule the speed-to-lead escalator from pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('escalate-stale-leads-every-minute')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'escalate-stale-leads-every-minute'
  );

  PERFORM cron.schedule(
    'escalate-stale-leads-every-minute',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/escalate-stale-leads',
        headers := jsonb_build_object('Content-Type','application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cron$
  );
END $$;
