-- Pulse check stay / pause / leave can now write roster status.
-- Short pause stamps inactive_until. Leaving stamps reapply_eligible_at (3 months).

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS inactive_until timestamptz,
  ADD COLUMN IF NOT EXISTS reapply_eligible_at timestamptz;

COMMENT ON COLUMN public.cleaners.inactive_until IS
  'When a pulse-check pause ends. Status is inactive until then; office can reactivate sooner.';
COMMENT ON COLUMN public.cleaners.reapply_eligible_at IS
  'Earliest date a terminated contractor may apply again (pulse-check leave = 3 months).';

CREATE INDEX IF NOT EXISTS cleaners_reapply_eligible_idx
  ON public.cleaners (reapply_eligible_at)
  WHERE reapply_eligible_at IS NOT NULL;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.pulse_responded', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.deactivated', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.terminated', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

NOTIFY pgrst, 'reload schema';
