-- ─── Tokenized EOD links, delivered to the VA ────────────────────────────────
--
-- The EOD form was reachable only with a workspace login, which most VAs don't
-- have — so in practice nobody could open it. Each VA now gets a durable,
-- rotatable link token, and the link is sent to them by email and Discord.
--
-- Same shape as the other tokenized self-service links in this codebase
-- (bookings.pay_page_token, bookings.photo_view_token,
-- customer_recurring_schedules.manage_token): a long random hex string that IS
-- the credential, stable so it can be bookmarked, revocable by rotating it.
--
-- Scope of what the token grants: that one VA's own EOD for the dates still
-- inside the admin backdate window, and nothing else. It cannot read another
-- VA's day, cannot reach the admin surface, and cannot write a verified metric.
-- The API also re-checks the VA's status on every call, so offboarding kills
-- the link without needing to rotate it.
--
-- ─── Why Discord delivery is per-VA, not a shared channel ────────────────────
--
-- The token is a bearer credential: whoever holds the link can submit that
-- VA's EOD. Posting it into the shared ops channel would hand everyone in that
-- channel the ability to file someone else's report, which would quietly
-- destroy the attribution the whole verification layer depends on.
--
-- Discord has no DM API here (webhook-to-channel only — see
-- supabase/functions/_shared/discord.ts), so each VA gets an optional private
-- channel webhook on their record. When it's set, their link goes there and
-- nowhere else. When it isn't, the shared channel gets a reminder naming the
-- VA with NO token in it, and the link goes by email only.

ALTER TABLE public.va_onboarding
  -- The link credential. NULL until first minted.
  ADD COLUMN IF NOT EXISTS eod_token text,
  ADD COLUMN IF NOT EXISTS eod_token_issued_at timestamptz,
  -- Last time the link was delivered, so the daily reminder is idempotent.
  ADD COLUMN IF NOT EXISTS eod_link_last_sent_at timestamptz,
  -- Private per-VA Discord webhook. Never a shared channel — see above.
  ADD COLUMN IF NOT EXISTS discord_webhook_url text;

CREATE UNIQUE INDEX IF NOT EXISTS va_onboarding_eod_token_uniq
  ON public.va_onboarding (eod_token)
  WHERE eod_token IS NOT NULL;

COMMENT ON COLUMN public.va_onboarding.eod_token IS
  'Bearer credential for eod.novaracleaning.com/eod/<token>. Grants that VA their own EOD only. Rotate to revoke.';
COMMENT ON COLUMN public.va_onboarding.discord_webhook_url IS
  'Private per-VA Discord channel webhook. The tokenized EOD link is only ever posted here, never to a shared channel.';

-- ─── Discord routes for the reminder + delivery audit ────────────────────────

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES
  ('va.eod.reminder', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true),
  ('va.eod.link_sent', 'DISCORD_WEBHOOK_CLEANERS', ARRAY[]::text[], true)
ON CONFLICT (event_type) DO NOTHING;

-- ─── Daily send ──────────────────────────────────────────────────────────────

INSERT INTO public.app_secrets (key, value, description)
VALUES
  ('VA_EOD_LINK_URL', 'https://admin.novaracleaning.com/api/va/eod/send-link',
   'Next.js route that mints and delivers each VA''s tokenized EOD link by email + Discord.'),
  ('EOD_PUBLIC_BASE_URL', 'https://eod.novaracleaning.com',
   'Public origin for the VA end-of-day form. Used to build tokenized links.')
ON CONFLICT (key) DO NOTHING;

-- Reuse the metrics-sync secret so there is one shared cron credential for the
-- VA performance surface rather than two that can drift apart.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('va-eod-link-daily') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'va-eod-link-daily'
    );
    PERFORM cron.schedule(
      'va-eod-link-daily',
      -- 20:30 UTC ≈ 16:30 America/New_York — an hour before the 17:30 cutoff,
      -- so the reminder arrives while there's still time to file on time.
      '30 20 * * 1-5',
      $CRON$
        SELECT net.http_post(
          url := (SELECT value FROM public.app_secrets WHERE key = 'VA_EOD_LINK_URL')
                 || '?secret=' || (SELECT value FROM public.app_secrets WHERE key = 'VA_METRICS_SYNC_SECRET'),
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object('action', 'send_all', 'source', 'pg_cron'),
          timeout_milliseconds := 120000
        )
        WHERE COALESCE((SELECT value FROM public.app_secrets WHERE key = 'VA_EOD_LINK_URL'), '') <> '';
      $CRON$
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
