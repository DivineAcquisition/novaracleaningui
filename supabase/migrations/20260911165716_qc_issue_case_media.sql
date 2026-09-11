-- QC case photos & videos live on the issue, not on the job's before/after
-- arrays. Files go in the private qc-statement-files bucket (same as contractor
-- statement uploads) so the 14-day cleaner-job-photos purge never deletes them.

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS evidence_files jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.qc_issues.evidence_files IS
  'Photos and videos attached to this QC report (admin or field). Durable storage in qc-statement-files; not 14-day job-photo purge. Parallel to job before/after — never a substitute for them.';

UPDATE storage.buckets
SET file_size_limit = 83886080
WHERE id = 'qc-statement-files'
  AND (file_size_limit IS NULL OR file_size_limit < 83886080);
