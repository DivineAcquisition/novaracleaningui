-- Recreate commercial_deal_pipeline_v1 without RPC helpers so PostgREST can
-- expose it even when commercial_site_pricing_state / billing_state / coi_status
-- were not applied in the same batch. Missing GRANT + no schema reload is what
-- produced "Could not find the table 'public.commercial_deal_pipeline_v1' in
-- the schema cache" on Proposals → Send.

DROP VIEW IF EXISTS public.commercial_deal_pipeline_v1;

CREATE VIEW public.commercial_deal_pipeline_v1
WITH (security_invoker = true) AS
WITH latest_proposal AS (
  SELECT DISTINCT ON (business_account_id)
    business_account_id, id, version, status, sent_at, expires_at,
    accepted_at, changes_requested_at, change_request_note,
    total_per_visit_cents, recipient_email, recipient_name
  FROM public.commercial_proposals
  ORDER BY business_account_id, version DESC
),
latest_agreement AS (
  SELECT DISTINCT ON (business_account_id)
    business_account_id, id, status, sent_at, signed_at, signer_email
  FROM public.commercial_agreements
  ORDER BY business_account_id, created_at DESC
),
site_rollup AS (
  SELECT
    s.business_account_id,
    count(*) FILTER (WHERE s.active) AS active_sites,
    count(*) FILTER (WHERE s.active AND s.excluded_at IS NOT NULL) AS excluded_sites,
    count(*) FILTER (
      WHERE s.active AND s.excluded_at IS NULL AND COALESCE(s.firm_price_cents, 0) > 0
    ) AS priced_sites
  FROM public.business_sites s
  GROUP BY s.business_account_id
)
SELECT
  a.id                                        AS account_id,
  a.business_name,
  a.account_type,
  a.status                                    AS account_status,
  a.email,
  a.contact_name,
  a.assigned_va_email,
  COALESCE(r.active_sites, 0)                 AS active_sites,
  COALESCE(r.priced_sites, 0)                 AS priced_sites,
  COALESCE(r.excluded_sites, 0)               AS excluded_sites,
  p.id                                        AS proposal_id,
  p.version                                   AS proposal_version,
  p.status                                    AS proposal_status,
  p.sent_at                                   AS proposal_sent_at,
  p.expires_at                                AS proposal_expires_at,
  p.accepted_at                               AS proposal_accepted_at,
  p.changes_requested_at,
  p.change_request_note,
  p.total_per_visit_cents,
  g.id                                        AS agreement_id,
  g.status                                    AS agreement_status,
  g.sent_at                                   AS agreement_sent_at,
  g.signed_at                                 AS agreement_signed_at,
  a.billing_method,
  a.billing_configured_at,
  a.company_coi_sent_at,
  a.requires_coi_on_file,
  (a.billing_configured_at IS NOT NULL)       AS billing_configured,
  false                                       AS coi_blocked,
  CASE
    WHEN COALESCE(g.signed_at, a.agreement_signed_at) IS NOT NULL
     AND a.billing_configured_at IS NOT NULL
     AND COALESCE(r.priced_sites, 0) > 0
     AND COALESCE(r.priced_sites, 0) = COALESCE(r.active_sites, 0) - COALESCE(r.excluded_sites, 0)
      THEN 'dispatch_eligible'
    WHEN COALESCE(g.signed_at, a.agreement_signed_at) IS NOT NULL
     AND a.billing_configured_at IS NOT NULL
      THEN 'pricing_pending'
    WHEN COALESCE(g.signed_at, a.agreement_signed_at) IS NOT NULL THEN 'billing_pending'
    WHEN g.status = 'pending' THEN 'agreement_sent'
    WHEN p.status = 'accepted' THEN 'proposal_accepted'
    WHEN p.status = 'changes_requested' THEN 'changes_requested'
    WHEN p.status = 'sent' THEN 'proposal_sent'
    WHEN p.status = 'expired' THEN 'proposal_expired'
    WHEN COALESCE(r.priced_sites, 0) > 0
     AND COALESCE(r.priced_sites, 0) = COALESCE(r.active_sites, 0) - COALESCE(r.excluded_sites, 0)
      THEN 'firm_price_ready'
    ELSE 'pricing_pending'
  END                                          AS stage
FROM public.business_accounts a
LEFT JOIN latest_proposal p ON p.business_account_id = a.id
LEFT JOIN latest_agreement g ON g.business_account_id = a.id
LEFT JOIN site_rollup r ON r.business_account_id = a.id
WHERE a.account_type IN ('commercial', 'office');

COMMENT ON VIEW public.commercial_deal_pipeline_v1 IS
  'Commercial deals by stage. Table-only so PostgREST can cache it without pricing RPCs.';

GRANT SELECT ON public.commercial_deal_pipeline_v1 TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
