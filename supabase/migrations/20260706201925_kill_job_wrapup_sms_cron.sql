-- ─── Kill the orphaned "Job wrap-up time!" SMS cron ─────────────────────────
--
-- A send-job-completion-sms edge function + 15-minute pg_cron job
-- ('send-job-completion-sms-every-15min') were deployed on 2026-05-22 from a
-- branch that never landed in this repo. It texts cleaners:
--
--   "✅ Job wrap-up time! ... Tap to mark complete, flag an issue, or
--    escalate: https://contractor.novaracleaning.com/cleaner/job/<t>/complete"
--
-- The /cleaner/job/<token>/complete page was never shipped (the link 404s),
-- nothing in the codebase manages its dedupe columns, and cleaners have been
-- getting purposeless repeat texts. Unschedule every cron entry that points
-- at it. The function itself is replaced by a no-op tombstone in the same
-- deploy so even a stray invocation can never text anyone again.
--
-- The wrap-up moment is covered by the real flow: check-in → before-photos
-- link → job checklist → cleaner-mark-complete → after-photos.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname ILIKE '%job-completion-sms%'
       OR command ILIKE '%send-job-completion-sms%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
    RAISE NOTICE 'Unscheduled cron job % (%)', r.jobname, r.jobid;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not installed in this environment (e.g. local shadow DB) — fine.
  RAISE NOTICE 'Skipping job-completion-sms cron cleanup: %', SQLERRM;
END$$;
