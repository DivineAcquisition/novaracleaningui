-- ─── Customer self-service recurring management links ──────────────────────
--
-- Every recurring schedule gets a stable manage_token powering the tokenized
-- customer page app.novaracleaning.com/manage-recurring/<token> (sent via
-- SMS). Customers can move their next clean's date/time, skip a visit,
-- change frequency, pause/resume, or request a different cleaner — no login.

ALTER TABLE public.customer_recurring_schedules
  ADD COLUMN IF NOT EXISTS manage_token text;

-- Backfill tokens for existing schedules (md5(uuid+clock) = 32 hex chars,
-- no pgcrypto dependency).
UPDATE public.customer_recurring_schedules
  SET manage_token = md5(gen_random_uuid()::text || clock_timestamp()::text)
  WHERE manage_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_recurring_manage_token_idx
  ON public.customer_recurring_schedules (manage_token);

-- Internal ops visibility: customer-initiated recurring changes land in the
-- dispatch Discord channel (admin-facing).
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('recurring.customer_update', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

NOTIFY pgrst, 'reload schema';
