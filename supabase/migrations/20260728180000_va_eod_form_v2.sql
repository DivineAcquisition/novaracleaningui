-- ─── EOD form v2: metrics block, selects, lock-at-cutoff, generated PDF ──────
--
-- The form moves from task-driven question sets to a flat block of ten metric
-- numbers plus four single-selects. The metric values keep living in
-- self_reported (the discrepancy engine already reads it and every existing
-- flag still resolves), so this is additive rather than a rewrite of stored
-- data. The selects get real columns because they're structured and queried.

ALTER TABLE public.va_eod_submissions
  -- The four single-selects.
  ADD COLUMN IF NOT EXISTS primary_focus text,
  ADD COLUMN IF NOT EXISTS blockers_level text,
  ADD COLUMN IF NOT EXISTS management_attention text,
  ADD COLUMN IF NOT EXISTS cleaner_issues text,
  -- Follow-up text for "Cleaner issues". Blockers and escalations already have
  -- columns and are reused as the follow-ups for their own selects.
  ADD COLUMN IF NOT EXISTS cleaner_issue_notes text,
  -- The generated record.
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS pdf_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_last_error text,
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_file_id text,
  ADD COLUMN IF NOT EXISTS drive_url text;

DO $$
BEGIN
  ALTER TABLE public.va_eod_submissions
    ADD CONSTRAINT va_eod_submissions_pdf_status_check
    CHECK (pdf_status IN ('none','generated','drive_pending','failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.va_eod_submissions
    ADD CONSTRAINT va_eod_submissions_selects_check
    CHECK (
      (primary_focus IS NULL OR primary_focus IN ('Operations','Sales','Recruiting','Mixed'))
      AND (blockers_level IS NULL OR blockers_level IN ('None','Minor','Major'))
      AND (management_attention IS NULL OR management_attention IN ('No','When you can','Urgent'))
      AND (cleaner_issues IS NULL OR cleaner_issues IN ('None','Minor','Serious'))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Retry sweep looks for records whose PDF hasn't landed.
CREATE INDEX IF NOT EXISTS va_eod_submissions_pdf_retry_idx
  ON public.va_eod_submissions (pdf_status, updated_at)
  WHERE pdf_status IN ('failed','drive_pending') AND locked_at IS NULL;

COMMENT ON COLUMN public.va_eod_submissions.self_reported IS
  'The ten entered metrics keyed by metric field key. Money is stored in cents. Tier 1 values never live here.';
COMMENT ON COLUMN public.va_eod_submissions.pdf_status IS
  'none | generated | drive_pending (stored, Drive mirror outstanding) | failed. The submission is always saved before the PDF is attempted, so this never gates the data.';

-- ─── Task-driven columns are no longer written ───────────────────────────────
--
-- Kept, not dropped: they hold the history of submissions filed under the old
-- model, and throwing that away to tidy a schema would be a poor trade.

COMMENT ON COLUMN public.va_eod_submissions.tasks_selected IS
  'Legacy — the task-driven form (pre v2). Retained for historical submissions; no longer written.';
COMMENT ON COLUMN public.va_eod_submissions.task_notes IS
  'Legacy — per-task notes from the task-driven form. Retained for historical submissions; no longer written.';

-- ─── Lock at the daily cutoff ────────────────────────────────────────────────
--
-- A submission stays editable until the cutoff and is read-only after it.
-- lock_after_hours is measured from the END of the work date, so 0 = midnight
-- local, which is the default the spec asks for.

UPDATE public.app_settings
SET value = value || jsonb_build_object('lock_after_hours', 0),
    description = 'EOD form window: timezone, the on-time cutoff, how long a link lives, and how long after midnight a day stays editable (lock_after_hours, 0 = locks at midnight local).'
WHERE key = 'va_eod_settings';

-- ─── Private bucket for the generated reports ────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('va-eod-reports', 'va-eod-reports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read va eod reports" ON storage.objects;
CREATE POLICY "admins read va eod reports" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'va-eod-reports' AND public.has_role(auth.uid(), 'admin'));

-- ─── Drive archive root ──────────────────────────────────────────────────────

INSERT INTO public.app_secrets (key, value, description)
VALUES
  ('GDRIVE_VA_EOD_ROOT_FOLDER_ID', '',
   'Google Drive folder that roots the VA EOD report archive (VA EOD Reports / YYYY-MM / …). Falls back to GDRIVE_QC_ROOT_FOLDER_ID when blank. The service account needs edit access.')
ON CONFLICT (key) DO NOTHING;

-- ─── Urgent escalations get their own Discord route ──────────────────────────

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES ('va.eod.urgent', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true)
ON CONFLICT (event_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
