-- ─── Point dispatch-eligibility fix_path at the remapped Commercial hub ────
--
-- The Partnerships tab is now Commercial at /admin/commercial. Refusal
-- messages that name a console have to land on the tab that actually
-- fixes the gap:
--   firm price  → Walkthroughs
--   agreement / billing → Pipeline (follow-up) / Send Proposal
--   COI         → Compliance

CREATE OR REPLACE FUNCTION public.commercial_site_dispatch_eligibility(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site public.business_sites%ROWTYPE;
  v_acct public.business_accounts%ROWTYPE;
  v_pricing jsonb;
  v_compliance jsonb;
  v_billing jsonb;
  v_coi jsonb;
  v_reqs jsonb := '[]'::jsonb;
  v_outstanding text[] := ARRAY[]::text[];
  v_price_ok boolean;
  v_agreement_ok boolean;
  v_billing_ok boolean;
  v_coi_ok boolean;
  v_detail text;
BEGIN
  SELECT * INTO v_site FROM public.business_sites WHERE id = p_site_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'eligible', false,
                              'message', 'Site not found.');
  END IF;

  SELECT * INTO v_acct FROM public.business_accounts
  WHERE id = v_site.business_account_id;

  v_pricing := public.commercial_site_pricing_state(p_site_id);
  v_compliance := public.commercial_account_compliance(v_site.business_account_id);
  v_billing := v_compliance -> 'billing';
  v_coi := v_compliance -> 'coi';

  v_price_ok := (v_pricing ->> 'eligible')::boolean;
  v_detail := CASE WHEN v_price_ok
    THEN CASE v_pricing ->> 'stage'
           WHEN 'formula_priced' THEN 'Priced by the rate engine — under the walkthrough threshold.'
           ELSE format('Firm price set: $%s per visit.',
                       to_char(COALESCE(v_site.firm_price_cents, 0) / 100.0, 'FM999999990.00'))
         END
    ELSE COALESCE(v_pricing ->> 'reason', 'This site has no firm price yet.')
  END;
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'firm_price', 'label', 'Firm price', 'met', v_price_ok, 'detail', v_detail,
    'fix_path', '/admin/commercial?tab=walkthroughs');
  IF NOT v_price_ok THEN
    v_outstanding := array_append(v_outstanding, 'a firm price for this site');
  END IF;

  v_agreement_ok := v_acct.agreement_signed_at IS NOT NULL;
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'signed_agreement', 'label', 'Signed agreement', 'met', v_agreement_ok,
    'detail', CASE WHEN v_agreement_ok
      THEN format('Signed %s.', to_char(v_acct.agreement_signed_at, 'Mon DD, YYYY'))
      ELSE 'No signed agreement on the account.' END,
    'fix_path', '/admin/commercial?tab=send');
  IF NOT v_agreement_ok THEN
    v_outstanding := array_append(v_outstanding, 'a signed agreement');
  END IF;

  v_billing_ok := (v_billing ->> 'configured')::boolean;
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'billing_configured', 'label', 'Billing configured', 'met', v_billing_ok,
    'detail', COALESCE(v_billing ->> 'summary', v_billing ->> 'reason'),
    'fix_path', '/admin/commercial?tab=pipeline');
  IF NOT v_billing_ok THEN
    v_outstanding := array_append(v_outstanding, 'billing setup');
  END IF;

  v_coi_ok := NOT COALESCE((v_coi ->> 'blocked')::boolean, true);
  v_reqs := v_reqs || jsonb_build_object(
    'key', 'coi_current', 'label', 'Certificate of insurance', 'met', v_coi_ok,
    'detail', CASE
      WHEN v_coi_ok AND (v_coi -> 'override') IS NOT NULL
           AND (v_coi -> 'override') <> 'null'::jsonb
        THEN 'Block temporarily overridden — not the same as cover.'
      WHEN v_coi_ok THEN format('Current through %s.',
                                to_char(v_acct.coi_expires_at, 'Mon DD, YYYY'))
      WHEN v_acct.coi_expires_at IS NULL THEN 'No current certificate of insurance on file.'
      ELSE format('Expired %s.', to_char(v_acct.coi_expires_at, 'Mon DD, YYYY'))
    END,
    'fix_path', '/admin/commercial?tab=compliance');
  IF NOT v_coi_ok THEN
    v_outstanding := array_append(v_outstanding, 'a current certificate of insurance');
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'eligible', cardinality(v_outstanding) = 0,
    'site_id', p_site_id,
    'site_nickname', v_site.nickname,
    'account_id', v_site.business_account_id,
    'business_name', v_acct.business_name,
    'requirements', v_reqs,
    'outstanding', to_jsonb(v_outstanding),
    'message', CASE WHEN cardinality(v_outstanding) = 0
      THEN format('%s is ready to book and dispatch.', v_site.nickname)
      ELSE format('%s at %s is not ready to dispatch — still outstanding: %s.',
                  v_site.nickname, v_acct.business_name,
                  array_to_string(v_outstanding, ', '))
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_site_dispatch_eligibility(uuid) TO authenticated, service_role;
