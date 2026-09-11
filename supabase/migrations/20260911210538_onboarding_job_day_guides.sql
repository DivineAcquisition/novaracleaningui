-- Onboarding gains a step: read the dress code and the job-day graphic.
--
-- The sequence is now phone → job-day guides → supplies → payouts, and the
-- three places that decide "is this contractor set up" have to agree with the
-- portal. mint_cleaner_setup_token is the one with teeth: it returns NULL to
-- mean "nothing left to do, don't send a link", so a step missing from it is
-- a step admin cannot chase.
--
-- Retroactive by design: every contractor who onboarded before this is now
-- one step short, because none of them have seen the dress code. That is the
-- point — the graphic is new policy material, and the setup link is how they
-- get asked. Nothing about their pay, jobs or Stripe standing changes.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS ob_job_day_guides_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ob_job_day_guides_ack_at timestamptz;

COMMENT ON COLUMN public.cleaners.ob_job_day_guides_ack IS
  'Contractor has read the dress code and job-day journey graphics shown in onboarding step 2.';

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
  v_guides_ok boolean;
  v_supplies_ok boolean;
  v_stripe_ok boolean;
BEGIN
  SELECT
    COALESCE(phone_verified, false),
    COALESCE(ob_job_day_guides_ack, false),
    (supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(ob_supplies_checklist_viewed, false)),
    (COALESCE(payouts_enabled, false)
      OR COALESCE(ob_payouts_setup, false)
      OR (stripe_account_id IS NOT NULL AND btrim(stripe_account_id) <> ''))
  INTO v_phone_ok, v_guides_ok, v_supplies_ok, v_stripe_ok
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Already fully set up — nothing to send.
  IF v_phone_ok AND v_guides_ok AND v_supplies_ok AND v_stripe_ok THEN RETURN NULL; END IF;

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

REVOKE ALL ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_setup_token(uuid, integer) TO service_role;

-- guides_acknowledged is appended for the same reason supplies_submitted was:
-- CREATE OR REPLACE VIEW can add trailing columns but cannot reorder existing
-- ones. setup_complete is updated in place, so admin's "ready" answer moves
-- with the sequence.
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
    AND COALESCE(c.ob_job_day_guides_ack, false)
    AND (c.supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(c.ob_supplies_checklist_viewed, false))
    AND (COALESCE(c.payouts_enabled, false)
      OR COALESCE(c.ob_payouts_setup, false)
      OR (c.stripe_account_id IS NOT NULL AND btrim(c.stripe_account_id) <> ''))) AS setup_complete,
  c.setup_token IS NOT NULL
    AND (c.setup_token_expires_at IS NULL OR c.setup_token_expires_at > now()) AS link_outstanding,
  c.setup_token_sent_at,
  COALESCE(c.setup_token_sent_count, 0) AS link_sent_count,
  c.supply_checklist_submitted_at,
  c.supply_token_sent_at,
  COALESCE(c.supply_token_sent_count, 0) AS supply_link_sent_count,
  (c.supply_checklist_submitted_at IS NOT NULL
    OR COALESCE(c.ob_supplies_checklist_viewed, false)) AS supplies_submitted,
  COALESCE(c.ob_job_day_guides_ack, false) AS guides_acknowledged,
  c.ob_job_day_guides_ack_at AS guides_acknowledged_at
FROM public.cleaners c
WHERE c.status <> 'terminated';

COMMENT ON VIEW public.cleaner_setup_status_v1 IS
  'Per-contractor account-setup standing (phone + job-day guides + supplies + Stripe) and supply-checklist send history.';
