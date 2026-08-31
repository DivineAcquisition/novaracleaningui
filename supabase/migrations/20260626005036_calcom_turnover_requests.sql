-- ─── Cal.com interim turnover requests ─────────────────────────────────────
--
-- Part B of the Host Turnover Calendar spec: a stopgap that captures turnover
-- requests via a Cal.com booking link while the in-portal calendar (Part A)
-- ships. Cal.com bookings land as turnover_requests rows in status
-- 'pending_payment' (a REQUEST — nothing is dispatched until ops prices +
-- charges via the existing Stripe flow).
--
-- Adds:
--   source              where the request originated (e.g. 'cal.com', 'portal')
--   calcom_booking_uid  Cal.com booking uid → idempotency key (no dupes on retry)

ALTER TABLE public.turnover_requests
  ADD COLUMN IF NOT EXISTS source             text,
  ADD COLUMN IF NOT EXISTS calcom_booking_uid text;

CREATE UNIQUE INDEX IF NOT EXISTS turnover_requests_calcom_uid_unique
  ON public.turnover_requests (calcom_booking_uid)
  WHERE calcom_booking_uid IS NOT NULL;

-- Webhook secret placeholder (operators paste the Cal.com signing secret).
INSERT INTO public.app_secrets (key, value, description) VALUES
  ('CALCOM_WEBHOOK_SECRET', '',
    'Cal.com webhook signing secret. When set, calcom-webhook verifies the X-Cal-Signature-256 HMAC; when empty it accepts unsigned (interim launch only).')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
