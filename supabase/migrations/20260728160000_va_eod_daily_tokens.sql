-- ─── Per-day EOD link tokens, expiring after 24 hours ────────────────────────
--
-- Replaces the durable per-VA token with one token per VA PER DAY.
--
--   * A token is bound to a single work_date. Opening it gives you that day and
--     no other — there is no date picker for a link holder, so a VA cannot walk
--     backwards through the week filling in whatever they like.
--   * A token expires 24 hours after it was issued. A link that leaks out of an
--     inbox stops being a credential by tomorrow.
--   * Only an ADMIN can issue a link for a day other than the VA's current one.
--     The daily cron issues today; backfilling yesterday is a deliberate,
--     attributable act by a named person (issued_by / admin_issued).
--
-- Reissuing for the same day replaces the token (unique on va_id + work_date),
-- so a resend silently revokes the previous link rather than leaving two live.

CREATE TABLE IF NOT EXISTS public.va_eod_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  va_id uuid NOT NULL REFERENCES public.va_onboarding(id) ON DELETE CASCADE,
  work_date date NOT NULL,

  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,

  -- Who issued it. NULL = the daily system send. Set = a named admin, which is
  -- the only way a link for another day comes into existence.
  issued_by uuid,
  issued_by_name text,
  admin_issued boolean NOT NULL DEFAULT false,

  -- Light usage trail: enough to answer "was this link ever opened?" without
  -- turning into activity tracking.
  first_used_at timestamptz,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,

  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT va_eod_link_tokens_token_uniq UNIQUE (token),
  CONSTRAINT va_eod_link_tokens_one_per_day UNIQUE (va_id, work_date)
);

CREATE INDEX IF NOT EXISTS va_eod_link_tokens_va_idx
  ON public.va_eod_link_tokens (va_id, work_date DESC);
CREATE INDEX IF NOT EXISTS va_eod_link_tokens_live_idx
  ON public.va_eod_link_tokens (expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.va_eod_link_tokens IS
  'One EOD link per VA per day, expiring 24h after issue. The token is the credential and is bound to its work_date. Only an admin can issue one for a day other than the VA''s current day.';

DROP TRIGGER IF EXISTS trg_va_eod_link_tokens_touch ON public.va_eod_link_tokens;
CREATE TRIGGER trg_va_eod_link_tokens_touch
  BEFORE UPDATE ON public.va_eod_link_tokens
  FOR EACH ROW EXECUTE FUNCTION public.va_perf_touch_updated_at();

ALTER TABLE public.va_eod_link_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_eod_link_tokens_admin_read ON public.va_eod_link_tokens;
CREATE POLICY va_eod_link_tokens_admin_read ON public.va_eod_link_tokens
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS va_eod_link_tokens_service_role ON public.va_eod_link_tokens;
CREATE POLICY va_eod_link_tokens_service_role ON public.va_eod_link_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Carry over any durable token already in the wild ────────────────────────
--
-- One link has already been emailed. Migrate it in as today's token so it keeps
-- working rather than breaking in someone's inbox, but subject it to the new
-- 24-hour expiry like everything else.

INSERT INTO public.va_eod_link_tokens (token, va_id, work_date, issued_at, expires_at)
SELECT
  v.eod_token,
  v.id,
  (COALESCE(v.eod_token_issued_at, now()) AT TIME ZONE 'America/New_York')::date,
  COALESCE(v.eod_token_issued_at, now()),
  COALESCE(v.eod_token_issued_at, now()) + interval '24 hours'
FROM public.va_onboarding v
WHERE v.eod_token IS NOT NULL
ON CONFLICT (va_id, work_date) DO NOTHING;

ALTER TABLE public.va_onboarding
  DROP COLUMN IF EXISTS eod_token,
  DROP COLUMN IF EXISTS eod_token_issued_at;

-- ─── Link lifetime is configurable, but 24h by default ───────────────────────

UPDATE public.app_settings
SET value = value || jsonb_build_object('link_ttl_hours', 24)
WHERE key = 'va_eod_settings'
  AND NOT (value ? 'link_ttl_hours');

NOTIFY pgrst, 'reload schema';
