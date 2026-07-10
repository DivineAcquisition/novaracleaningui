-- ─── Discord route: contractor dropped a job ────────────────────────────────
--
-- cleaner-drop-job inserts an events row with event_type 'job.dropped' when a
-- contractor drops an assigned job from the portal. Route it to the Dispatch
-- channel with an @Operations ping — a dropped job needs URGENT reassignment.

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('job.dropped', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
