-- ─── Live phone-screening form + generated screening record ───────────────────
--
-- The VA runs the screening call FROM the form: it opens off an applicant in
-- the cleaner hub, auto-saves continuously as a draft, and on submit becomes a
-- permanent screening record (answers, individual consents, scorecard,
-- recommendation, screener + timestamps) with a branded PDF attached to the
-- applicant. This migration adds:
--
--   1. public.phone_screenings — one row per screening run. Drafts are
--      editable; SUBMITTED rows are immutable (trigger-enforced) except for
--      the PDF bookkeeping columns, so consents stay a trustworthy legal
--      record. A re-screen is a NEW row — history is always retained.
--   2. Hold routing on cleaner_applicants: a 'hold' stage plus the pending
--      item + follow-up date, and a daily cron that surfaces due holds on the
--      existing events → Discord channel so they resurface instead of being
--      forgotten.
--   3. Private storage bucket 'screening-records' for the generated PDFs
--      (same pattern as service-agreements).
--   4. Discord routes for screening outcomes and due holds.

-- ─── 1. phone_screenings ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.phone_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES public.cleaner_applicants(id) ON DELETE CASCADE,

  -- draft → submitted. Submitted rows are immutable (see trigger below).
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),

  -- Live-call payload. Structured per-question keys (shape defined in
  -- src/lib/phone-screening.ts — the single source of truth for the form,
  -- the PDF, and validation), NOT one free-text blob.
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Individual consent captures — the legal record. Each key holds
  -- { value: 'yes'|'no', note, at (ISO), by (user id), by_name }.
  consents jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Scorecard ratings (availability_fit, experience_standards,
  -- communication_professionalism, scenario_judgment: 1–5).
  scorecard jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Outcome
  recommendation text CHECK (recommendation IN ('advance','hold','decline')),
  decline_reason text,        -- standardized code from src/lib/phone-screening.ts
  decline_notes text,
  hold_pending text,          -- what is pending (fixable qualifier, consent pushback…)
  hold_follow_up_date date,

  -- Who ran the screen + when — captured automatically, never typed.
  screener_id uuid,
  screener_name text,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,

  -- Generated screening-record PDF. The screening row is saved FIRST; a
  -- failed generation flags here for retry and never discards the record.
  pdf_path text,
  pdf_status text NOT NULL DEFAULT 'none' CHECK (pdf_status IN ('none','generated','failed')),
  pdf_attempts integer NOT NULL DEFAULT 0,
  pdf_last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_screenings_applicant
  ON public.phone_screenings (applicant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_screenings_status
  ON public.phone_screenings (status);

ALTER TABLE public.phone_screenings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admin/VA manage phone screenings" ON public.phone_screenings
    FOR ALL USING (public.is_admin_or_va(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full_access" ON public.phone_screenings
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Keep updated_at fresh + enforce immutability of submitted screenings.
-- After submit, ONLY the PDF bookkeeping columns may change — answers,
-- consents, scorecard, and the outcome are frozen. Corrections happen by
-- running a new screening; both are retained.
CREATE OR REPLACE FUNCTION public.phone_screenings_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'submitted' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.answers IS DISTINCT FROM OLD.answers
       OR NEW.consents IS DISTINCT FROM OLD.consents
       OR NEW.scorecard IS DISTINCT FROM OLD.scorecard
       OR NEW.recommendation IS DISTINCT FROM OLD.recommendation
       OR NEW.decline_reason IS DISTINCT FROM OLD.decline_reason
       OR NEW.decline_notes IS DISTINCT FROM OLD.decline_notes
       OR NEW.hold_pending IS DISTINCT FROM OLD.hold_pending
       OR NEW.hold_follow_up_date IS DISTINCT FROM OLD.hold_follow_up_date
       OR NEW.screener_id IS DISTINCT FROM OLD.screener_id
       OR NEW.screener_name IS DISTINCT FROM OLD.screener_name
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.applicant_id IS DISTINCT FROM OLD.applicant_id THEN
      RAISE EXCEPTION 'Submitted screenings are immutable — run a new screening to make a correction.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_phone_screenings_guard ON public.phone_screenings;
CREATE TRIGGER trg_phone_screenings_guard
BEFORE UPDATE ON public.phone_screenings
FOR EACH ROW EXECUTE FUNCTION public.phone_screenings_guard();

-- Submitted screenings can never be deleted (drafts can be abandoned).
CREATE OR REPLACE FUNCTION public.phone_screenings_no_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION 'Submitted screenings are permanent history and cannot be deleted.';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_phone_screenings_no_delete ON public.phone_screenings;
CREATE TRIGGER trg_phone_screenings_no_delete
BEFORE DELETE ON public.phone_screenings
FOR EACH ROW EXECUTE FUNCTION public.phone_screenings_no_delete();

-- ─── 2. Hold routing on the applicant pipeline ────────────────────────────────

ALTER TABLE public.cleaner_applicants
  ADD COLUMN IF NOT EXISTS hold_pending text,
  ADD COLUMN IF NOT EXISTS hold_follow_up_at date,
  ADD COLUMN IF NOT EXISTS hold_reminder_sent_at timestamptz;

-- Extend the stage vocabulary with 'hold' (fixable qualifier failures /
-- consent pushback route here instead of a hard reject).
ALTER TABLE public.cleaner_applicants DROP CONSTRAINT IF EXISTS cleaner_applicants_stage_check;
ALTER TABLE public.cleaner_applicants ADD CONSTRAINT cleaner_applicants_stage_check
  CHECK (stage IN ('applicant','screening','hold','onboarding','agreement_signed','active','rejected','withdrawn'));

-- Daily reminder sweep: when a hold's follow-up date arrives, emit an event
-- (rides the existing events → Discord path) exactly once, so held
-- applicants resurface on the day instead of being forgotten. Re-holding an
-- applicant clears hold_reminder_sent_at so the next date fires again.
DO $$
BEGIN
  PERFORM cron.unschedule('applicant-hold-follow-up-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'applicant-hold-follow-up-daily',
  '0 14 * * *', -- 14:00 UTC ≈ morning US Eastern
  $CRON$
    WITH due AS (
      UPDATE public.cleaner_applicants
         SET hold_reminder_sent_at = now()
       WHERE stage = 'hold'
         AND hold_follow_up_at IS NOT NULL
         AND hold_follow_up_at <= current_date
         AND hold_reminder_sent_at IS NULL
       RETURNING id, full_name, email, cleaner_id, hold_pending, hold_follow_up_at
    )
    INSERT INTO public.events (event_type, source, cleaner_id, summary, data)
    SELECT
      'applicant.hold_due',
      'phone-screening',
      cleaner_id,
      coalesce(full_name, email, id::text) || ' — hold follow-up due today ('
        || coalesce(hold_pending, 'pending item') || ')',
      jsonb_build_object(
        'applicant_id', id,
        'pending', hold_pending,
        'follow_up_date', hold_follow_up_at
      )
    FROM due;
  $CRON$
);

-- ─── 3. Private bucket for generated screening-record PDFs ────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('screening-records', 'screening-records', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read screening records" ON storage.objects;
CREATE POLICY "admins read screening records" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'screening-records' AND public.is_admin_or_va(auth.uid()));

-- ─── 4. Discord routes for screening outcomes + due holds ─────────────────────

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES
  ('applicant.screened', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true),
  ('applicant.hold_due', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true)
ON CONFLICT (event_type) DO NOTHING;
