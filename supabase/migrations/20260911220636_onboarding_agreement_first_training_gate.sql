-- Onboarding sequence is now:
--   agreement → phone → supplies → dress code (agree) → job-day → training
--
-- A contractor with zero completed jobs cannot be offered work until every
-- step is done, including the training videos. People who have already
-- completed a job are past this gate — we do not yank offers from the roster.
--
-- Dress code is split from the old combined "guides" ack. Anyone who already
-- acknowledged that combined step is treated as having agreed to the dress
-- code, so they are not asked to tick a new box for the same picture.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS ob_dress_code_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ob_dress_code_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS ob_training_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ob_training_complete_at timestamptz;

UPDATE public.cleaners
   SET ob_dress_code_ack = true,
       ob_dress_code_ack_at = COALESCE(ob_dress_code_ack_at, ob_job_day_guides_ack_at, now())
 WHERE COALESCE(ob_job_day_guides_ack, false)
   AND NOT COALESCE(ob_dress_code_ack, false);

COMMENT ON COLUMN public.cleaners.ob_dress_code_ack IS
  'Contractor agreed to the dress code shown in onboarding.';
COMMENT ON COLUMN public.cleaners.ob_training_complete IS
  'Every required training walkthrough has been finished (not skipped).';

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
BEGIN
  SELECT
    COALESCE(ob_agreement_signed, false),
    COALESCE(phone_verified, false),
    (supply_checklist_submitted_at IS NOT NULL
      OR COALESCE(ob_supplies_checklist_viewed, false)),
    (COALESCE(ob_dress_code_ack, false)
      OR COALESCE(ob_job_day_guides_ack, false)),
    COALESCE(ob_job_day_guides_ack, false),
    COALESCE(ob_training_complete, false)
  INTO v_agreement_ok, v_phone_ok, v_supplies_ok, v_dress_ok, v_job_day_ok, v_training_ok
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_agreement_ok AND v_phone_ok AND v_supplies_ok AND v_dress_ok AND v_job_day_ok AND v_training_ok
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

-- First-job gate. Completed a job already → eligible. Otherwise every
-- onboarding step, including training videos, must be done.
CREATE OR REPLACE FUNCTION public.cleaner_ready_for_first_job(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c.completed_bookings, 0) > 0
      OR (
        COALESCE(c.ob_agreement_signed, false)
        AND COALESCE(c.phone_verified, false)
        AND (c.supply_checklist_submitted_at IS NOT NULL
          OR COALESCE(c.ob_supplies_checklist_viewed, false))
        AND (COALESCE(c.ob_dress_code_ack, false)
          OR COALESCE(c.ob_job_day_guides_ack, false))
        AND COALESCE(c.ob_job_day_guides_ack, false)
        AND COALESCE(c.ob_training_complete, false)
      )
  FROM public.cleaners c
  WHERE c.id = p_id
$$;

GRANT EXECUTE ON FUNCTION public.cleaner_ready_for_first_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleaner_ready_for_first_job(uuid) TO authenticated;

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
    AND COALESCE(c.ob_training_complete, false)) AS setup_complete,
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
  'Per-contractor onboarding standing (agreement → training) and first-job eligibility.';
