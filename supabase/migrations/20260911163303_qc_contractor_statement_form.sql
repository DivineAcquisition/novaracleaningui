-- Tokenized contractor statement form for QC cases.
--
-- Reuses pulse-check token minting, events → discord_routes, app_settings,
-- pg_cron + pg_net, Google Drive (QC root), and send-cleaner-email / send-ghl-sms.
-- Submitted statements are immutable; a correction is a new (supplemental) row.
-- Non-response is a factual flag only — this migration does not write scores,
-- accountability, contractor status, or QC case status.

-- ─── 1. Issue type: client-reported conduct (statement-required by default) ──
ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_issue_type_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_issue_type_check
  CHECK (issue_type IN (
    'complaint',
    'reclean',
    'damage',
    'no_show',
    'late',
    'quality_flag',
    'payment',
    'other',
    'site_finding',
    'addon',
    'serious_allegation',
    'conduct'
  ));

-- ─── 2. Denormalized statement status on the case (derived, never a finding) ─
ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS statement_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS statement_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS statement_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS statement_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS statement_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS statement_not_provided_at timestamptz,
  ADD COLUMN IF NOT EXISTS statement_drive_folder_id text,
  ADD COLUMN IF NOT EXISTS statement_drive_folder_url text,
  ADD COLUMN IF NOT EXISTS statement_report_summary text;

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_statement_status_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_statement_status_check
  CHECK (statement_status IN ('none', 'requested', 'submitted', 'not_provided'));

COMMENT ON COLUMN public.qc_issues.statement_required IS
  'Admin mark (or type/severity default) that the contractor must submit a written statement.';
COMMENT ON COLUMN public.qc_issues.statement_status IS
  'Requested / Submitted / Not Provided. Factual only — never auto-changes Score, accountability, or case status.';
COMMENT ON COLUMN public.qc_issues.statement_report_summary IS
  'Factual report shown on the form page. Never included in the SMS/email request.';
COMMENT ON COLUMN public.qc_issues.contractor_statement IS
  'Admin-entered notes or a pasted verbal account. The contractor-submitted form lives in qc_statement_submissions and is never overwritten here.';

CREATE INDEX IF NOT EXISTS qc_issues_statement_status_idx
  ON public.qc_issues (statement_status, statement_due_at)
  WHERE statement_required = true;

-- ─── 3. Requests (tokenized send) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qc_statement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.qc_issues(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'original'
    CHECK (kind IN ('original', 'supplemental')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'submitted', 'not_provided')),
  token text,
  token_expires_at timestamptz,
  due_at timestamptz NOT NULL,
  sent_at timestamptz,
  emailed boolean NOT NULL DEFAULT false,
  sms_sent boolean NOT NULL DEFAULT false,
  email_error text,
  sms_error text,
  reminder_sent_at timestamptz,
  opened_at timestamptz,
  last_saved_at timestamptz,
  submitted_at timestamptz,
  not_provided_at timestamptz,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_summary text,
  drive_folder_id text,
  drive_folder_url text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS qc_statement_requests_token_uidx
  ON public.qc_statement_requests (token)
  WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS qc_statement_requests_issue_idx
  ON public.qc_statement_requests (issue_id, created_at);
CREATE INDEX IF NOT EXISTS qc_statement_requests_pending_idx
  ON public.qc_statement_requests (status, due_at)
  WHERE status = 'requested';

COMMENT ON TABLE public.qc_statement_requests IS
  'One tokenized statement request. Unique per send. Supplemental requests are new rows on the same case. Token auto-expires and draft auto-saves.';

ALTER TABLE public.qc_statement_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qc_statement_requests_admin_read ON public.qc_statement_requests;
CREATE POLICY qc_statement_requests_admin_read ON public.qc_statement_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.qc_issues i
      WHERE i.id = qc_statement_requests.issue_id
        AND public.is_admin_or_va(auth.uid())
        AND (
          COALESCE(i.admin_only, false) = false
          OR public.has_role(auth.uid(), 'admin'::app_role)
        )
    )
  );

DROP POLICY IF EXISTS qc_statement_requests_service_role ON public.qc_statement_requests;
CREATE POLICY qc_statement_requests_service_role ON public.qc_statement_requests
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.qc_statement_requests TO authenticated, service_role;

-- ─── 4. Immutable submissions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qc_statement_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.qc_statement_requests(id) ON DELETE RESTRICT,
  issue_id uuid NOT NULL REFERENCES public.qc_issues(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE RESTRICT,
  sequence integer NOT NULL DEFAULT 1,
  kind text NOT NULL DEFAULT 'original'
    CHECK (kind IN ('original', 'supplemental')),
  account_text text NOT NULL DEFAULT '',
  timeline_arrived text,
  timeline_started text,
  timeline_left text,
  timeline_notes text,
  report_response text NOT NULL DEFAULT '',
  others_present text,
  attestation_name text NOT NULL,
  attested_at timestamptz NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_path text,
  pdf_drive_file_id text,
  pdf_status text NOT NULL DEFAULT 'none'
    CHECK (pdf_status IN ('none', 'generated', 'failed')),
  pdf_attempts integer NOT NULL DEFAULT 0,
  pdf_last_error text,
  drive_folder_id text,
  drive_folder_url text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS qc_statement_submissions_request_uidx
  ON public.qc_statement_submissions (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS qc_statement_submissions_issue_seq_uidx
  ON public.qc_statement_submissions (issue_id, sequence);
CREATE INDEX IF NOT EXISTS qc_statement_submissions_issue_idx
  ON public.qc_statement_submissions (issue_id, submitted_at);
CREATE INDEX IF NOT EXISTS qc_statement_submissions_pdf_retry_idx
  ON public.qc_statement_submissions (pdf_status, created_at)
  WHERE pdf_status = 'failed';

COMMENT ON TABLE public.qc_statement_submissions IS
  'Contractor-submitted statements. Immutable after insert except PDF/Drive bookkeeping. A correction is a new row.';

ALTER TABLE public.qc_statement_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qc_statement_submissions_admin_read ON public.qc_statement_submissions;
CREATE POLICY qc_statement_submissions_admin_read ON public.qc_statement_submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.qc_issues i
      WHERE i.id = qc_statement_submissions.issue_id
        AND public.is_admin_or_va(auth.uid())
        AND (
          COALESCE(i.admin_only, false) = false
          OR public.has_role(auth.uid(), 'admin'::app_role)
        )
    )
  );

DROP POLICY IF EXISTS qc_statement_submissions_service_role ON public.qc_statement_submissions;
CREATE POLICY qc_statement_submissions_service_role ON public.qc_statement_submissions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.qc_statement_submissions TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qc_statement_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.issue_id IS DISTINCT FROM OLD.issue_id
       OR NEW.cleaner_id IS DISTINCT FROM OLD.cleaner_id
       OR NEW.sequence IS DISTINCT FROM OLD.sequence
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.account_text IS DISTINCT FROM OLD.account_text
       OR NEW.timeline_arrived IS DISTINCT FROM OLD.timeline_arrived
       OR NEW.timeline_started IS DISTINCT FROM OLD.timeline_started
       OR NEW.timeline_left IS DISTINCT FROM OLD.timeline_left
       OR NEW.timeline_notes IS DISTINCT FROM OLD.timeline_notes
       OR NEW.report_response IS DISTINCT FROM OLD.report_response
       OR NEW.others_present IS DISTINCT FROM OLD.others_present
       OR NEW.attestation_name IS DISTINCT FROM OLD.attestation_name
       OR NEW.attested_at IS DISTINCT FROM OLD.attested_at
       OR NEW.answers IS DISTINCT FROM OLD.answers
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.submitted_ip IS DISTINCT FROM OLD.submitted_ip THEN
      RAISE EXCEPTION 'Submitted contractor statements are immutable — send a supplemental form to add or correct.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qc_statement_submissions_guard ON public.qc_statement_submissions;
CREATE TRIGGER trg_qc_statement_submissions_guard
BEFORE UPDATE ON public.qc_statement_submissions
FOR EACH ROW EXECUTE FUNCTION public.qc_statement_submissions_guard();

CREATE OR REPLACE FUNCTION public.qc_statement_submissions_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Submitted contractor statements are permanent history and cannot be deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_qc_statement_submissions_no_delete ON public.qc_statement_submissions;
CREATE TRIGGER trg_qc_statement_submissions_no_delete
BEFORE DELETE ON public.qc_statement_submissions
FOR EACH ROW EXECUTE FUNCTION public.qc_statement_submissions_no_delete();

-- ─── 5. Token mint (same hex-20 pattern as pulse check) ─────────────────────
CREATE OR REPLACE FUNCTION public.mint_qc_statement_token(
  p_request_id uuid,
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
  IF NOT EXISTS (SELECT 1 FROM public.qc_statement_requests WHERE id = p_request_id) THEN
    RETURN NULL;
  END IF;

  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.qc_statement_requests
    SET token = v_token,
        token_expires_at = now() + (GREATEST(1, COALESCE(p_ttl_days, 14)) || ' days')::interval,
        updated_at = now()
    WHERE id = p_request_id;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_qc_statement_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_qc_statement_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_qc_statement_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_qc_statement_token(uuid, integer) TO service_role;

-- ─── 6. Audit actions ───────────────────────────────────────────────────────
ALTER TABLE public.qc_issue_events DROP CONSTRAINT IF EXISTS qc_issue_events_action_check;
ALTER TABLE public.qc_issue_events
  ADD CONSTRAINT qc_issue_events_action_check
  CHECK (action IN (
    'created','status_change','note','updated','resolved','escalated',
    'reclean_requested','reclean_classified','reclean_approved','reclean_declined',
    'reclean_offered','reclean_dispatched','reclean_completed','reclean_message',
    'reclean_offer_declined',
    'statement_requested','statement_submitted','statement_not_provided','statement_reminded'
  ));

-- ─── 7. Settings + Discord ──────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'qc_statement_settings',
  '{"due_hours":48,"reminder_hours_before":24,"token_ttl_days":14,"required_issue_types":["serious_allegation","damage","conduct"],"required_severities":["critical"]}'::jsonb,
  'Contractor statement form. Due window and reminder are admin-configurable. Incident/allegation, damage, conduct, and critical cases default to required. Non-response never auto-penalizes.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('qc.statement.requested', 'DISCORD_WEBHOOK_FLAG', ARRAY['DISCORD_ROLE_OPERATIONS','DISCORD_ROLE_RETENTION']),
  ('qc.statement.submitted', 'DISCORD_WEBHOOK_FLAG', ARRAY['DISCORD_ROLE_OPERATIONS','DISCORD_ROLE_RETENTION']),
  ('qc.statement.not_provided', 'DISCORD_WEBHOOK_FLAG', ARRAY['DISCORD_ROLE_OPERATIONS','DISCORD_ROLE_RETENTION']),
  ('qc.statement.pdf_failed', 'DISCORD_WEBHOOK_FLAG', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

-- ─── 8. Private storage for uploads + PDFs ──────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('qc-statement-files', 'qc-statement-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read qc statement files" ON storage.objects;
CREATE POLICY "admins read qc statement files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'qc-statement-files' AND public.is_admin_or_va(auth.uid()));

-- ─── 9. Reminder + overdue + PDF retry cron (never writes Score/status) ─────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qc-statement-runner') THEN
    PERFORM cron.unschedule('qc-statement-runner');
  END IF;
  PERFORM cron.schedule(
    'qc-statement-runner',
    '*/15 * * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_secrets WHERE key = 'SUPABASE_URL') || '/functions/v1/qc-statement-runner',
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
  RAISE NOTICE 'pg_cron unavailable — qc-statement-runner not scheduled.';
END $$;

-- Existing NVC-0101 allegation case: mark required so admin can send the form.
-- Do not mint a token or send SMS/email from SQL.
UPDATE public.qc_issues
SET statement_required = true,
    statement_report_summary = COALESCE(
      NULLIF(statement_report_summary, ''),
      NULLIF(description, ''),
      title
    )
WHERE issue_type = 'serious_allegation'
  AND statement_required = false;
