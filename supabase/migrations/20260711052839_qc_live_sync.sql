-- ─── QC live sync: auto-complete checklists, instant photo sync, QC backlog ──
--
-- 1. When a booking is marked completed, its job checklist auto-completes
--    (all assigned tasks counted done) so dispatch/QC never show a finished
--    job with a dangling checklist.
-- 2. Cleaner photo uploads (before_photos / after_photos) now count as
--    "meaningful" booking changes → the Airtable Revenue Ops job row syncs
--    the moment photos land (documented flag etc.), not just on completion.
-- 3. qc_issues changes POST { type: "qc_issue", id } to the Airtable sync
--    route, keeping the "QC Issues" backlog table live (table itself is
--    created lazily by the app via the Meta API).

-- ─── 1. Auto-complete checklist when the job completes ──────────────────────
CREATE OR REPLACE FUNCTION public.auto_complete_job_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
     AND NEW.job_id IS NOT NULL THEN
    UPDATE public.job_checklists
    SET completed_items = GREATEST(total_items, completed_items),
        progress_pct = 100,
        completed_at = COALESCE(completed_at, now()),
        started_at = COALESCE(started_at, now()),
        last_activity_at = now(),
        last_activity_by = COALESCE(last_activity_by, 'auto — job completed'),
        updated_at = now()
    WHERE job_id = NEW.job_id
      AND completed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_complete_job_checklist ON public.bookings;
CREATE TRIGGER trg_auto_complete_job_checklist
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.auto_complete_job_checklist();

-- ─── 2. Photo uploads fire the Airtable job sync ─────────────────────────────
-- Recreate the change-detection gate with before_photos/after_photos included.
CREATE OR REPLACE FUNCTION public.notify_airtable_revops_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  sync_url    text;
  sync_secret text;
  request_id  bigint;
BEGIN
  IF tg_op = 'UPDATE' THEN
    IF NEW.status               IS NOT DISTINCT FROM OLD.status
       AND NEW.service_date         IS NOT DISTINCT FROM OLD.service_date
       AND NEW.time_slot            IS NOT DISTINCT FROM OLD.time_slot
       AND NEW.service_type         IS NOT DISTINCT FROM OLD.service_type
       AND NEW.email                IS NOT DISTINCT FROM OLD.email
       AND NEW.phone                IS NOT DISTINCT FROM OLD.phone
       AND NEW.first_name           IS NOT DISTINCT FROM OLD.first_name
       AND NEW.last_name            IS NOT DISTINCT FROM OLD.last_name
       AND NEW.total_estimate_cents IS NOT DISTINCT FROM OLD.total_estimate_cents
       AND NEW.final_charge_cents   IS NOT DISTINCT FROM OLD.final_charge_cents
       AND NEW.cleaner_payout_cents IS NOT DISTINCT FROM OLD.cleaner_payout_cents
       AND NEW.payout_status        IS NOT DISTINCT FROM OLD.payout_status
       AND NEW.num_cleaners_assigned IS NOT DISTINCT FROM OLD.num_cleaners_assigned
       AND NEW.membership_plan      IS NOT DISTINCT FROM OLD.membership_plan
       AND NEW.completed_at         IS NOT DISTINCT FROM OLD.completed_at
       AND NEW.before_photos        IS NOT DISTINCT FROM OLD.before_photos
       AND NEW.after_photos         IS NOT DISTINCT FROM OLD.after_photos
    THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT value INTO sync_url    FROM public.app_secrets WHERE key = 'AIRTABLE_SYNC_URL';
  SELECT value INTO sync_secret FROM public.app_secrets WHERE key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';

  IF sync_url IS NULL OR length(trim(sync_url)) = 0
     OR sync_secret IS NULL OR length(trim(sync_secret)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT net.http_post(
      url := trim(sync_url),
      body := jsonb_build_object('type', 'job', 'id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-airtable-sync-secret', trim(sync_secret)
      ),
      timeout_milliseconds := 30000
    ) INTO request_id;
  EXCEPTION WHEN OTHERS THEN
    request_id := NULL;
  END;

  RETURN NEW;
END;
$$;

-- ─── 3. qc_issues → Airtable QC backlog (live) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_airtable_on_qc_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  sync_url    text;
  sync_secret text;
  request_id  bigint;
BEGIN
  SELECT value INTO sync_url    FROM public.app_secrets WHERE key = 'AIRTABLE_SYNC_URL';
  SELECT value INTO sync_secret FROM public.app_secrets WHERE key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';
  IF sync_url IS NULL OR length(trim(sync_url)) = 0
     OR sync_secret IS NULL OR length(trim(sync_secret)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT net.http_post(
      url := trim(sync_url),
      body := jsonb_build_object('type', 'qc_issue', 'id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-airtable-sync-secret', trim(sync_secret)
      ),
      timeout_milliseconds := 30000
    ) INTO request_id;
  EXCEPTION WHEN OTHERS THEN
    request_id := NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_airtable_on_qc_issue_change ON public.qc_issues;
CREATE TRIGGER notify_airtable_on_qc_issue_change
  AFTER INSERT OR UPDATE ON public.qc_issues
  FOR EACH ROW EXECUTE FUNCTION public.notify_airtable_on_qc_issue();

-- ─── 4. Documentation changes refresh the Airtable job row too ───────────────
-- (Drive link / documented flag land on the Jobs table the moment the mirror
-- or a retry updates the record — not only when the mirror worker pushes.)
CREATE OR REPLACE FUNCTION public.notify_airtable_on_job_documentation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  sync_url    text;
  sync_secret text;
  request_id  bigint;
BEGIN
  IF tg_op = 'UPDATE'
     AND NEW.documented IS NOT DISTINCT FROM OLD.documented
     AND NEW.mirror_status IS NOT DISTINCT FROM OLD.mirror_status
     AND NEW.drive_folder_url IS NOT DISTINCT FROM OLD.drive_folder_url THEN
    RETURN NEW;
  END IF;

  SELECT value INTO sync_url    FROM public.app_secrets WHERE key = 'AIRTABLE_SYNC_URL';
  SELECT value INTO sync_secret FROM public.app_secrets WHERE key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';
  IF sync_url IS NULL OR length(trim(sync_url)) = 0
     OR sync_secret IS NULL OR length(trim(sync_secret)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT net.http_post(
      url := trim(sync_url),
      body := jsonb_build_object('type', 'job', 'id', NEW.booking_id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-airtable-sync-secret', trim(sync_secret)
      ),
      timeout_milliseconds := 30000
    ) INTO request_id;
  EXCEPTION WHEN OTHERS THEN
    request_id := NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_airtable_on_job_documentation_change ON public.job_documentation;
CREATE TRIGGER notify_airtable_on_job_documentation_change
  AFTER INSERT OR UPDATE ON public.job_documentation
  FOR EACH ROW EXECUTE FUNCTION public.notify_airtable_on_job_documentation();
