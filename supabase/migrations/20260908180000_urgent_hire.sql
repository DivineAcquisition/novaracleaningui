-- ─── Urgent Hire: emergency applicant broadcast tied to onboarding ──────────
--
-- Last-resort coverage when the assigned cleaner and the designated backup
-- pool cannot fill a job. Admin broadcasts simultaneously to pipeline
-- applicants (Screening-Passed or later, not yet Active, never Declined)
-- within a configurable radius. First to finish remaining onboarding
-- (valid supply checklist, signed agreement, payout setup — NOT background
-- check) and accept wins, paid at a configurable first-job premium (default
-- 45%). Subsequent jobs use standing Foundation / Novara Score tiers.
--
-- Reuses existing dispatch assignment, onboarding tokens, SMS/email, and
-- geo-matching. This is behaviour on top of those systems, not a parallel
-- hiring or assignment stack.

-- ─── 1. Tunables ────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, description) VALUES (
  'urgent_hire_settings',
  jsonb_build_object(
    'radius_miles', 25,
    'pay_percent', 45,
    'first_job_only', true,
    'fill_window_minutes', 90,
    'checklist_freshness_days', 30
  ),
  'Urgent Hire: radius (miles), premium first-job pay %, first-job-only copy, fill window, supply-checklist freshness.'
)
ON CONFLICT (key) DO NOTHING;

-- Stamp on the assignment so complete-booking does not overwrite the premium
-- with the standing Foundation rate, and so later jobs are never paid at 45%
-- just because this cleaner came in through Urgent Hire.
ALTER TABLE public.job_assignments
  ADD COLUMN IF NOT EXISTS pay_source text;

COMMENT ON COLUMN public.job_assignments.pay_source IS
  'When ''urgent_hire'', pay_percentage_snapshot is the Urgent Hire premium for THIS job only and must not be recomputed from standing tier at completion.';

-- ─── 2. Broadcasts ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.urgent_hire_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  initiated_by uuid,
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending','open','filled','unfilled','cancelled')),
  radius_miles numeric NOT NULL DEFAULT 25,
  pay_percent numeric NOT NULL DEFAULT 45,
  first_job_only boolean NOT NULL DEFAULT true,
  fill_window_minutes integer NOT NULL DEFAULT 90,
  checklist_freshness_days integer NOT NULL DEFAULT 30,
  fill_deadline_at timestamptz NOT NULL,
  eligible_count integer NOT NULL DEFAULT 0,
  reached_count integer NOT NULL DEFAULT 0,
  skipped_no_location integer NOT NULL DEFAULT 0,
  filled_by_cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  filled_by_applicant_id uuid REFERENCES public.cleaner_applicants(id) ON DELETE SET NULL,
  filled_at timestamptz,
  unfilled_at timestamptz,
  cancelled_at timestamptz,
  job_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uhb_open_job_idx
  ON public.urgent_hire_broadcasts (job_id)
  WHERE status IN ('sending','open');

CREATE INDEX IF NOT EXISTS uhb_status_deadline_idx
  ON public.urgent_hire_broadcasts (status, fill_deadline_at);

CREATE INDEX IF NOT EXISTS uhb_job_idx
  ON public.urgent_hire_broadcasts (job_id, created_at DESC);

ALTER TABLE public.urgent_hire_broadcasts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_urgent_hire_broadcasts ON public.urgent_hire_broadcasts;
CREATE TRIGGER set_timestamp_urgent_hire_broadcasts
  BEFORE UPDATE ON public.urgent_hire_broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.urgent_hire_broadcasts IS
  'One Urgent Hire blast per open job. Reaches pipeline applicants simultaneously. Outcome is filled (who, elapsed) or unfilled (still needs coverage) — never a silent expiry.';

-- ─── 3. Offers ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.urgent_hire_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.urgent_hire_broadcasts(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.cleaner_applicants(id) ON DELETE CASCADE,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  applicant_name text,
  applicant_phone text,
  applicant_email text,
  distance_miles numeric,
  had_valid_checklist boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered','viewed','progressing','accepted','withdrawn','expired')),
  response_token text NOT NULL,
  last_step text,
  sms_sent_at timestamptz,
  email_sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  notify_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uho_token_idx
  ON public.urgent_hire_offers (response_token);

CREATE UNIQUE INDEX IF NOT EXISTS uho_live_unique_idx
  ON public.urgent_hire_offers (broadcast_id, applicant_id);

CREATE INDEX IF NOT EXISTS uho_broadcast_idx
  ON public.urgent_hire_offers (broadcast_id, status);

CREATE INDEX IF NOT EXISTS uho_open_idx
  ON public.urgent_hire_offers (status) WHERE status IN ('offered','viewed','progressing');

ALTER TABLE public.urgent_hire_offers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_timestamp_urgent_hire_offers ON public.urgent_hire_offers;
CREATE TRIGGER set_timestamp_urgent_hire_offers
  BEFORE UPDATE ON public.urgent_hire_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.urgent_hire_offers IS
  'Per-applicant Urgent Hire offer. Recipients without a valid supply checklist still receive the blast but cannot accept until the checklist is completed and fresh. Losers keep onboarding progress.';

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['urgent_hire_broadcasts','urgent_hire_offers'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_admin_all') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin_or_va(auth.uid())) WITH CHECK (public.is_admin_or_va(auth.uid()))',
        t || '_admin_all', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_service_role') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t || '_service_role', t);
    END IF;
  END LOOP;
END$$;

-- ─── 5. First-claim-wins ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_urgent_hire_offer(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_o record;
  v_b record;
  v_withdrawn int := 0;
BEGIN
  SELECT * INTO v_o FROM public.urgent_hire_offers WHERE response_token = p_token FOR UPDATE;
  IF v_o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'That link isn''t valid.');
  END IF;

  SELECT * INTO v_b FROM public.urgent_hire_broadcasts WHERE id = v_o.broadcast_id FOR UPDATE;

  IF v_o.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'ok', true, 'code', 'already_yours',
      'offerId', v_o.id, 'jobId', v_o.job_id,
      'cleanerId', v_o.cleaner_id, 'applicantId', v_o.applicant_id,
      'broadcastId', v_o.broadcast_id
    );
  END IF;

  IF v_o.status NOT IN ('offered','viewed','progressing') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', v_o.status,
      'error', CASE v_o.status
        WHEN 'withdrawn' THEN 'This job is no longer available — someone else finished first.'
        WHEN 'expired' THEN 'This Urgent Hire window has closed.'
        ELSE 'This job is no longer available.'
      END
    );
  END IF;

  IF v_b.status = 'filled' THEN
    UPDATE public.urgent_hire_offers
      SET status = 'withdrawn', updated_at = now()
      WHERE id = v_o.id AND status IN ('offered','viewed','progressing');
    RETURN jsonb_build_object(
      'ok', false, 'code', 'taken',
      'error', 'This job is no longer available — someone else finished first.'
    );
  END IF;

  IF v_b.status NOT IN ('sending','open') THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', v_b.status,
      'error', CASE v_b.status
        WHEN 'unfilled' THEN 'This Urgent Hire window has closed. Keep your onboarding progress — you''re still in the pipeline.'
        WHEN 'cancelled' THEN 'This offer was cancelled.'
        ELSE 'This job is no longer available.'
      END
    );
  END IF;

  IF v_b.fill_deadline_at <= now() THEN
    UPDATE public.urgent_hire_offers
      SET status = 'expired', updated_at = now()
      WHERE id = v_o.id AND status IN ('offered','viewed','progressing');
    RETURN jsonb_build_object(
      'ok', false, 'code', 'expired',
      'error', 'This Urgent Hire window has closed. Keep your onboarding progress — you''re still in the pipeline.'
    );
  END IF;

  UPDATE public.urgent_hire_offers
    SET status = 'accepted', accepted_at = now(), updated_at = now()
    WHERE id = v_o.id;

  UPDATE public.urgent_hire_broadcasts
    SET status = 'filled',
        filled_by_cleaner_id = v_o.cleaner_id,
        filled_by_applicant_id = v_o.applicant_id,
        filled_at = now(),
        updated_at = now()
    WHERE id = v_o.broadcast_id;

  WITH pulled AS (
    UPDATE public.urgent_hire_offers
      SET status = 'withdrawn', updated_at = now()
      WHERE broadcast_id = v_o.broadcast_id
        AND id <> v_o.id
        AND status IN ('offered','viewed','progressing')
      RETURNING id
  )
  SELECT count(*)::int INTO v_withdrawn FROM pulled;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'claimed',
    'offerId', v_o.id, 'jobId', v_o.job_id,
    'cleanerId', v_o.cleaner_id, 'applicantId', v_o.applicant_id,
    'broadcastId', v_o.broadcast_id,
    'withdrawn', v_withdrawn
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_urgent_hire_offer(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_urgent_hire_offer(text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_urgent_hire_offer(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_urgent_hire_offer(text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_urgent_hire_claim(p_offer_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_broadcast uuid;
BEGIN
  SELECT broadcast_id INTO v_broadcast
  FROM public.urgent_hire_offers
  WHERE id = p_offer_id AND status = 'accepted';
  IF v_broadcast IS NULL THEN RETURN; END IF;

  UPDATE public.urgent_hire_offers
    SET status = 'progressing',
        accepted_at = NULL,
        notify_error = left(COALESCE(p_error, 'assignment failed'), 500),
        updated_at = now()
    WHERE id = p_offer_id AND status = 'accepted';

  UPDATE public.urgent_hire_offers
    SET status = 'offered', updated_at = now()
    WHERE broadcast_id = v_broadcast
      AND status = 'withdrawn'
      AND id <> p_offer_id;

  UPDATE public.urgent_hire_broadcasts
    SET status = 'open',
        filled_by_cleaner_id = NULL,
        filled_by_applicant_id = NULL,
        filled_at = NULL,
        updated_at = now()
    WHERE id = v_broadcast AND status = 'filled';
END;
$$;

REVOKE ALL ON FUNCTION public.release_urgent_hire_claim(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_urgent_hire_claim(uuid, text) TO service_role;

-- Close broadcasts whose fill window passed with nobody accepting.
-- Surfaces as unfilled — admin still needs coverage. Offers expire with a
-- clear status, not a silent drop.
CREATE OR REPLACE FUNCTION public.expire_urgent_hire_broadcasts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_broadcasts int := 0;
  v_offers int := 0;
BEGIN
  WITH closed AS (
    UPDATE public.urgent_hire_broadcasts
      SET status = 'unfilled',
          unfilled_at = COALESCE(unfilled_at, now()),
          updated_at = now()
      WHERE status IN ('sending','open')
        AND fill_deadline_at <= now()
      RETURNING id
  ),
  expired AS (
    UPDATE public.urgent_hire_offers o
      SET status = 'expired', updated_at = now()
      FROM closed c
      WHERE o.broadcast_id = c.id
        AND o.status IN ('offered','viewed','progressing')
      RETURNING o.id
  )
  SELECT
    (SELECT count(*) FROM closed),
    (SELECT count(*) FROM expired)
  INTO v_broadcasts, v_offers;

  RETURN jsonb_build_object('ok', true, 'broadcasts', v_broadcasts, 'offers', v_offers);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_urgent_hire_broadcasts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_urgent_hire_broadcasts() TO service_role;

-- ─── 6. Discord routes (internal ops) ───────────────────────────────────────

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES
  ('urgent_hire.broadcast_sent', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true),
  ('urgent_hire.filled', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true),
  ('urgent_hire.unfilled', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true)
ON CONFLICT (event_type) DO NOTHING;
