-- Onboarding is phone → supplies → payouts, so the database has to agree.
--
-- mint_cleaner_setup_token previously returned NULL (meaning "nothing left to
-- do, don't send a link") once phone and Stripe were done. A contractor who
-- had never checked off their supplies looked complete to it, so admin could
-- not send them a setup link at all. The supply checkoff now counts, and the
-- standing view reports it alongside the other two steps.
--
-- Supplies count as done on submission, not on owning SUPPLY_READY_PERCENT of
-- the kit — onboarding asks what they have, it never waits on a purchase.
-- ob_supplies_checklist_viewed is honoured so contractors who submitted under
-- the older flow are not asked again.

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
  v_supplies_ok boolean;
  v_stripe_ok boolean;
BEGIN
  SELECT
    COALESCE(phone_verified, false),
    (supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(ob_supplies_checklist_viewed, false)),
    (COALESCE(payouts_enabled, false)
      OR COALESCE(ob_payouts_setup, false)
      OR (stripe_account_id IS NOT NULL AND btrim(stripe_account_id) <> ''))
  INTO v_phone_ok, v_supplies_ok, v_stripe_ok
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Already fully set up — nothing to send.
  IF v_phone_ok AND v_supplies_ok AND v_stripe_ok THEN RETURN NULL; END IF;

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

-- supplies_submitted is appended rather than slotted next to the other two
-- step flags: CREATE OR REPLACE VIEW can add trailing columns but cannot
-- reorder the existing ones.
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
    OR COALESCE(c.ob_supplies_checklist_viewed, false)) AS supplies_submitted
FROM public.cleaners c
WHERE c.status <> 'terminated';

COMMENT ON VIEW public.cleaner_setup_status_v1 IS
  'Per-contractor account-setup standing (phone + supplies + Stripe) and supply-checklist send history.';
