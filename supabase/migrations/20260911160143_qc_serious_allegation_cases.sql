-- Serious allegation / incident QC cases.
--
-- Distinct from a quality complaint. Opening a case is evidence assembly, not
-- a finding: no Novara Score penalty and no accountability action follows from
-- the row existing. Score impact and ladder steps remain a human determination.
--
-- Retrieval-only for existing job, photo, comms, GHL, and contractor records.
-- This migration only adds columns/constraints/policies on qc_issues and does
-- not rewrite booking, photo, message, or cleaner rows.

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
    'serious_allegation'
  ));

ALTER TABLE public.qc_issues
  ADD COLUMN IF NOT EXISTS retain_permanently boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS score_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_suspension_flag text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS insurance_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_notified_by_name text,
  ADD COLUMN IF NOT EXISTS manager_account text,
  ADD COLUMN IF NOT EXISTS contractor_statement text,
  ADD COLUMN IF NOT EXISTS client_written_communication text,
  ADD COLUMN IF NOT EXISTS client_followup_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.qc_issues DROP CONSTRAINT IF EXISTS qc_issues_suspension_flag_check;
ALTER TABLE public.qc_issues
  ADD CONSTRAINT qc_issues_suspension_flag_check
  CHECK (contractor_suspension_flag IN ('none', 'pending_admin', 'suspended', 'cleared'));

COMMENT ON COLUMN public.qc_issues.retain_permanently IS
  'Permanent retention. Exempt from routine photo purge / archival. Sticky once true.';
COMMENT ON COLUMN public.qc_issues.admin_only IS
  'Restricted to admin/owner. VAs cannot read or mutate these rows.';
COMMENT ON COLUMN public.qc_issues.score_exempt IS
  'When true, compute-cleaner-scores must ignore the row. Allegations under investigation are not findings.';
COMMENT ON COLUMN public.qc_issues.contractor_suspension_flag IS
  'Admin prompt only. pending_admin surfaces a decision; never auto-changes cleaners.status.';
COMMENT ON COLUMN public.qc_issues.insurance_notified_at IS
  'Human-entered carrier-notification date. The system does not notify the carrier.';
COMMENT ON COLUMN public.qc_issues.manager_account IS
  'Admin-entered contemporaneous account of the client and contractor calls. Never inferred.';
COMMENT ON COLUMN public.qc_issues.contractor_statement IS
  'Admin-entered contractor written statement addressing the allegation. Never inferred.';
COMMENT ON COLUMN public.qc_issues.client_written_communication IS
  'Client email / written communication attached in full, unedited.';
COMMENT ON COLUMN public.qc_issues.client_followup_documents IS
  'Documents the client later provides (vet records, invoices), attached as received.';

CREATE INDEX IF NOT EXISTS qc_issues_serious_allegation_idx
  ON public.qc_issues (issue_type, created_at DESC)
  WHERE issue_type = 'serious_allegation';

CREATE INDEX IF NOT EXISTS qc_issues_retain_permanently_idx
  ON public.qc_issues (booking_id)
  WHERE retain_permanently = true;

-- Stamp legal defaults on insert. Do not change other tables.
CREATE OR REPLACE FUNCTION public.qc_serious_allegation_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.issue_type = 'serious_allegation' THEN
    NEW.issue_type := 'serious_allegation';
  END IF;

  IF NEW.issue_type = 'serious_allegation' THEN
    NEW.severity := 'critical';
    IF NEW.status IS NULL OR NEW.status = 'open' THEN
      NEW.status := 'investigating';
    END IF;
    NEW.retain_permanently := true;
    NEW.admin_only := true;
    NEW.score_exempt := true;
    IF NEW.contractor_suspension_flag IS NULL OR NEW.contractor_suspension_flag = 'none' THEN
      NEW.contractor_suspension_flag := 'pending_admin';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.retain_permanently IS TRUE THEN
    NEW.retain_permanently := true;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.admin_only IS TRUE THEN
    NEW.admin_only := true;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.score_exempt IS TRUE THEN
    NEW.score_exempt := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qc_serious_allegation_defaults_trg ON public.qc_issues;
CREATE TRIGGER qc_serious_allegation_defaults_trg
  BEFORE INSERT OR UPDATE ON public.qc_issues
  FOR EACH ROW EXECUTE FUNCTION public.qc_serious_allegation_defaults();

-- Admin/owner only for admin_only rows. Service role still bypasses RLS so
-- edge functions must enforce the same rule after JWT inspection.
DROP POLICY IF EXISTS qc_issues_admin_all ON public.qc_issues;
CREATE POLICY qc_issues_admin_all ON public.qc_issues
  FOR ALL TO authenticated
  USING (
    public.is_admin_or_va(auth.uid())
    AND (
      COALESCE(admin_only, false) = false
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  )
  WITH CHECK (
    public.is_admin_or_va(auth.uid())
    AND (
      COALESCE(admin_only, false) = false
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

DROP POLICY IF EXISTS qc_issue_events_admin_read ON public.qc_issue_events;
CREATE POLICY qc_issue_events_admin_read ON public.qc_issue_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.qc_issues i
      WHERE i.id = qc_issue_events.issue_id
        AND public.is_admin_or_va(auth.uid())
        AND (
          COALESCE(i.admin_only, false) = false
          OR public.has_role(auth.uid(), 'admin'::app_role)
        )
    )
  );
