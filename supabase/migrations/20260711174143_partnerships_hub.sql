-- ─── Partnerships Hub: commercial intake + partner portal + unified console ──
--
-- 1. business_accounts grows the lifecycle/billing columns the hub needs:
--    agreement + payment gates (nothing goes Active without both), autopay,
--    lead metadata from the public commercial intake, activity tracking.
-- 2. Discord route for new partnership leads (commercial./STR intake).
--
-- The public intake NEVER prices — it captures typed leads; admin sets rates.

ALTER TABLE public.business_accounts
  ADD COLUMN IF NOT EXISTS agreement_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS autopay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coi_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS num_locations integer,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS lead_details jsonb,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

-- Widen the status vocabulary for the full lifecycle. (Old check allowed a
-- smaller set; recreate it if present.)
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.business_accounts DROP CONSTRAINT IF EXISTS business_accounts_status_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.business_accounts
      ADD CONSTRAINT business_accounts_status_check
      CHECK (status IN ('prospect','onboarding','active','paused','offboarded'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Keep last_activity fresh on any account write.
CREATE OR REPLACE FUNCTION public.touch_business_account_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.last_activity_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_touch_business_account_activity ON public.business_accounts;
CREATE TRIGGER trg_touch_business_account_activity
  BEFORE UPDATE ON public.business_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_business_account_activity();

-- ─── Discord: new partnership/commercial intake leads ────────────────────────
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('partner.lead.created', 'DISCORD_WEBHOOK_REVENUE', ARRAY['DISCORD_ROLE_SALES'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
