-- Portal access is passwordless. Progress treats portal_created_at (set when
-- the partner identity is linked) as portal-ready, not only a Supabase auth user.

CREATE OR REPLACE FUNCTION public.commercial_onboarding_progress(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session   public.commercial_onboarding_sessions%ROWTYPE;
  v_proposal  public.commercial_proposals%ROWTYPE;
  v_agreement public.commercial_agreements%ROWTYPE;
  v_account   public.business_accounts%ROWTYPE;
  v_billing   jsonb;
  v_pricing   boolean := false;
  v_signed    boolean := false;
  v_billed    boolean := false;
  v_portal    boolean := false;
  v_paused    boolean := false;
  v_current   text;
BEGIN
  SELECT * INTO v_session FROM public.commercial_onboarding_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_account FROM public.business_accounts WHERE id = v_session.business_account_id;

  IF v_session.proposal_id IS NOT NULL THEN
    SELECT * INTO v_proposal FROM public.commercial_proposals WHERE id = v_session.proposal_id;
  END IF;
  IF v_session.agreement_id IS NOT NULL THEN
    SELECT * INTO v_agreement FROM public.commercial_agreements WHERE id = v_session.agreement_id;
  END IF;

  v_pricing := COALESCE(v_proposal.status = 'accepted', false)
               OR v_agreement.id IS NOT NULL;
  v_paused  := COALESCE(v_proposal.status = 'changes_requested', false);
  v_signed := COALESCE(v_agreement.status = 'signed', false);
  v_billing := public.commercial_billing_state(v_session.business_account_id);
  v_billed  := COALESCE((v_billing ->> 'configured')::boolean, false);
  v_portal := v_account.portal_user_id IS NOT NULL
              OR v_account.portal_created_at IS NOT NULL;

  v_current := CASE
    WHEN v_paused        THEN 'paused'
    WHEN NOT v_pricing   THEN 'pricing'
    WHEN NOT v_signed    THEN 'agreement'
    WHEN NOT v_billed    THEN 'billing'
    WHEN NOT v_portal    THEN 'portal'
    ELSE 'done'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'account_id', v_session.business_account_id,
    'status', v_session.status,
    'billing_method', v_session.billing_method,
    'current_step', v_current,
    'paused_for_changes', v_paused,
    'complete', (v_pricing AND v_signed AND v_billed AND v_portal),
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'pricing',   'label', 'Review pricing and terms', 'done', v_pricing),
      jsonb_build_object('key', 'agreement', 'label', 'Sign the services agreement', 'done', v_signed),
      jsonb_build_object('key', 'billing',   'label',
        CASE WHEN v_session.billing_method = 'auto_pay'
             THEN 'Add a payment method for Auto-Pay'
             ELSE 'Confirm your billing contact and terms' END,
        'done', v_billed),
      jsonb_build_object('key', 'portal',    'label', 'Open your partner portal', 'done', v_portal)
    ),
    'compliance', public.commercial_account_compliance(v_session.business_account_id),
    'billing', v_billing
  );
END;
$$;

COMMENT ON FUNCTION public.commercial_onboarding_progress(uuid) IS
  'Derives session step from proposal, agreement, billing, and passwordless portal access (portal_created_at or portal_user_id).';
