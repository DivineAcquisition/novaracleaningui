-- Onboarding walkthrough order is now:
--   agreement → supplies → Day To Day Job Operations → dress code →
--   phone → training videos → Stripe payout setup
--
-- Stripe is the last card. First-job eligibility still stops at the
-- training videos: a contractor can be offered work once those are done,
-- and Stripe is how completed-job pay is deposited.

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
  v_agreement_ok boolean;
  v_phone_ok boolean;
  v_supplies_ok boolean;
  v_dress_ok boolean;
  v_job_day_ok boolean;
  v_training_ok boolean;
  v_stripe_ok boolean;
BEGIN
  SELECT
    COALESCE(ob_agreement_signed, false),
    COALESCE(phone_verified, false),
    (supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(ob_supplies_checklist_viewed, false)),
    (COALESCE(ob_dress_code_ack, false)
      OR COALESCE(ob_job_day_guides_ack, false)),
    COALESCE(ob_job_day_guides_ack, false),
    COALESCE(ob_training_complete, false),
    (COALESCE(payouts_enabled, false)
      OR COALESCE(ob_payouts_setup, false)
      OR (stripe_account_id IS NOT NULL AND btrim(stripe_account_id) <> ''))
  INTO v_agreement_ok, v_phone_ok, v_supplies_ok, v_dress_ok, v_job_day_ok, v_training_ok, v_stripe_ok
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_agreement_ok AND v_phone_ok AND v_supplies_ok AND v_dress_ok AND v_job_day_ok AND v_training_ok AND v_stripe_ok
  THEN RETURN NULL; END IF;

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
  (COALESCE(c.ob_agreement_signed, false)
    AND COALESCE(c.phone_verified, false)
    AND (c.supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(c.ob_supplies_checklist_viewed, false))
    AND (COALESCE(c.ob_dress_code_ack, false)
      OR COALESCE(c.ob_job_day_guides_ack, false))
    AND COALESCE(c.ob_job_day_guides_ack, false)
    AND COALESCE(c.ob_training_complete, false)
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
  c.ob_job_day_guides_ack_at AS guides_acknowledged_at,
  COALESCE(c.ob_agreement_signed, false) AS agreement_signed,
  COALESCE(c.ob_dress_code_ack, false) AS dress_code_agreed,
  COALESCE(c.ob_training_complete, false) AS training_complete,
  public.cleaner_ready_for_first_job(c.id) AS ready_for_first_job
FROM public.cleaners c
WHERE c.status <> 'terminated';

COMMENT ON VIEW public.cleaner_setup_status_v1 IS
  'Per-contractor onboarding standing. Walkthrough ends with Stripe. First-job eligibility stops at the training videos.';
