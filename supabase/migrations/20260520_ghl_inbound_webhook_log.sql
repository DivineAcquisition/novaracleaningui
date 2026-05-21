-- Idempotency log for ghl-inbound-webhook.
-- Every incoming webhook is keyed by either the GHL-provided event ID
-- or a SHA-256 of the body if no ID is present. Duplicates are no-ops.

CREATE TABLE IF NOT EXISTS public.ghl_webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id TEXT NOT NULL UNIQUE,
  event_type TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  processing_error TEXT,
  related_lead_id UUID,
  related_booking_id UUID,
  related_customer_id UUID,
  raw_payload JSONB
);
CREATE INDEX IF NOT EXISTS ghl_webhook_log_status_idx ON public.ghl_webhook_log (processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS ghl_webhook_log_event_type_idx ON public.ghl_webhook_log (event_type, received_at DESC);

-- Feature flag (default OFF). Flip to true once you've validated
-- HMAC + payloads in production. Until enabled, the webhook only
-- LOGS payloads, it does not mutate any operational data.
INSERT INTO public.app_secrets (key, value, description)
VALUES
  ('GHL_INBOUND_ENABLED', 'false', 'Set to true to enable ghl-inbound-webhook mutations. Default off for safety.'),
  ('GHL_INBOUND_WEBHOOK_SECRET', '', 'HMAC-SHA256 secret configured in the GHL webhook UI. Required when GHL_INBOUND_ENABLED=true.')
ON CONFLICT (key) DO NOTHING;

-- Bug fix shipped same migration: contact@novaracleaning.com had no
-- admin role + 3 orphaned user_roles rows referenced deleted users,
-- which blocked admin login. Clean + re-seed.
DELETE FROM public.user_roles WHERE user_id NOT IN (SELECT id FROM auth.users);
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'contact@novaracleaning.com'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.ghl_webhook_log IS 'Idempotency log for ghl-inbound-webhook. webhook_id is the dedupe key.';
