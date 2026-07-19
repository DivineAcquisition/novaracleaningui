-- Tokenized post-job feedback routing
--
-- One row per completed booking: a single-purpose, unguessable token that
-- opens the /feedback/<token> page. Three answers (overall / cleaner /
-- quality) are captured before routing; overall >= threshold goes to the
-- tip + Google review path, below goes into the existing QC hub.
--
-- NOTE: this migration was applied to production as version 20260719034759.
CREATE TABLE IF NOT EXISTS public.job_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','answers_saved','positive_complete','qc_complete','expired')),
  overall_rating smallint CHECK (overall_rating IS NULL OR (overall_rating BETWEEN 1 AND 5)),
  cleaner_rating smallint CHECK (cleaner_rating IS NULL OR (cleaner_rating BETWEEN 1 AND 5)),
  quality_rating smallint CHECK (quality_rating IS NULL OR (quality_rating BETWEEN 1 AND 5)),
  path text CHECK (path IS NULL OR path IN ('positive','qc')),
  qc_issue_id uuid REFERENCES public.qc_issues(id) ON DELETE SET NULL,
  tip_started_at timestamptz,
  google_clicked_at timestamptz,
  answers_saved_at timestamptz,
  completed_at timestamptz,
  sent_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_feedback_token_idx ON public.job_feedback (token);
CREATE INDEX IF NOT EXISTS job_feedback_status_idx ON public.job_feedback (status);
CREATE INDEX IF NOT EXISTS job_feedback_expires_idx ON public.job_feedback (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.job_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'job_feedback' AND policyname = 'job_feedback_admin_all'
  ) THEN
    CREATE POLICY job_feedback_admin_all ON public.job_feedback
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'job_feedback' AND policyname = 'job_feedback_service_role'
  ) THEN
    CREATE POLICY job_feedback_service_role ON public.job_feedback
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Customer feedback becomes a first-class QC issue source.
ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_reported_via_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_reported_via_check
  CHECK (reported_via IN ('va','admin','cleaner_field','system','customer'));

-- Admin-tunable knobs (app_secrets doubles as our config table).
INSERT INTO public.app_secrets (key, value)
VALUES
  ('FEEDBACK_POSITIVE_MIN_RATING', '4'),
  ('FEEDBACK_TOKEN_TTL_DAYS', '14'),
  ('FEEDBACK_GOOGLE_REVIEW_URL', 'https://g.page/r/Cc8fVvoYgXkaEAI/review')
ON CONFLICT (key) DO NOTHING;
