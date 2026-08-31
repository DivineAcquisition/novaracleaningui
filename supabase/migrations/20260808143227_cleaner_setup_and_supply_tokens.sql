-- ─── Tokenized account-setup + supply-checklist links for cleaners ───────────
--
-- Mirrors the agreement-token pattern: admin mints a single-use (or re-mintable)
-- link, cleaner opens it without fighting the full wizard login wall first.
--
-- Setup: phone verify + Stripe Connect. Supplies: mark which kit items they own;
-- readiness is scored in app code against the job-needed essentials.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS setup_token text,
  ADD COLUMN IF NOT EXISTS setup_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS setup_token_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS setup_token_sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supply_token text,
  ADD COLUMN IF NOT EXISTS supply_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS supply_token_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS supply_token_sent_count integer NOT NULL DEFAULT 0,
  -- { "all_purpose_cleaner": true, ... } — keys match src/lib/cleaner-supplies.ts
  ADD COLUMN IF NOT EXISTS supply_inventory jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supply_checklist_submitted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS cleaners_setup_token_uniq
  ON public.cleaners (setup_token)
  WHERE setup_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cleaners_supply_token_uniq
  ON public.cleaners (supply_token)
  WHERE supply_token IS NOT NULL;

COMMENT ON COLUMN public.cleaners.setup_token IS
  'Single-use credential for the account-setup nudge link (contractor.novaracleaning.com/cleaner/setup/<token>). Replaced on resend.';
COMMENT ON COLUMN public.cleaners.supply_token IS
  'Credential for the supply checklist page (contractor.novaracleaning.com/cleaner/supplies/<token>). Replaced on resend; not burned on save so they can update.';
COMMENT ON COLUMN public.cleaners.supply_inventory IS
  'Which checklist items the contractor marked as owned. Keys are supply item ids from the Novara supply checklist.';

CREATE OR REPLACE FUNCTION public.mint_cleaner_setup_token(
  p_cleaner_id uuid,
  p_ttl_days integer DEFAULT 14
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
  v_phone_ok boolean;
  v_stripe_ok boolean;
BEGIN
  SELECT
    COALESCE(phone_verified, false),
    (COALESCE(payouts_enabled, false)
      OR COALESCE(ob_payouts_setup, false)
      OR (stripe_account_id IS NOT NULL AND btrim(stripe_account_id) <> ''))
  INTO v_phone_ok, v_stripe_ok
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Already fully set up — nothing to send.
  IF v_phone_ok AND v_stripe_ok THEN RETURN NULL; END IF;

  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.cleaners
    SET setup_token = v_token,
        setup_token_expires_at = now() + (GREATEST(1, COALESCE(p_ttl_days, 14)) || ' days')::interval,
        setup_token_sent_at = now(),
        setup_token_sent_count = COALESCE(setup_token_sent_count, 0) + 1,
        updated_at = now()
    WHERE id = p_cleaner_id;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.mint_cleaner_supply_token(
  p_cleaner_id uuid,
  p_ttl_days integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cleaners WHERE id = p_cleaner_id) THEN
    RETURN NULL;
  END IF;

  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.cleaners
    SET supply_token = v_token,
        supply_token_expires_at = now() + (GREATEST(1, COALESCE(p_ttl_days, 30)) || ' days')::interval,
        supply_token_sent_at = now(),
        supply_token_sent_count = COALESCE(supply_token_sent_count, 0) + 1,
        updated_at = now()
    WHERE id = p_cleaner_id;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.mint_cleaner_supply_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_supply_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_supply_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_supply_token(uuid, integer) TO service_role;

CREATE OR REPLACE VIEW public.cleaner_setup_status_v1 AS
SELECT
  c.id AS cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.email,
  c.phone,
  c.status,
  COALESCE(c.phone_verified, false) AS phone_verified,
  (COALESCE(c.payouts_enabled, false)
    OR COALESCE(c.ob_payouts_setup, false)
    OR (c.stripe_account_id IS NOT NULL AND btrim(c.stripe_account_id) <> '')) AS stripe_ready,
  (COALESCE(c.phone_verified, false)
    AND (COALESCE(c.payouts_enabled, false)
      OR COALESCE(c.ob_payouts_setup, false)
      OR (c.stripe_account_id IS NOT NULL AND btrim(c.stripe_account_id) <> ''))) AS setup_complete,
  c.setup_token IS NOT NULL
    AND (c.setup_token_expires_at IS NULL OR c.setup_token_expires_at > now()) AS link_outstanding,
  c.setup_token_sent_at,
  COALESCE(c.setup_token_sent_count, 0) AS link_sent_count,
  c.supply_checklist_submitted_at,
  c.supply_token_sent_at,
  COALESCE(c.supply_token_sent_count, 0) AS supply_link_sent_count
FROM public.cleaners c
WHERE c.status <> 'terminated';

COMMENT ON VIEW public.cleaner_setup_status_v1 IS
  'Per-contractor account-setup standing (phone + Stripe) and supply-checklist send history.';

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.setup_link_sent', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.supply_link_sent', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.supply_checklist_submitted', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
