-- Contractor pulse check: 14-day idle cycle, tokenized status form, claimable jobs.
--
-- Reuses existing token minting (hex 20 bytes), events → discord_routes,
-- app_settings, pg_cron + pg_net, and the assignment/accept-job-offer path.
-- This schema never auto-changes cleaner status, eligibility, or scores.

CREATE TABLE IF NOT EXISTS public.pulse_check_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  interval_days integer NOT NULL DEFAULT 14,
  followup_days integer NOT NULL DEFAULT 3,
  token_ttl_days integer NOT NULL DEFAULT 14,
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualifying_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pulse_check_cycles_started_idx
  ON public.pulse_check_cycles (started_at DESC);

CREATE TABLE IF NOT EXISTS public.pulse_check_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.pulse_check_cycles(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  token text,
  token_expires_at timestamptz,
  sent_at timestamptz,
  emailed boolean NOT NULL DEFAULT false,
  sms_sent boolean NOT NULL DEFAULT false,
  followup_sent_at timestamptz,
  opened_at timestamptz,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  answers jsonb,
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'completed', 'needs_review', 'no_response')),
  claimed_job_ids uuid[] NOT NULL DEFAULT '{}',
  claimed_assignment_ids uuid[] NOT NULL DEFAULT '{}',
  claimed_booking_ids uuid[] NOT NULL DEFAULT '{}',
  availability_updated boolean NOT NULL DEFAULT false,
  admin_reviewed_at timestamptz,
  admin_reviewed_by uuid,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, cleaner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pulse_check_entries_token_uidx
  ON public.pulse_check_entries (token)
  WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS pulse_check_entries_cycle_outcome_idx
  ON public.pulse_check_entries (cycle_id, outcome);
CREATE INDEX IF NOT EXISTS pulse_check_entries_cleaner_idx
  ON public.pulse_check_entries (cleaner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pulse_check_entries_pending_idx
  ON public.pulse_check_entries (outcome, sent_at)
  WHERE outcome = 'pending';

COMMENT ON TABLE public.pulse_check_entries IS
  'One pulse-check send per contractor per cycle. Token is unique, auto-expiring, and auto-saves draft answers. Roster status is never written from this table.';

ALTER TABLE public.pulse_check_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_check_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pulse_check_cycles' AND policyname='pulse_cycles_admin_read') THEN
    CREATE POLICY pulse_cycles_admin_read ON public.pulse_check_cycles FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pulse_check_cycles' AND policyname='pulse_cycles_service_role') THEN
    CREATE POLICY pulse_cycles_service_role ON public.pulse_check_cycles FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pulse_check_entries' AND policyname='pulse_entries_admin_read') THEN
    CREATE POLICY pulse_entries_admin_read ON public.pulse_check_entries FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pulse_check_entries' AND policyname='pulse_entries_service_role') THEN
    CREATE POLICY pulse_entries_service_role ON public.pulse_check_entries FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Idle = active + approved + available, with zero work-like assignments in the lookback.
-- Declined / expired / withdrawn / broadcast_lost / needs_reassignment do not count as work.
CREATE OR REPLACE FUNCTION public.pulse_check_idle_cleaner_ids(p_lookback_days integer DEFAULT 14)
RETURNS TABLE (cleaner_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id
  FROM public.cleaners c
  WHERE c.status = 'active'
    AND c.approved IS TRUE
    AND c.available_for_bookings IS TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.job_assignments ja
      WHERE ja.cleaner_id = c.id
        AND ja.created_at >= now() - (GREATEST(1, COALESCE(p_lookback_days, 14)) || ' days')::interval
        AND lower(COALESCE(ja.status, '')) NOT IN (
          'declined', 'expired', 'withdrawn', 'broadcast_lost', 'needs_reassignment'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.pulse_check_idle_cleaner_ids(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pulse_check_idle_cleaner_ids(integer) FROM anon;
REVOKE ALL ON FUNCTION public.pulse_check_idle_cleaner_ids(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pulse_check_idle_cleaner_ids(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mint_cleaner_pulse_token(
  p_entry_id uuid,
  p_ttl_days integer DEFAULT 14
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pulse_check_entries WHERE id = p_entry_id) THEN
    RETURN NULL;
  END IF;

  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.pulse_check_entries
    SET token = v_token,
        token_expires_at = now() + (GREATEST(1, COALESCE(p_ttl_days, 14)) || ' days')::interval,
        updated_at = now()
    WHERE id = p_entry_id;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_cleaner_pulse_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_pulse_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_pulse_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_pulse_token(uuid, integer) TO service_role;

CREATE OR REPLACE VIEW public.cleaner_pulse_status_v1 AS
SELECT
  e.id AS entry_id,
  e.cycle_id,
  cy.started_at AS cycle_started_at,
  cy.interval_days,
  e.cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.email,
  c.phone,
  c.status AS cleaner_status,
  e.outcome,
  e.sent_at,
  e.emailed,
  e.sms_sent,
  e.followup_sent_at,
  e.opened_at,
  e.submitted_at,
  e.answers,
  e.draft,
  e.claimed_job_ids,
  e.claimed_assignment_ids,
  e.claimed_booking_ids,
  COALESCE(array_length(e.claimed_job_ids, 1), 0) AS claimed_job_count,
  e.availability_updated,
  e.admin_reviewed_at,
  e.admin_note,
  e.token_expires_at,
  e.token IS NOT NULL
    AND (e.token_expires_at IS NULL OR e.token_expires_at > now()) AS link_outstanding
FROM public.pulse_check_entries e
JOIN public.pulse_check_cycles cy ON cy.id = e.cycle_id
JOIN public.cleaners c ON c.id = e.cleaner_id;

COMMENT ON VIEW public.cleaner_pulse_status_v1 IS
  'Per-cycle pulse-check standing: response, answers, and whether they claimed a job. Permanent history on the contractor record.';

GRANT SELECT ON public.cleaner_pulse_status_v1 TO authenticated, service_role;
GRANT SELECT ON public.pulse_check_cycles TO authenticated, service_role;
GRANT SELECT ON public.pulse_check_entries TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'pulse_check_settings',
  '{"enabled": true, "interval_days": 14, "followup_days": 3, "token_ttl_days": 14}'::jsonb,
  'Contractor pulse check. Recurring cycle for active contractors with zero assignments in the lookback. Token TTL and the single in-cycle follow-up are admin-configurable. Never auto-changes roster status.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.pulse_cycle_ran', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.pulse_responded', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.pulse_claimed', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.pulse_stale', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pulse-check-runner') THEN
    PERFORM cron.unschedule('pulse-check-runner');
  END IF;
  PERFORM cron.schedule(
    'pulse-check-runner',
    '5 14 * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_URL') || '/functions/v1/pulse-check-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce((SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY'), ''),
          'x-cron-secret', coalesce((SELECT value FROM public.app_secrets WHERE key = 'CRON_SECRET'), '')
        ),
        body := jsonb_build_object('source', 'pg_cron')
      );
    $cron$
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — pulse-check-runner not scheduled.';
END $$;
